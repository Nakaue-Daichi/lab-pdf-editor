// 描画の上限（純関数）。スマホ（特に iOS）はキャンバスの総量が多すぎるとタブごと落ちるので、
// 1 枚の画素数を抑え、表示から遠いページのキャンバスを捨てる。数値は PDF.js のビューアに揃えた
// （web/app_options.js の maxCanvasPixels: 既定 2^25・モバイル 5,242,880、web/pdf_viewer.js の DEFAULT_CACHE_SIZE = 10）。

/** キャンバス 1 枚の画素数の上限（デスクトップ・指で操作する端末） */
export const MAX_CANVAS_PIXELS = 33_554_432;
export const MAX_CANVAS_PIXELS_TOUCH = 5_242_880;
/** キャンバスの一辺の上限（古い iOS は 4,096、それ以外の主要ブラウザは 16,384 以上） */
export const MAX_CANVAS_DIM = 16_384;
export const MAX_CANVAS_DIM_TOUCH = 4_096;
/** 描画を残しておくページ数の基本値 */
export const RENDER_CACHE_BASE = 10;
export const RENDER_CACHE_BASE_TOUCH = 6;

/**
 * 描くときの解像度の倍率。ふだんは devicePixelRatio。画素数か一辺が上限を超えるなら下げる
 * （CSS では同じ大きさに伸ばすので少しぼやけるが、描けずに白くなる・落ちるよりよい）。
 */
export function outputScaleFor(cssWidth: number, cssHeight: number, dpr: number, maxPixels: number, maxDim: number): number {
  let scale = dpr;
  const area = cssWidth * cssHeight;
  if (area > 0 && area * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / area);
  const longest = Math.max(cssWidth, cssHeight);
  if (longest > 0 && longest * scale > maxDim) scale = maxDim / longest;
  return Math.max(0.01, scale);
}

/** 描画を残すページ数。見えているページが多い（縮小している）ときはそれ以上に */
export function renderCacheSize(visibleCount: number, base: number): number {
  return Math.max(base, 2 * visibleCount + 1);
}

/** 描画済みのページのうち捨てるもの（今のページから遠い順）。今のページと keep（表示付近）は捨てない */
export function pagesToRelease(rendered: readonly number[], current: number, limit: number, keep: ReadonlySet<number>): number[] {
  if (rendered.length <= limit) return [];
  return rendered
    .filter((i) => i !== current && !keep.has(i))
    .sort((a, b) => Math.abs(b - current) - Math.abs(a - current))
    .slice(0, rendered.length - limit);
}

/** ページの上端の位置（昇順）から、probe の位置にあるページの番号（probe 以上で最後に始まるページ） */
export function pageIndexAt(tops: readonly number[], probe: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((tops[mid] as number) <= probe) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
