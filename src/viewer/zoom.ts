// 表示倍率の計算（純関数）。百分率は 96dpi 換算（100% = PDF の 1pt を 1.333 CSS px で描く）。
// 倍率を変えても「指の間（または表示の中央）にあった点」が同じ画面位置に残るよう、
// その点を「ページ番号とページ内の割合」で覚えておき（anchorAt）、寸法を変えた後のスクロール量を求める（scrollForAnchor）。

export const CSS_PX_PER_PT = 96 / 72;
/** 倍率（scale）の下限・上限。上限は 300% */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export function percentToScale(percent: number): number {
  return (percent / 100) * CSS_PX_PER_PT;
}

export function scaleToPercent(scale: number): number {
  return Math.round((scale / CSS_PX_PER_PT) * 100);
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** ページ要素の、スクロールする中身の中での位置と寸法（CSS px） */
export interface PageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Anchor {
  index: number;
  /** ページの左端 0・右端 1 */
  fx: number;
  /** ページの上端 0・下端 1 */
  fy: number;
}

/** 中身の座標 (x, y) にあるページと、ページ内の割合。ページの間や外なら上下に最も近いページ */
export function anchorAt(pages: readonly PageBox[], x: number, y: number): Anchor | null {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  pages.forEach((p, i) => {
    const distance = y < p.top ? p.top - y : y > p.top + p.height ? y - (p.top + p.height) : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  const page = pages[best];
  if (!page) return null;
  return { index: best, fx: (x - page.left) / page.width, fy: (y - page.top) / page.height };
}

/** 寸法を変えた後のページで、anchor の点が表示領域の (viewX, viewY) に来るスクロール量 */
export function scrollForAnchor(page: PageBox, anchor: Pick<Anchor, 'fx' | 'fy'>, viewX: number, viewY: number): { left: number; top: number } {
  return { left: page.left + anchor.fx * page.width - viewX, top: page.top + anchor.fy * page.height - viewY };
}
