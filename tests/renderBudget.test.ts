import { describe, expect, it } from 'vitest';
import { outputScaleFor, pageIndexAt, pagesToRelease, renderCacheSize } from '../src/viewer/renderBudget';

describe('outputScaleFor', () => {
  it('uses the device pixel ratio when the canvas fits', () => {
    expect(outputScaleFor(400, 560, 3, 5_242_880, 4096)).toBe(3);
  });

  it('lowers the ratio so the canvas stays within the pixel budget', () => {
    const s = outputScaleFor(1600, 2263, 3, 5_242_880, 8192);
    expect(Math.floor(1600 * s) * Math.floor(2263 * s)).toBeLessThanOrEqual(5_242_880);
    expect(s).toBeCloseTo(1.2, 2);
  });

  it('also keeps the longest side within the maximum dimension', () => {
    const s = outputScaleFor(500, 3000, 2, 50_000_000, 4096);
    expect(3000 * s).toBeLessThanOrEqual(4096);
  });
});

describe('renderCacheSize', () => {
  it('keeps at least the base, and more when many pages are visible', () => {
    expect(renderCacheSize(1, 6)).toBe(6);
    expect(renderCacheSize(5, 6)).toBe(11);
  });
});

describe('pagesToRelease', () => {
  it('releases nothing while within the limit', () => {
    expect(pagesToRelease([0, 1, 2], 1, 6, new Set())).toEqual([]);
  });

  it('releases the pages farthest from the current one first', () => {
    expect(pagesToRelease([0, 1, 2, 3, 8, 9], 2, 4, new Set())).toEqual([9, 8]);
  });

  it('never releases pages near the viewport', () => {
    expect(pagesToRelease([0, 1, 2, 3, 4], 0, 2, new Set([3, 4]))).toEqual([2, 1]);
  });
});

describe('pageIndexAt', () => {
  const tops = [8, 524, 1040, 1556];
  it('returns the page whose top is the last one at or above the probe', () => {
    expect(pageIndexAt(tops, 0)).toBe(0);
    expect(pageIndexAt(tops, 600)).toBe(1);
    expect(pageIndexAt(tops, 1556)).toBe(3);
    expect(pageIndexAt(tops, 99999)).toBe(3);
  });
});
