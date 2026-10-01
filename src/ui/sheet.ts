// ボトムシートの段の判定（純関数）。DOM の操作は src/ui/CommentSheet.ts。

export type SheetState = 'closed' | 'half' | 'full';

/** 払ったとみなす速さ（px/ms）。これより速く離したら、払った向きの隣の段へ */
export const FLING_VELOCITY = 0.5;

/**
 * 指を離したときに吸い付く段。
 * @param height 離した時点のシートの高さ（px）
 * @param velocity 離す直前の高さの変化の速さ（px/ms、広げる向きが正）
 */
export function snapSheet(height: number, velocity: number, halfHeight: number, fullHeight: number): SheetState {
  const stops: [SheetState, number][] = [
    ['closed', 0],
    ['half', halfHeight],
    ['full', fullHeight],
  ];
  if (velocity >= FLING_VELOCITY) return stops.find(([, h]) => h > height + 1)?.[0] ?? 'full';
  if (velocity <= -FLING_VELOCITY) return [...stops].reverse().find(([, h]) => h < height - 1)?.[0] ?? 'closed';
  let nearest = stops[0] as [SheetState, number];
  for (const stop of stops) if (Math.abs(stop[1] - height) < Math.abs(nearest[1] - height)) nearest = stop;
  return nearest[0];
}
