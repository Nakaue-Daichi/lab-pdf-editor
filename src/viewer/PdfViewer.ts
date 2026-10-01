// 連続スクロールのページ列。表示に近いページだけ描き、遠いページの描画は捨てる（iOS はキャンバスが多すぎると落ちる）。
// 倍率を変えるとき（セレクト・幅合わせ・指 2 本のピンチ）は、表示の中央（ピンチは指の間）の点が同じ画面位置に残るようにする。
// オーバーレイの再描画とクリックの座標変換も担う。
import { TouchManager, type PDFDocumentProxy } from 'pdfjs-dist';
import type { Comment } from '../model/types';
import { anchorRect } from '../pdf/annotations';
import { pdfRectToCss } from './coords';
import { renderOverlay } from './OverlayLayer';
import { PageView, type CanvasLimits } from './PageView';
import {
  MAX_CANVAS_DIM,
  MAX_CANVAS_DIM_TOUCH,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_PIXELS_TOUCH,
  pageIndexAt,
  pagesToRelease,
  RENDER_CACHE_BASE,
  RENDER_CACHE_BASE_TOUCH,
  renderCacheSize,
} from './renderBudget';
import { anchorAt, clampScale, MIN_SCALE, percentToScale, scaleToPercent, scrollForAnchor, type Anchor } from './zoom';

/** 'fit-width' か百分率。100% = 96dpi 換算（1pt = 1.333px）。 */
export type ZoomMode = 'fit-width' | number;

export interface PdfViewerOptions {
  /** 指で操作する端末か（描画の上限を小さくする） */
  touch: boolean;
}

/** ページ位置（「3 / 12」）を消すまでの時間 */
const INDICATOR_MS = 1200;

export class PdfViewer {
  readonly el: HTMLDivElement;
  private readonly pagesEl: HTMLDivElement;
  private readonly indicatorEl: HTMLDivElement;
  private pageViews: PageView[] = [];
  private zoomMode: ZoomMode = 'fit-width';
  private readonly observer: IntersectionObserver;
  private resizeTimer = 0;
  private indicatorTimer = 0;
  private scrollFrame = 0;
  private comments: readonly Comment[] = [];
  private selectedId: string | null = null;
  private fitEachPage = false;
  private readonly limits: CanvasLimits;
  private readonly cacheBase: number;
  /** 指 2 本で操作している間の倍率（0 = 操作していない）。この間は描き直さず寸法だけ変える */
  private pinchScale = 0;
  private pinched = false;

  /** ページ上のクリック（付箋アイコン以外）。point は PDF ユーザ空間 */
  onPageClick: ((pageIndex: number, point: [number, number], event: MouseEvent) => void) | null = null;
  /** 付箋アイコンのクリック */
  onSelectNote: ((id: string) => void) | null = null;
  /** ピンチで倍率が変わった（ツールバーの表示を合わせる） */
  onZoomChange: ((mode: ZoomMode) => void) | null = null;

