import { describe, expect, it } from 'vitest';
import { anchorAt, clampScale, MAX_SCALE, MIN_SCALE, percentToScale, scaleToPercent, scrollForAnchor } from '../src/viewer/zoom';

describe('scale and percent', () => {
  it('converts between the 96dpi percentage and the PDF scale', () => {
    expect(percentToScale(100)).toBeCloseTo(96 / 72);
    expect(scaleToPercent(percentToScale(150))).toBe(150);
    expect(scaleToPercent(1)).toBe(75);
  });

  it('clamps the scale into the supported range', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

// 縦に並んだ 2 ページ（幅 400・高さ 500、間 16、上の余白 8）
const pages = [
  { left: 20, top: 8, width: 400, height: 500 },
  { left: 20, top: 524, width: 400, height: 500 },
];

describe('anchorAt', () => {
  it('finds the page under the point and the fractional position inside it', () => {
    expect(anchorAt(pages, 120, 258)).toEqual({ index: 0, fx: 0.25, fy: 0.5 });
    expect(anchorAt(pages, 420, 1024)).toEqual({ index: 1, fx: 1, fy: 1 });
  });

  it('uses the nearest page when the point falls in a gap or margin', () => {
    expect(anchorAt(pages, 120, 518)?.index).toBe(1);
    expect(anchorAt(pages, 120, 512)?.index).toBe(0);
    expect(anchorAt(pages, 120, 2)?.index).toBe(0);
  });

  it('returns null without pages', () => {
    expect(anchorAt([], 0, 0)).toBeNull();
  });
});

describe('scrollForAnchor', () => {
  it('scrolls so that the anchored point of the page lands at the given view position', () => {
    // 2 倍に広げたページの中央を、表示領域の (150, 300) に持ってくる
    const scaled = { left: 40, top: 1048, width: 800, height: 1000 };
    expect(scrollForAnchor(scaled, { fx: 0.5, fy: 0.5 }, 150, 300)).toEqual({ left: 290, top: 1248 });
  });

  it('keeps the point fixed through a zoom (round trip with anchorAt)', () => {
    const before = pages[1]!;
    const anchor = anchorAt(pages, 220, 774)!;
    const after = { left: before.left * 2, top: before.top * 2, width: before.width * 2, height: before.height * 2 };
    const scroll = scrollForAnchor(after, anchor, 220, 774);
    expect(after.left + anchor.fx * after.width - scroll.left).toBeCloseTo(220);
    expect(after.top + anchor.fy * after.height - scroll.top).toBeCloseTo(774);
  });
});
