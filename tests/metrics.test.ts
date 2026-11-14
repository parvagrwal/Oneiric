import { describe, expect, it } from 'vitest';
import { metrics, nextClock, series, smoothSkyline, HOUR_MS } from '../engine/index.ts';
import { SPIN_PERIOD_H as P, SPIN_RATE_DEG_PER_H as RATE, T2030, spinSite, spinningTable } from './helpers.ts';

// Synthetic cycle of 720 h: at a site on the equator the Sun is overhead at hour 0, sets at 180 h, rises at 540 h.
// Earth turns the same way, a quarter cycle (180 h) later than the Sun. Smooth sphere, 2 m high.
const table = spinningTable();
const site = { frame: spinSite(), sky: smoothSkyline(2) };
const ser = series(table, site, T2030, T2030 + 2 * P * HOUR_MS, 10);
const cycle = metrics(ser, T2030, T2030 + P * HOUR_MS);
const edge = 0.354 / RATE; // hours the Sun takes to move from the horizon to fully hidden: disc radius 0.267 + dip 0.087 degrees
// The disc is sampled by 64 points, so its edge is known only to about 0.03 degrees; each edge may move by that much, plus 1 minute of refinement.
const edgeTol = 0.03 / RATE + 1 / 60;

describe('metrics on a synthetic cycle with a known answer', () => {
  it('sunlit share is 50 percent and the dark gap is half a cycle minus the disc width, refined to a minute', () => {
    expect(cycle.sunlitPct).toBeGreaterThan(49.8);
    expect(cycle.sunlitPct).toBeLessThan(50.3);
    expect(Math.abs(cycle.longestDarkGapH - (P / 2 - 2 * edge))).toBeLessThan(2 * edgeTol);
  });
  it('Earth is visible about half the time; the link gap is half a cycle; overlap is a quarter', () => {
    expect(cycle.earthVisiblePct).toBeGreaterThan(49.5);
    expect(cycle.earthVisiblePct).toBeLessThan(50.2);
    expect(Math.abs(cycle.longestLinkGapH - P / 2)).toBeLessThan(1.5); // parallax of Earth from the surface shifts its edges by about 0.7 h
    expect(cycle.overlapPct).toBeGreaterThan(24.5);
    expect(cycle.overlapPct).toBeLessThan(25.5);
  });
  it('energy matches the analytic integral for the tracking array and the horizontal deck', () => {
    const analytic = (1361 * P) / Math.PI / 1000; // 1361 W/m2 x (2 / omega = P / pi) hours, at 1 AU
    expect(Math.abs(cycle.energyKWhM2.sunTrackingVertical / analytic - 1)).toBeLessThan(0.005);
    expect(Math.abs(cycle.energyKWhM2.horizontalDeck / analytic - 1)).toBeLessThan(0.005);
  });
  it('the best fixed vertical facing is east or west, the metric prints which, and it gets half the tracking energy', () => {
    expect([90, 270]).toContain(cycle.fixedVerticalBestFacingDeg);
    expect(Math.abs(cycle.energyKWhM2.fixedVertical / (cycle.energyKWhM2.sunTrackingVertical / 2) - 1)).toBeLessThan(0.02);
  });
  it('carries the grade and terrain of the skyline it used, so a smooth sphere can never look like terrain', () => {
    expect(cycle.grade).toBe('D');
    expect(cycle.terrain).toBe('none (smooth sphere)');
  });
  it('rejects windows that do not line up with the series steps or lie outside it', () => {
    expect(() => metrics(ser, T2030 + 1000, T2030 + P * HOUR_MS)).toThrow(RangeError);
    expect(() => metrics(ser, T2030 - 600_000, T2030 + HOUR_MS)).toThrow(RangeError);
    expect(() => metrics(ser, T2030 + HOUR_MS, T2030 + HOUR_MS)).toThrow(RangeError);
  });
  it('a gap that runs into the window edge is cut at the edge, not extended', () => {
    const w = metrics(ser, T2030 + 380 * HOUR_MS, T2030 + 390 * HOUR_MS);
    expect(w.longestDarkGapH).toBeCloseTo(10, 5);
    expect(w.sunlitPct).toBe(0);
  });
  it('a window that starts mid-gap reports only the part of the gap inside the window', () => {
    const w = metrics(ser, T2030 + 500 * HOUR_MS, T2030 + 600 * HOUR_MS);
    // Sun rises (disc first visible) at 540 - edge hours.
    expect(Math.abs(w.longestDarkGapH - (540 - edge - 500))).toBeLessThan(edgeTol);
  });
});

describe('clocks', () => {
  it('finds the next sunset to within a minute or two of the analytic time', () => {
    const c = nextClock(ser, 'sunset', T2030 + HOUR_MS, T2030 + 400 * HOUR_MS);
    expect(c.status).toBe('at');
    expect(Math.abs(c.tMs! - (T2030 + (P / 4 + edge) * HOUR_MS))).toBeLessThan(2 * 60_000);
  });
  it('says already when the Sun is down, and none when nothing happens before the limit', () => {
    expect(nextClock(ser, 'sunset', T2030 + 250 * HOUR_MS, T2030 + 400 * HOUR_MS).status).toBe('already');
    expect(nextClock(ser, 'sunset', T2030 + HOUR_MS, T2030 + 50 * HOUR_MS).status).toBe('none');
  });
  it('finds the next Earthset', () => {
    const c = nextClock(ser, 'earthset', T2030 + HOUR_MS, T2030 + 500 * HOUR_MS);
    expect(c.status).toBe('at');
    expect(Math.abs((c.tMs! - T2030) / HOUR_MS - P / 2)).toBeLessThan(1);
  });
});