  constructor(parent: HTMLElement, options: PdfViewerOptions) {
    this.limits = options.touch
      ? { maxPixels: MAX_CANVAS_PIXELS_TOUCH, maxDim: MAX_CANVAS_DIM_TOUCH }
      : { maxPixels: MAX_CANVAS_PIXELS, maxDim: MAX_CANVAS_DIM };
    this.cacheBase = options.touch ? RENDER_CACHE_BASE_TOUCH : RENDER_CACHE_BASE;

    this.el = document.createElement('div');
    this.el.className = 'pv-viewer';
    this.pagesEl = document.createElement('div');
    this.pagesEl.className = 'pv-pages';
    this.el.append(this.pagesEl);
    this.indicatorEl = document.createElement('div');
    this.indicatorEl.className = 'pv-pageind';
    this.indicatorEl.setAttribute('aria-hidden', 'true');
    parent.append(this.el, this.indicatorEl);

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pv = this.viewOf(entry.target);
          if (pv) this.renderPage(pv);
        }
      },
      { root: this.el, rootMargin: '100% 0px' },
    );
    this.pagesEl.addEventListener('click', (event) => this.handleClick(event));
    this.el.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // 表示領域の幅が変わったら「幅に合わせる」を計算し直す。ウィンドウのリサイズだけでなく、
    // 非表示（幅 0）で開いてから表示された場合や、サイドバー幅の変化にも追従する。
    // 高さだけの変化（スマホのキーボード・アドレスバーの出し入れ）では描き直さない。
    let observedWidth = -1;
    new ResizeObserver(() => {
      const width = this.el.clientWidth;
      if (width === observedWidth) return;
      observedWidth = width;
      if (this.zoomMode !== 'fit-width' || this.pageViews.length === 0) return;
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.applyScale(), 100);
    }).observe(this.el);

    // 指 2 本のピンチ。PDF.js 本家のビューアと同じ TouchManager を使う（指 2 本のときだけ touchmove を preventDefault し、
    // 1 本の操作＝スクロールと文字の選択はブラウザに任せる）。styles.css で touch-action: pan-x pan-y も付けている。
    new TouchManager({
      container: this.el,
      isPinchingDisabled: () => this.pageViews.length === 0,
      onPinchStart: () => this.beginPinch(),
      onPinching: (origin: [number, number], prevDistance: number, distance: number, dx: number, dy: number) =>
        this.pinch(origin, distance / prevDistance, dx, dy),
      onPanning: (dx: number, dy: number) => this.panBy(dx, dy),
      onPinchEnd: () => this.endPinch(),
      signal: new AbortController().signal,
    });
    // iOS Safari は本文の上の 2 本指でもページ全体を拡大しようとする（gesture* は Safari だけのイベント）
    this.el.addEventListener('gesturestart', (event) => event.preventDefault());
  }

  get zoom(): ZoomMode {
    return this.zoomMode;
  }

  get pageCount(): number {
    return this.pageViews.length;
  }

  /**
   * 「幅に合わせる」をページごとにするか（スマホ用画面）。false なら最も広いページに合わせて全ページ同じ倍率にする。
   * 横置きのページが 1 枚あるだけで縦のページが 7 割の幅に縮むのを、幅の狭い画面では避けたい。
   */
  setFitEachPage(on: boolean): void {
    if (on === this.fitEachPage) return;
    this.fitEachPage = on;
    if (this.zoomMode === 'fit-width') this.applyScale();
  }

  async load(doc: PDFDocumentProxy): Promise<void> {
    this.clear();
    const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
    const scales = this.computeScales(pages.map((p) => p.getViewport({ scale: 1 }).width));
    this.pageViews = pages.map((page, index) => new PageView(index, page, scales[index] as number, this.limits));
    for (const pv of this.pageViews) {
      this.pagesEl.append(pv.el);
      this.observer.observe(pv.el);
    }
    this.el.scrollTop = 0;
  }

  clear(): void {
    for (const pv of this.pageViews) {
      this.observer.unobserve(pv.el);
      pv.destroy();
    }
    this.pageViews = [];
    this.pagesEl.replaceChildren();
  }

  setZoom(mode: ZoomMode): void {
    this.zoomMode = mode;
    this.applyScale();
  }

  /** 表示するコメントと選択を差し替えて全ページのオーバーレイを描き直す */
  setComments(comments: readonly Comment[], selectedId: string | null): void {
    this.comments = comments;
    this.selectedId = selectedId;
    for (const pv of this.pageViews) this.paintOverlay(pv);
  }

  /** コメントの場所へ送る。topFraction = 表示領域の上から何割の位置に出すか */
  scrollToComment(comment: Comment, topFraction = 0.3): void {
    const pv = this.pageViews[comment.pageIndex];
    if (!pv) return;
    const css = pdfRectToCss(anchorRect(comment.anchor), pv.viewport);
    const top = pv.el.offsetTop + css.top - this.el.clientHeight * topFraction;
    const left = pv.el.offsetLeft + css.left + css.width / 2 - this.el.clientWidth / 2;
    // 横は、拡大していてコメントが画面の外にあるときだけ送る
    const visibleX = pv.el.offsetLeft + css.left >= this.el.scrollLeft && pv.el.offsetLeft + css.left + css.width <= this.el.scrollLeft + this.el.clientWidth;
    this.el.scrollTo({ top: Math.max(0, top), left: visibleX ? this.el.scrollLeft : Math.max(0, left), behavior: 'smooth' });
  }

  /** コメントの場所が下から bottomInset px（シートなど）に隠れる、または上にはみ出すなら、見える位置まで送る */
  ensureVisible(comment: Comment, bottomInset: number): void {
    const pv = this.pageViews[comment.pageIndex];
    if (!pv) return;
    const css = pdfRectToCss(anchorRect(comment.anchor), pv.viewport);
    const top = pv.el.offsetTop + css.top - this.el.scrollTop;
    const bottom = top + Math.max(css.height, 24);
    const visibleBottom = this.el.clientHeight - bottomInset - 12;
    if (top >= 8 && bottom <= visibleBottom) return;
    this.scrollToComment(comment, 0.2);
  }

  /** そのページの今の倍率（PDF の 1pt が何 CSS px か） */
  scaleOf(pageIndex: number): number {
    return this.pageViews[pageIndex]?.viewport.scale ?? 1;
  }

  pageViewFor(el: Element): PageView | undefined {
    const pageEl = el.closest('.pv-page');
    return pageEl ? this.viewOf(pageEl) : undefined;
  }

  private viewOf(el: Element): PageView | undefined {
    const index = Number((el as HTMLElement).dataset.pageIndex);
    return this.pageViews[index];
  }

  /** ページごとの倍率（PDF の 1pt を何 CSS px で描くか） */
  private computeScales(widthsAtScale1?: number[]): number[] {
    const widths = widthsAtScale1 ?? this.pageViews.map((pv) => pv.page.getViewport({ scale: 1 }).width);
    if (this.zoomMode === 'fit-width') {
      const maxWidth = Math.max(1, ...widths);
      // 左右の余白は styles.css の --pages-pad（スマホ用画面では狭い）
      const style = getComputedStyle(this.pagesEl);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const available = Math.max(200, this.el.clientWidth - padding);
      return widths.map((w) => Math.max(MIN_SCALE, available / (this.fitEachPage ? Math.max(1, w) : maxWidth)));
    }
    const scale = clampScale(percentToScale(this.zoomMode));
    return widths.map(() => scale);
  }

  /** 倍率を今の zoomMode に合わせる。focus（表示領域内の座標・既定は中央）の点が同じ位置に残るようスクロールを合わせる */
  private applyScale(focus?: { x: number; y: number }): void {
    if (this.pageViews.length === 0) return;
    const view = focus ?? { x: this.el.clientWidth / 2, y: this.el.clientHeight / 2 };
    const anchor = this.anchorAtView(view.x, view.y);
    const scales = this.computeScales();
    this.pageViews.forEach((pv, i) => pv.setScale(scales[i] as number));
    if (anchor) this.scrollToAnchor(anchor, view.x, view.y);
    // 倍率だけ変わって交差状態が変わらないページは observer が呼ばれないので、近いページを自分で描き直す
    for (const pv of this.pageViews) if (this.isNearViewport(pv)) this.renderPage(pv);
  }

  /** 表示領域内の座標 (viewX, viewY) にあるページと、ページ内の割合 */
  private anchorAtView(viewX: number, viewY: number): Anchor | null {
    const boxes = this.pageViews.map((pv) => ({ left: pv.el.offsetLeft, top: pv.el.offsetTop, width: pv.el.offsetWidth, height: pv.el.offsetHeight }));
    return anchorAt(boxes, this.el.scrollLeft + viewX, this.el.scrollTop + viewY);
  }

  private scrollToAnchor(anchor: Anchor, viewX: number, viewY: number): void {
    const pv = this.pageViews[anchor.index];
    if (!pv) return;
    const box = { left: pv.el.offsetLeft, top: pv.el.offsetTop, width: pv.el.offsetWidth, height: pv.el.offsetHeight };
    const { left, top } = scrollForAnchor(box, anchor, viewX, viewY);
    this.el.scrollLeft = left;
    this.el.scrollTop = top;
  }

  // ---- ピンチ ----
  private beginPinch(): void {
    // 「幅に合わせる」でページごとに倍率が違っても、ピンチ中は表示の中央のページの倍率に全ページを揃える
    const center = this.anchorAtView(this.el.clientWidth / 2, this.el.clientHeight / 2);
    this.pinchScale = this.pageViews[center?.index ?? 0]?.viewport.scale ?? 1;
    this.pinched = false;
  }

  private pinch([clientX, clientY]: [number, number], factor: number, dx: number, dy: number): void {
    if (!this.pinchScale || !Number.isFinite(factor)) return;
    const next = clampScale(this.pinchScale * factor);
    const rect = this.el.getBoundingClientRect();
    const from = { x: clientX - rect.left, y: clientY - rect.top };
    const anchor = this.anchorAtView(from.x, from.y);
    this.pinchScale = next;
    this.pinched = true;
    // 寸法だけ変える（今の絵は CSS で伸び縮みする）。指の間にあった点を、動いた後の指の間へ
    for (const pv of this.pageViews) pv.setScale(next);
    if (anchor) this.scrollToAnchor(anchor, from.x + dx, from.y + dy);
  }

  private panBy(dx: number, dy: number): void {
    this.el.scrollLeft -= dx;
    this.el.scrollTop -= dy;
  }

  private endPinch(): void {
    const scale = this.pinchScale;
    this.pinchScale = 0;
    if (this.pinched && scale) {
      this.zoomMode = scaleToPercent(scale);
      this.applyScale(); // 百分率に丸めた倍率で描き直す（中央の点は保つ）
      this.onZoomChange?.(this.zoomMode);
    } else {
      for (const pv of this.pageViews) if (this.isNearViewport(pv)) this.renderPage(pv);
    }
  }

  // ---- 描画と、その上限 ----
  private isNearViewport(pv: PageView): boolean {
    const margin = this.el.clientHeight;
    const rect = pv.el.getBoundingClientRect();
    const root = this.el.getBoundingClientRect();
    return rect.bottom >= root.top - margin && rect.top <= root.bottom + margin;
  }

  private renderPage(pv: PageView): void {
    if (this.pinchScale) return; // ピンチ中は描かない（終わってから描く）
    pv.render()
      .then(() => {
        this.paintOverlay(pv);
        this.releaseFarPages();
      })
      .catch((err: unknown) => console.error(`ページ ${pv.pageIndex + 1} の描画に失敗しました`, err));
  }

  /** 描画済みのページが上限を超えたら、表示から遠いページの描画を捨てる */
  private releaseFarPages(): void {
    const rendered = this.pageViews.filter((pv) => pv.isRendered).map((pv) => pv.pageIndex);
    const root = this.el.getBoundingClientRect();
    let visible = 0;
    const near = new Set<number>();
    for (const pv of this.pageViews) {
      if (!this.isNearViewport(pv)) continue;
      near.add(pv.pageIndex);
      const rect = pv.el.getBoundingClientRect();
      if (rect.bottom > root.top && rect.top < root.bottom) visible += 1;
    }
    const limit = renderCacheSize(visible, this.cacheBase);
    for (const index of pagesToRelease(rendered, this.currentPageIndex(), limit, near)) this.pageViews[index]?.release();
  }

  /** 表示領域の上から 4 割の位置にあるページ */
  private currentPageIndex(): number {
    return pageIndexAt(
      this.pageViews.map((pv) => pv.el.offsetTop),
      this.el.scrollTop + this.el.clientHeight * 0.4,
    );
  }

  // ---- ページ位置の表示 ----
  private onScroll(): void {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (this.pageViews.length < 2) return;
      this.indicatorEl.textContent = `${this.currentPageIndex() + 1} / ${this.pageViews.length}`;
      this.indicatorEl.classList.add('is-visible');
      window.clearTimeout(this.indicatorTimer);
      this.indicatorTimer = window.setTimeout(() => this.indicatorEl.classList.remove('is-visible'), INDICATOR_MS);
    });
  }

  private paintOverlay(pv: PageView): void {
    renderOverlay(
      pv.overlayEl,
      pv.viewport,
      this.comments.filter((c) => c.pageIndex === pv.pageIndex),
      this.selectedId,
      (id) => this.onSelectNote?.(id),
    );
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (target.closest('.pv-note')) return;
    const pv = this.pageViewFor(target);
    if (!pv) return;
    const rect = pv.el.getBoundingClientRect();
    const [x, y] = pv.viewport.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top) as [number, number];
    this.onPageClick?.(pv.pageIndex, [x, y], event);
  }
}
