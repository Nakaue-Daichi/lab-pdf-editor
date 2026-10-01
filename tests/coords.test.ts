import { describe, expect, it } from 'vitest';
import { clientRectsToPdfRects, mergeLineRects, pdfPointToPercent, pdfRectToCss, pdfRectToPercent, type ViewportLike } from '../src/viewer/coords';

// scale 2・A4 縦（高さ 842pt）・回転なしの viewport を模した最小実装
const PAGE_H = 842;
const viewport: ViewportLike = {
  convertToPdfPoint: (x, y) => [x / 2, PAGE_H - y / 2],
  convertToViewportPoint: (x, y) => [x * 2, (PAGE_H - y) * 2],
};

describe('clientRectsToPdfRects', () => {
  it('converts a client rect to a PDF rect using the page origin and viewport', () => {
    const rects = clientRectsToPdfRects([{ left: 110, top: 60, width: 100, height: 20 }], { left: 10, top: 20 }, viewport);
    expect(rects).toEqual([[50, 812, 100, 822]]);
  });

  it('drops empty rects', () => {
    const rects = clientRectsToPdfRects([{ left: 110, top: 60, width: 0, height: 20 }], { left: 10, top: 20 }, viewport);
    expect(rects).toEqual([]);
  });

  it('merges fragments of the same line', () => {
    const rects = clientRectsToPdfRects(
      [
        { left: 110, top: 60, width: 100, height: 20 },
        { left: 211, top: 60, width: 99, height: 20 },
        { left: 110, top: 100, width: 50, height: 20 },
      ],
      { left: 10, top: 20 },
      viewport,
    );
    expect(rects).toEqual([
      [50, 812, 150, 822],
      [50, 792, 75, 802],
    ]);
  });
});

describe('mergeLineRects', () => {
  it('keeps rects on different lines apart, upper line first', () => {
    expect(mergeLineRects([[0, 0, 10, 10], [0, 20, 10, 30]])).toEqual([[0, 20, 10, 30], [0, 0, 10, 10]]);
  });
  it('unions overlapping rects on one line', () => {
    expect(mergeLineRects([[0, 0, 10, 10], [5, 1, 20, 9]])).toEqual([[0, 0, 20, 10]]);
  });
});

describe('pdfRectToCss', () => {
  it('returns normalized left/top/width/height in CSS pixels', () => {
    expect(pdfRectToCss([50, 812, 100, 822], viewport)).toEqual({ left: 100, top: 40, width: 100, height: 20 });
  });
});

describe('pdfRectToPercent / pdfPointToPercent', () => {
  // 上の viewport に寸法（A4 幅 595pt・高さ 842pt の 2 倍）を足したもの
  const sized = { ...viewport, width: 1190, height: 1684 };

  it('returns the rect as percentages of the page size', () => {
    const r = pdfRectToPercent([50, 812, 100, 822], sized);
    expect(r.left).toBeCloseTo((100 / 1190) * 100);
    expect(r.top).toBeCloseTo((40 / 1684) * 100);
    expect(r.width).toBeCloseTo((100 / 1190) * 100);
    expect(r.height).toBeCloseTo((20 / 1684) * 100);
  });

  it('stays the same when the page is drawn at another scale', () => {
    const half: ViewportLike & { width: number; height: number } = {
      convertToPdfPoint: (x, y) => [x, PAGE_H - y],
      convertToViewportPoint: (x, y) => [x, PAGE_H - y],
      width: 595,
      height: 842,
    };
    const a = pdfRectToPercent([50, 812, 100, 822], sized);
    const b = pdfRectToPercent([50, 812, 100, 822], half);
    expect(b.left).toBeCloseTo(a.left);
    expect(b.top).toBeCloseTo(a.top);
    expect(b.width).toBeCloseTo(a.width);
    expect(b.height).toBeCloseTo(a.height);
  });

  it('converts a point the same way', () => {
    const p = pdfPointToPercent([50, 812], sized);
    expect(p.left).toBeCloseTo((100 / 1190) * 100);
    expect(p.top).toBeCloseTo((60 / 1684) * 100);
  });
});
