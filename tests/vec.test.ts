import { describe, expect, it } from 'vitest';
import { angleDeg, unit } from '../engine/index.ts';

describe('vector helpers', () => {
  it('normalises a vector and refuses a zero vector instead of returning NaNs', () => {
    expect(unit([2, 0, 0])).toEqual([1, 0, 0]);
    expect(() => unit([0, 0, 0])).toThrow('zero vector');
    expect(angleDeg([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 10);
  });
});
