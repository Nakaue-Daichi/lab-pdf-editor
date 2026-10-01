// 1 ページ分の描画: キャンバス（PDF.js）＋文字層（選択用）＋オーバーレイ（ハイライト・付箋アイコン）。
import { AnnotationMode, TextLayer, type PDFPageProxy, type PageViewport, type RenderTask } from 'pdfjs-dist';
import { outputScaleFor } from './renderBudget';
import { attachSelectionAssist, detachSelectionAssist } from './textSelectionAssist';

/** キャンバス 1 枚の上限（端末で変える。src/viewer/renderBudget.ts） */
export interface CanvasLimits {
  maxPixels: number;
  maxDim: number;
}

function freeCanvas(canvas: HTMLCanvasElement): void {
  // 画素のメモリを手放す（iOS はキャンバスの総量が多すぎるとタブが落ちる）
  canvas.width = 0;
  canvas.height = 0;
}

export class PageView {
  readonly el: HTMLDivElement;
  readonly textLayerEl: HTMLDivElement;
  readonly overlayEl: HTMLDivElement;
  viewport: PageViewport;
  private canvas: HTMLCanvasElement;
  private renderTask: RenderTask | null = null;
  private textLayer: TextLayer | null = null;
  private renderedScale = 0;
  private rendering: Promise<void> | null = null;
  /** release() のたびに進める。描画の途中で捨てられたら、その描画の結果を使わない */
  private generation = 0;

  constructor(
    readonly pageIndex: number,
    readonly page: PDFPageProxy,
    scale: number,
    private readonly limits: CanvasLimits,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pv-page';
    this.el.dataset.pageIndex = String(pageIndex);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-canvas';
    freeCanvas(this.canvas); // 描くまでは画素を持たない（既定の 300×150 を 100 ページ分抱えない）
    this.textLayerEl = document.createElement('div');
    this.textLayerEl.className = 'textLayer';
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'pv-overlay';
    this.el.append(this.canvas, this.textLayerEl, this.overlayEl);
    this.viewport = page.getViewport({ scale });
    this.applySize();
  }

  /** 倍率を変える。寸法だけすぐ変わり（今の絵は CSS で伸び縮みする）、描き直しは render() で */
  setScale(scale: number): void {
    this.viewport = this.page.getViewport({ scale });
    this.applySize();
  }

  private applySize(): void {
    const { width, height, scale, rotation } = this.viewport;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    // PDF.js の文字層 CSS と TextLayer が参照する変数。pdf_viewer.css は .pdfViewer .page に置くが、ここでは自前のページ要素に置く。
    // TextLayer は文字層の幅・高さを「回転前の寸法 × --total-scale-factor を --scale-round-x/y で丸めた値」に設定し、
    // data-main-rotation の CSS で層ごと回す。--scale-round-x/y が無いとこの宣言が無効になり、
    // /Rotate 付きページで文字層が本文からずれる（実測: 下に約 30px・左に約 19px）。
    this.el.style.setProperty('--scale-factor', String(scale));
    this.el.style.setProperty('--user-unit', '1');
    this.el.style.setProperty('--total-scale-factor', String(scale));
    this.el.style.setProperty('--scale-round-x', '1px');
    this.el.style.setProperty('--scale-round-y', '1px');
    this.el.dataset.rotation = String(rotation);
  }

  get needsRender(): boolean {
    return this.renderedScale !== this.viewport.scale;
  }

  /** 今の倍率で描き終えているか（一度も描いていない・捨てた後は false） */
  get isRendered(): boolean {
    return this.renderedScale > 0;
  }

  /** 現在の倍率で描く。描画中なら終わってから（倍率が変わっていれば）やり直す。 */
  async render(): Promise<void> {
    if (!this.needsRender) return;
    if (this.rendering) {
      await this.rendering;
      if (!this.needsRender) return;
    }
    this.rendering = this.doRender().finally(() => {
      this.rendering = null;
    });
    return this.rendering;
  }

  private async doRender(): Promise<void> {
    const viewport = this.viewport;
    const generation = this.generation;
    this.renderTask?.cancel();
    this.textLayer?.cancel();
    const dpr = window.devicePixelRatio || 1;
    const outputScale = outputScaleFor(viewport.width, viewport.height, dpr, this.limits.maxPixels, this.limits.maxDim);
    // 新しいキャンバスに描いてから差し替える（描き終えるまで今の絵を残し、拡大の直後に白く抜けないように）
    const canvas = document.createElement('canvas');
    canvas.className = 'pv-canvas';
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) return;

    // 既存注釈の見た目は描かない（AnnotationMode.DISABLE）。ハイライト・付箋は自前のオーバーレイで統一して描く。
    this.renderTask = this.page.render({
      canvas,
      canvasContext,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      annotationMode: AnnotationMode.DISABLE,
    });
    try {
      await this.renderTask.promise;
    } catch (err) {
      freeCanvas(canvas);
      if ((err as { name?: string }).name === 'RenderingCancelledException') return;
      throw err;
    }
    if (generation !== this.generation) {
      freeCanvas(canvas);
      return;
    }
    this.canvas.replaceWith(canvas);
    freeCanvas(this.canvas);
    this.canvas = canvas;

    detachSelectionAssist(this.textLayerEl);
    this.textLayerEl.replaceChildren();
    this.textLayer = new TextLayer({ textContentSource: this.page.streamTextContent(), container: this.textLayerEl, viewport });
    try {
      await this.textLayer.render();
    } catch (err) {
      if (generation !== this.generation) return; // 描画中に捨てられた（cancel で止まった）
      throw err;
    }
    if (generation !== this.generation) return;
    attachSelectionAssist(this.textLayerEl);
    this.renderedScale = viewport.scale;
  }

  /** 描いた絵と文字層を捨てる（遠くへスクロールしたページ）。表示に戻ってきたら描き直す */
  release(): void {
    this.generation += 1;
    this.renderTask?.cancel();
    this.textLayer?.cancel();
    this.renderTask = null;
    this.textLayer = null;
    detachSelectionAssist(this.textLayerEl);
    this.textLayerEl.replaceChildren();
    freeCanvas(this.canvas);
    this.renderedScale = 0;
  }

  destroy(): void {
    this.release();
    this.el.remove();
  }
}
