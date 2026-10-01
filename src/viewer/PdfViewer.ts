// 連続スクロールのページ列。表示に近いページだけ描く。オーバーレイの再描画とクリックの座標変換も担う。
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Comment } from '../model/types';
import { anchorRect } from '../pdf/annotations';
import { pdfRectToCss } from './coords';
import { renderOverlay } from './OverlayLayer';
import { PageView } from './PageView';

/** 'fit-width' か百分率。100% = 96dpi 換算（1pt = 1.333px）。 */
export type ZoomMode = 'fit-width' | number;

const CSS_PX_PER_PT = 96 / 72;
const MIN_SCALE = 0.25;

export class PdfViewer {
  readonly el: HTMLDivElement;
  private readonly pagesEl: HTMLDivElement;
  private pageViews: PageView[] = [];
  private zoomMode: ZoomMode = 'fit-width';
  private readonly observer: IntersectionObserver;
  private resizeTimer = 0;
  private comments: readonly Comment[] = [];
  private selectedId: string | null = null;
  private fitEachPage = false;

  /** ページ上のクリック（付箋アイコン以外）。point は PDF ユーザ空間 */
  onPageClick: ((pageIndex: number, point: [number, number], event: MouseEvent) => void) | null = null;
  /** 付箋アイコンのクリック */
  onSelectNote: ((id: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pv-viewer';
    this.pagesEl = document.createElement('div');
    this.pagesEl.className = 'pv-pages';
    this.el.append(this.pagesEl);
    parent.append(this.el);

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
    this.pageViews = pages.map((page, index) => new PageView(index, page, scales[index] as number));
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
    this.el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
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
    const scale = Math.max(MIN_SCALE, (this.zoomMode / 100) * CSS_PX_PER_PT);
    return widths.map(() => scale);
  }

  private applyScale(): void {
    if (this.pageViews.length === 0) return;
    const scales = this.computeScales();
    const ratio = this.el.scrollTop / Math.max(1, this.pagesEl.scrollHeight);
    this.pageViews.forEach((pv, i) => pv.setScale(scales[i] as number));
    this.el.scrollTop = ratio * this.pagesEl.scrollHeight;
    // 倍率だけ変わって交差状態が変わらないページは observer が呼ばれないので、近いページを自分で描き直す
    for (const pv of this.pageViews) {
      if (this.isNearViewport(pv)) this.renderPage(pv);
      else this.paintOverlay(pv);
    }
  }

  private isNearViewport(pv: PageView): boolean {
    const margin = this.el.clientHeight;
    const rect = pv.el.getBoundingClientRect();
    const root = this.el.getBoundingClientRect();
    return rect.bottom >= root.top - margin && rect.top <= root.bottom + margin;
  }

  private renderPage(pv: PageView): void {
    pv.render()
      .then(() => this.paintOverlay(pv))
      .catch((err: unknown) => console.error(`ページ ${pv.pageIndex + 1} の描画に失敗しました`, err));
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
