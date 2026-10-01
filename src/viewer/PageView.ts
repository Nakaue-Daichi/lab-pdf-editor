// 1 ページ分の描画: キャンバス（PDF.js）＋文字層（選択用）＋オーバーレイ（ハイライト・付箋アイコン）。
import { AnnotationMode, TextLayer, type PDFPageProxy, type PageViewport, type RenderTask } from 'pdfjs-dist';
import { attachSelectionAssist, detachSelectionAssist } from './textSelectionAssist';

export class PageView {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly textLayerEl: HTMLDivElement;
  readonly overlayEl: HTMLDivElement;
  viewport: PageViewport;
  private renderTask: RenderTask | null = null;
  private textLayer: TextLayer | null = null;
  private renderedScale = 0;
  private rendering: Promise<void> | null = null;

  constructor(
    readonly pageIndex: number,
    readonly page: PDFPageProxy,
    scale: number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pv-page';
    this.el.dataset.pageIndex = String(pageIndex);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pv-canvas';
    this.textLayerEl = document.createElement('div');
    this.textLayerEl.className = 'textLayer';
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'pv-overlay';
    this.el.append(this.canvas, this.textLayerEl, this.overlayEl);
    this.viewport = page.getViewport({ scale });
    this.applySize();
  }

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
    this.renderTask?.cancel();
    this.textLayer?.cancel();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(viewport.width * dpr);
    this.canvas.height = Math.floor(viewport.height * dpr);
    this.canvas.style.width = `${viewport.width}px`;
    this.canvas.style.height = `${viewport.height}px`;
    const canvasContext = this.canvas.getContext('2d');
    if (!canvasContext) return;

    // 既存注釈の見た目は描かない（AnnotationMode.DISABLE）。ハイライト・付箋は自前のオーバーレイで統一して描く。
    this.renderTask = this.page.render({
      canvas: this.canvas,
      canvasContext,
      viewport,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      annotationMode: AnnotationMode.DISABLE,
    });
    try {
      await this.renderTask.promise;
    } catch (err) {
      if ((err as { name?: string }).name === 'RenderingCancelledException') return;
      throw err;
    }

    detachSelectionAssist(this.textLayerEl);
    this.textLayerEl.replaceChildren();
    this.textLayer = new TextLayer({ textContentSource: this.page.streamTextContent(), container: this.textLayerEl, viewport });
    await this.textLayer.render();
    attachSelectionAssist(this.textLayerEl);
    this.renderedScale = viewport.scale;
  }

  destroy(): void {
    this.renderTask?.cancel();
    this.textLayer?.cancel();
    detachSelectionAssist(this.textLayerEl);
    this.el.remove();
  }
}
