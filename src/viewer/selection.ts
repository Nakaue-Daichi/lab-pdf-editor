// 文字選択を監視し、選択範囲を PDF ユーザ空間の矩形に変換する。
// マウスは mouseup で確定する。指（タッチ）は長押し・ハンドル操作のあとに mouseup も touchend も来ない（iOS・Android とも）ので、
// selectionchange が SELECTION_SETTLE_MS 止まったら確定とみなす（PDF.js #17923・Hypothesis の SelectionObserver と同じ考え方）。
import type { Rect } from '../model/types';
import { clientRectsToPdfRects } from './coords';
import type { PageView } from './PageView';

/** 指での選択が止まってから確定とみなすまでの時間。ハンドルを動かす途中で止まるたびにボタンが点滅しない長さ */
export const SELECTION_SETTLE_MS = 300;

export interface TextSelection {
  pageIndex: number;
  quads: Rect[];
  quote: string;
  /** 選択範囲の最後の矩形（ボタンを置く位置の目安・client 座標） */
  lastRect: DOMRect;
}

/**
 * 選択範囲のうち文字（テキストノード）の部分の矩形。range.getClientRects() は丸ごと選ばれた要素の箱も返すので、
 * 選択補助の .endOfContent（文字層と同じ大きさの空ブロック）が範囲に入ると、ページ全体の矩形が混ざってしまう。
 */
function textRects(range: Range): DOMRect[] {
  const common = range.commonAncestorContainer;
  if (common.nodeType === Node.TEXT_NODE) return Array.from(range.getClientRects());
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    out.push(...Array.from(part.getClientRects()));
  }
  return out;
}

/**
 * container 内の文字選択が確定するたびに onChange を呼ぶ（選択が無くなれば null）。
 * ページをまたぐ選択は、選択が始まったページの分だけを採用する。
 */
export function watchTextSelection(
  container: HTMLElement,
  pageViewFor: (el: Element) => PageView | undefined,
  onChange: (selection: TextSelection | null) => void,
): () => void {
  let settleTimer = 0;
  let mouseDown = false;

  const evaluate = (): void => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return onChange(null);
    const range = sel.getRangeAt(0);
    const startNode = range.startContainer;
    const startEl = startNode instanceof Element ? startNode : startNode.parentElement;
    if (!startEl || !container.contains(startEl)) return onChange(null);
    const pageView = pageViewFor(startEl);
    if (!pageView) return onChange(null);

    // 原点はページ要素。文字層は回転ページで CSS 回転されるので、その矩形を原点に使わない
    const pageRect = pageView.el.getBoundingClientRect();
    const tolerance = 1;
    const rects = textRects(range).filter(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.left >= pageRect.left - tolerance &&
        r.right <= pageRect.right + tolerance &&
        r.top >= pageRect.top - tolerance &&
        r.bottom <= pageRect.bottom + tolerance,
    );
    const quads = clientRectsToPdfRects(rects, { left: pageRect.left, top: pageRect.top }, pageView.viewport);
    if (quads.length === 0) return onChange(null);
    const lastRect = rects[rects.length - 1] as DOMRect;
    onChange({ pageIndex: pageView.pageIndex, quads, quote: sel.toString().replace(/\s+/g, ' ').trim(), lastRect });
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) mouseDown = true;
  };
  const onMouseUp = (): void => {
    mouseDown = false;
    window.clearTimeout(settleTimer);
    window.setTimeout(evaluate, 0);
  };
  const onWindowMouseUp = (): void => {
    mouseDown = false;
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.shiftKey || event.key === 'Shift') evaluate();
  };
  const onSelectionChange = (): void => {
    window.clearTimeout(settleTimer);
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) {
      onChange(null);
      return;
    }
    // マウスでドラッグしている間は mouseup を待つ（デスクトップの動きは今まで通り）
    if (mouseDown) return;
    settleTimer = window.setTimeout(evaluate, SELECTION_SETTLE_MS);
  };
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mouseup', onWindowMouseUp);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('selectionchange', onSelectionChange);
  return () => {
    window.clearTimeout(settleTimer);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('mouseup', onWindowMouseUp);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('selectionchange', onSelectionChange);
  };
}
