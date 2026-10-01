// CSS 座標（ブラウザの選択範囲）と PDF ユーザ空間の相互変換。PDF.js の PageViewport に依存する部分だけ注入する。
import type { Rect } from '../model/types';

export interface ViewportLike {
  /** ビューポート座標 (x, y) → PDF ユーザ空間 [x, y] */
  convertToPdfPoint(x: number, y: number): number[];
  /** PDF ユーザ空間 (x, y) → ビューポート座標 [x, y] */
  convertToViewportPoint(x: number, y: number): number[];
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 同じ行の断片とみなす水平方向の隙間（pt） */
const LINE_GAP = 2;

/**
 * 選択範囲の client rect 群を PDF ユーザ空間の矩形にする。
 * @param pageOrigin ページ要素（ビューポートの原点）の client 座標
 */
export function clientRectsToPdfRects(rects: Iterable<RectLike>, pageOrigin: { left: number; top: number }, viewport: ViewportLike): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    const x1 = r.left - pageOrigin.left;
    const y1 = r.top - pageOrigin.top;
    const [px1, py1] = viewport.convertToPdfPoint(x1, y1) as [number, number];
    const [px2, py2] = viewport.convertToPdfPoint(x1 + r.width, y1 + r.height) as [number, number];
    out.push([Math.min(px1, px2), Math.min(py1, py2), Math.max(px1, px2), Math.max(py1, py2)]);
  }
  return mergeLineRects(out);
}

function sameLine(a: Rect, b: Rect): boolean {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const smaller = Math.min(a[3] - a[1], b[3] - b[1]);
  return smaller > 0 && overlap >= smaller * 0.5;
}

/** 同じ行の隣接・重複する矩形を結合する。結果は上の行から、左から順。 */
export function mergeLineRects(rects: readonly Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && sameLine(last, r) && r[0] <= last[2] + LINE_GAP) {
      last[0] = Math.min(last[0], r[0]);
      last[1] = Math.min(last[1], r[1]);
      last[2] = Math.max(last[2], r[2]);
      last[3] = Math.max(last[3], r[3]);
    } else {
      out.push([r[0], r[1], r[2], r[3]]);
    }
  }
  return out;
}

/** PDF ユーザ空間の矩形 → ページ要素内の CSS 位置とサイズ */
export function pdfRectToCss(rect: Rect, viewport: ViewportLike): { left: number; top: number; width: number; height: number } {
  // 回転ページでは対角の 2 点が入れ替わるので、変換後に min/max で正規化する
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number];
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number];
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** 寸法（回転後の CSS px）も持つビューポート */
export interface SizedViewportLike extends ViewportLike {
  width: number;
  height: number;
}

/**
 * PDF ユーザ空間の矩形 → ページに対する %（left/top/width/height）。
 * % で置いた要素は、倍率が変わってページの寸法だけ変わったとき（ピンチ中）も置き直さずに追従する。
 */
export function pdfRectToPercent(rect: Rect, viewport: SizedViewportLike): { left: number; top: number; width: number; height: number } {
  const css = pdfRectToCss(rect, viewport);
  return {
    left: (css.left / viewport.width) * 100,
    top: (css.top / viewport.height) * 100,
    width: (css.width / viewport.width) * 100,
    height: (css.height / viewport.height) * 100,
  };
}

/** PDF ユーザ空間の点 → ページに対する % */
export function pdfPointToPercent([x, y]: [number, number], viewport: SizedViewportLike): { left: number; top: number } {
  const [vx, vy] = viewport.convertToViewportPoint(x, y) as [number, number];
  return { left: (vx / viewport.width) * 100, top: (vy / viewport.height) * 100 };
}
