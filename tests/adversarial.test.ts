import { describe, expect, it } from 'vitest';
import { HOUR_MS, metrics, series, smoothSiteFrame, smoothSkyline, PRESETS, checkRules } from '../engine/index.ts';
import { loadTable } from '../pipeline/direction-check.ts';

const table = loadTable();
const run = (lat: number, lon: number, h: number, t0: number, days: number) =>
  series(table, { frame: smoothSiteFrame(lat, lon, h), sky: smoothSkyline(h) }, t0, t0 + days * 24 * HOUR_MS, 10);

describe('adversarial sites and dates (smooth sphere, so grade D)', () => {
  it('a site on the far side never sees Earth, over a full year', () => {
    const s = run(0, 180, 2, Date.UTC(2027, 0, 1), 365);
    expect(s.earthVis.reduce((a, b) => a + b, 0)).toBe(0);
    const m = metrics(s, s.t0Ms, s.t0Ms + 365 * 24 * HOUR_MS);
    expect(m.earthVisiblePct).toBe(0);
    expect(m.grade).toBe('D');
  });
  it('a near-side centre site always sees Earth, with the Sun lit about half the time', () => {
    const s = run(0, 0, 2, Date.UTC(2027, 0, 1), 60);
    const m = metrics(s, s.t0Ms, s.t0Ms + 59 * 24 * HOUR_MS);
    expect(m.earthVisiblePct).toBe(100);
    expect(m.sunlitPct).toBeGreaterThan(45);
    expect(m.sunlitPct).toBeLessThan(55);
  });
  it('the south pole itself gives finite numbers; the Sun never rises more than about 1.6 degrees', () => {
    const s = run(-90, 0, 2, Date.UTC(2027, 0, 1), 60);
    expect(s.sunEl.every(Number.isFinite)).toBe(true);
    expect(Math.max(...s.sunEl)).toBeLessThan(1.7);
    expect(Math.min(...s.sunEl)).toBeGreaterThan(-1.7);
  });
  it('a stay that crosses a year boundary works and matches the same stay cut in two', () => {
    const t0 = Date.UTC(2027, 11, 28);
    const t1 = Date.UTC(2028, 0, 4);
    const whole = series(table, { frame: smoothSiteFrame(-89.45, 222.69, 2), sky: smoothSkyline(2) }, t0, t1, 10);
    const mid = Date.UTC(2028, 0, 1);
    const a = metrics(whole, t0, mid);
    const b = metrics(whole, mid, t1);
    const all = metrics(whole, t0, t1);
    const hoursA = a.hours, hoursB = b.hours;
    expect((a.sunlitPct * hoursA + b.sunlitPct * hoursB) / (hoursA + hoursB)).toBeCloseTo(all.sunlitPct, 8);
  });
  it('0 m, 2 m and 20 m heights are accepted and a taller mast never sees less of the horizon', () => {
    const t0 = Date.UTC(2027, 0, 1);
    const get = (h: number) => { const s = run(-89.45, 222.69, h, t0, 30); return metrics(s, t0, t0 + 30 * 24 * HOUR_MS); };
    const m0 = get(0), m2 = get(2), m20 = get(20);
    expect(m20.sunlitPct).toBeGreaterThanOrEqual(m2.sunlitPct - 1e-9);
    expect(m2.sunlitPct).toBeGreaterThanOrEqual(m0.sunlitPct - 1e-9);
    expect(m20.heightM).toBe(20);
  });
  it('the rules table applies to real metrics without error', () => {
    const t0 = Date.UTC(2027, 0, 1);
    const s = run(-89.45, 222.69, 2, t0, 7);
    expect(checkRules(metrics(s, t0, t0 + 6.5 * 24 * HOUR_MS), PRESETS.sortie)).toHaveLength(4);
  });
});
