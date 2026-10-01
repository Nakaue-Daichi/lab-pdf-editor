// クリック位置（PDF ユーザ空間）にあるハイライトを探す。重なっていれば小さい方（内側）を返す。
// 指で押すときは tolerance（pt）以内の近くのハイライトも拾う。中に入っているものが優先で、次に近いもの。
import type { Comment, Rect } from '../model/types';

/** 点から矩形までの距離（中なら 0） */
function distanceToRect([x, y]: [number, number], [llx, lly, urx, ury]: Rect): number {
  return Math.hypot(Math.max(llx - x, 0, x - urx), Math.max(lly - y, 0, y - ury));
}

export function hitTestHighlight(
  comments: readonly Comment[],
  pageIndex: number,
  point: [number, number],
  tolerance = 0,
): Comment | undefined {
  let best: Comment | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const c of comments) {
    if (c.pageIndex !== pageIndex || c.anchor.kind !== 'highlight') continue;
    for (const quad of c.anchor.quads) {
      const distance = distanceToRect(point, quad);
      if (distance > tolerance) continue;
      const area = (quad[2] - quad[0]) * (quad[3] - quad[1]);
      if (distance < bestDistance || (distance === bestDistance && area < bestArea)) {
        bestDistance = distance;
        bestArea = area;
        best = c;
      }
    }
  }
  return best;
}
