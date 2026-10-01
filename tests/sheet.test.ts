import { describe, expect, it } from 'vitest';
import { FLING_VELOCITY, snapSheet } from '../src/ui/sheet';

// 使える高さ 600px のシート: 半分 300px・全高 600px
const HALF = 300;
const FULL = 600;

describe('snapSheet', () => {
  it('snaps to the nearest stop when released slowly', () => {
    expect(snapSheet(280, 0, HALF, FULL)).toBe('half');
    expect(snapSheet(520, 0.1, HALF, FULL)).toBe('full');
    expect(snapSheet(90, -0.1, HALF, FULL)).toBe('closed');
  });

  it('moves one stop in the direction of a fast fling', () => {
    const fast = FLING_VELOCITY + 0.1;
    expect(snapSheet(HALF, fast, HALF, FULL)).toBe('full');
    expect(snapSheet(HALF, -fast, HALF, FULL)).toBe('closed');
    expect(snapSheet(FULL, -fast, HALF, FULL)).toBe('half');
    expect(snapSheet(FULL, fast, HALF, FULL)).toBe('full');
  });

  it('flings to the next stop beyond the current height when between stops', () => {
    const fast = FLING_VELOCITY + 0.1;
    expect(snapSheet(420, fast, HALF, FULL)).toBe('full');
    expect(snapSheet(420, -fast, HALF, FULL)).toBe('half');
    expect(snapSheet(150, -fast, HALF, FULL)).toBe('closed');
  });
});
