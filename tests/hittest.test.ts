import { describe, expect, it } from 'vitest';
import { hitTestHighlight } from '../src/viewer/hittest';
import { mkComment } from './helpers';

describe('hitTestHighlight', () => {
  const big = mkComment({ id: 'big', pageIndex: 0, anchor: { kind: 'highlight', quads: [[0, 0, 100, 100]] } });
  const small = mkComment({ id: 'small', pageIndex: 0, anchor: { kind: 'highlight', quads: [[40, 40, 60, 60]] } });
  const otherPage = mkComment({ id: 'p2', pageIndex: 1, anchor: { kind: 'highlight', quads: [[0, 0, 100, 100]] } });
  const note = mkComment({ id: 'note', pageIndex: 0, anchor: { kind: 'note', point: [50, 50] } });

  it('returns the highlight whose quad contains the point', () => {
    expect(hitTestHighlight([big], 0, [10, 10])?.id).toBe('big');
  });
  it('returns undefined when nothing is under the point or the page differs', () => {
    expect(hitTestHighlight([big], 0, [150, 150])).toBeUndefined();
    expect(hitTestHighlight([otherPage], 0, [10, 10])).toBeUndefined();
  });
  it('prefers the smallest containing highlight and ignores notes', () => {
    expect(hitTestHighlight([big, small, note], 0, [50, 50])?.id).toBe('small');
  });

  describe('with a tolerance (touch)', () => {
    const line = mkComment({ id: 'line', pageIndex: 0, anchor: { kind: 'highlight', quads: [[0, 0, 100, 10]] } });

    it('picks up a highlight within the tolerance, but not beyond it', () => {
      expect(hitTestHighlight([line], 0, [50, 14], 5)?.id).toBe('line');
      expect(hitTestHighlight([line], 0, [50, 14], 3)).toBeUndefined();
      expect(hitTestHighlight([line], 0, [50, 14])).toBeUndefined();
    });

    it('prefers a highlight that contains the point over a nearby one', () => {
      const near = mkComment({ id: 'near', pageIndex: 0, anchor: { kind: 'highlight', quads: [[102, 40, 120, 60]] } });
      expect(hitTestHighlight([near, big], 0, [100, 50], 10)?.id).toBe('big');
    });

    it('prefers the nearer of two nearby highlights', () => {
      const a = mkComment({ id: 'a', pageIndex: 0, anchor: { kind: 'highlight', quads: [[0, 0, 10, 10]] } });
      const b = mkComment({ id: 'b', pageIndex: 0, anchor: { kind: 'highlight', quads: [[20, 0, 30, 10]] } });
      expect(hitTestHighlight([b, a], 0, [14, 5], 10)?.id).toBe('a');
      expect(hitTestHighlight([a, b], 0, [17, 5], 10)?.id).toBe('b');
    });
  });
});
