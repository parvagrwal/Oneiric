import { describe, expect, it } from 'vitest';
import { angleDeg, ephemAt, ROW } from '../engine/index.ts';
import { loadTable } from '../pipeline/direction-check.ts';
import { syntheticTable } from './helpers.ts';

describe('ephemeris interpolation', () => {
  it('returns the stored row at an hourly node and the midpoint halfway between nodes', () => {
    const table = syntheticTable((h) => ({ sun: [1e8 + h * 1000, 0, 0], earth: [3.8e5, h * 10, 0] }));
    const t0 = Date.UTC(2030, 0, 1);
    expect(ephemAt(table, t0 + 5 * 3_600_000).sun[0]).toBeCloseTo(1e8 + 5000, -1);
    expect(ephemAt(table, t0 + 5.5 * 3_600_000).earth[1]).toBeCloseTo(55, 3);
  });
  it('refuses times outside the table instead of extrapolating', () => {
    const table = loadTable();
    expect(() => ephemAt(table, Date.UTC(2022, 11, 31, 23))).toThrow(RangeError);
    expect(() => ephemAt(table, Date.UTC(2041, 0, 1, 1))).toThrow(RangeError);
    expect(() => ephemAt(table, NaN)).toThrow(RangeError);
    expect(() => ephemAt(table, Date.UTC(2023, 0, 1))).not.toThrow();
    expect(() => ephemAt(table, Date.UTC(2041, 0, 1))).not.toThrow(); // last stored row
  });
  it('is continuous across a year boundary', () => {
    const table = loadTable();
    const a = ephemAt(table, Date.UTC(2027, 0, 1) - 60_000);
    const b = ephemAt(table, Date.UTC(2027, 0, 1) + 60_000);
    expect(angleDeg(a.sun, b.sun)).toBeLessThan(0.02); // the Sun moves about 0.55 degrees an hour
    expect(angleDeg(a.earth, b.earth)).toBeLessThan(0.01);
  });
  it('real table files have whole rows and unit vectors', () => {
    const table = loadTable();
    for (const [, d] of table.years) {
      expect(d.length % ROW).toBe(0);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 5);
    }
  });
  it('puts the sub-solar point near +90 degrees E at a known first quarter', () => {
    // First quarter 2026 Jan 26 04:47 UTC, US Naval Observatory:
    // https://aa.usno.navy.mil/calculated/moon/phases?date=2026-01-01&format=p&nump=24
    // At first quarter the Sun stands 90 degrees east of the sub-Earth point, so the
    // sub-solar longitude is +90. It drifts about half a degree an hour, so 5 degrees
    // of slack still catches a sign or frame error, which would be 90 degrees or more.
    const table = loadTable();
    const sun = ephemAt(table, Date.UTC(2026, 0, 26, 4, 47)).sun;
    const lon = ((Math.atan2(sun[1], sun[0]) * 180) / Math.PI + 360) % 360;
    expect(Math.abs(lon - 90)).toBeLessThan(5);
  });
});
