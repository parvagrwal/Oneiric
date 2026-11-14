import { describe, expect, it } from 'vitest';
import { PRESETS, checkRules, slip, verdict, viableSeries, series, smoothSkyline, HOUR_MS, type Metrics, type Slip } from '../engine/index.ts';
import { T2030, spinSite, spinningTable } from './helpers.ts';

const good: Metrics = {
  windowStartMs: 0, windowEndMs: 1, hours: 156, sunlitPct: 97, longestDarkGapH: 2, earthVisiblePct: 95, longestLinkGapH: 3,
  overlapPct: 92, eclipses: [], energyKWhM2: { sunTrackingVertical: 1, fixedVertical: 1, horizontalDeck: 1 },
  fixedVerticalBestFacingDeg: 90, grade: 'B', terrain: 'LOLA 20 m test', heightM: 2,
};
const roomy: Slip = { viableAtChosen: true, lateDays: 5, earlyDays: 5, lateCensored: false, earlyCensored: false, nextWindow: null };
const sortie = PRESETS.sortie;

describe('verdict', () => {
  it('GO when every rule is met and the start can slip 3 days or more later; prints its reason, grade and terrain', () => {
    const v = verdict(good, sortie, roomy);
    expect(v.verdict).toBe('GO');
    expect(v.rule).toMatch(/Every rule is met/);
    expect(v.grade).toBe('B');
    expect(v.terrain).toBe('LOLA 20 m test');
    expect(v.presetLabel).toBe('illustrative, not agency requirements');
  });
  it('NO-GO when one rule fails, even if all the others pass, and names the failed rule', () => {
    const v = verdict({ ...good, sunlitPct: 90 }, sortie, roomy);
    expect(v.verdict).toBe('NO-GO');
    expect(v.rule).toMatch(/sunlit at least 95%/);
    expect(v.failed).toHaveLength(1);
  });
  it('lists every failed rule and decides on the first in rule order', () => {
    const v = verdict({ ...good, longestDarkGapH: 7, longestLinkGapH: 9 }, sortie, roomy);
    expect(v.failed).toHaveLength(2);
    expect(v.rule).toMatch(/dark gap at most 6 h/);
  });
  it('a failed rule beats a slip that would have said MARGINAL', () => {
    const tight: Slip = { ...roomy, lateDays: 0.5 };
    expect(verdict({ ...good, earthVisiblePct: 40 }, sortie, tight).verdict).toBe('NO-GO');
  });
  it('MARGINAL when rules are met but days late is under 3, whatever days early is (decision: late decides)', () => {
    const v = verdict(good, sortie, { ...roomy, lateDays: 2.75, earlyDays: 30 });
    expect(v.verdict).toBe('MARGINAL');
    expect(v.rule).toMatch(/2\.75 days later/);
    expect(verdict(good, sortie, { ...roomy, lateDays: 3, earlyDays: 0 }).verdict).toBe('GO');
  });
  it('treats a start that is not viable on the 6-hour grid as MARGINAL with zero days of slip, never GO', () => {
    const v = verdict(good, sortie, { viableAtChosen: false, lateDays: null, earlyDays: null, lateCensored: false, earlyCensored: false, nextWindow: null });
    expect(v.verdict).toBe('MARGINAL');
  });
  it('says "at least" when the slip run reaches the edge of the evaluated range', () => {
    expect(verdict(good, sortie, { ...roomy, lateDays: 4, lateCensored: true }).rule).toMatch(/at least 4 days/);
  });
  it('lander thresholds are applied, not the sortie ones', () => {
    const m = { ...good, sunlitPct: 85, longestDarkGapH: 20, earthVisiblePct: 60, longestLinkGapH: 40 };
    expect(verdict(m, PRESETS.lander, roomy).verdict).toBe('GO');
    expect(verdict(m, sortie, roomy).verdict).toBe('NO-GO');
  });
  it('the one-year stay gives no verdict', () => {
    expect(verdict(good, PRESETS.year, roomy).verdict).toBe('NONE');
    expect(checkRules(good, PRESETS.year)).toEqual([]);
  });
  it('refuses to give a verdict without a fidelity grade or terrain source', () => {
    expect(() => verdict({ ...good, grade: undefined as never }, sortie, roomy)).toThrow(/grade/);
    expect(() => verdict({ ...good, terrain: '' }, sortie, roomy)).toThrow(/terrain/);
  });
});

describe('slip tolerance', () => {
  // 6-hour steps: 4 per day. Viable runs: indices 4-11 and 20-23.
  const v = new Uint8Array(32);
  for (const i of [4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22, 23]) v[i] = 1;
  const t0 = Date.UTC(2030, 0, 1);
  const at = (i: number) => t0 + i * 6 * HOUR_MS;
  it('counts days late and early within the unbroken run only', () => {
    const s = slip(v, t0, at(6));
    expect(s.viableAtChosen).toBe(true);
    expect(s.lateDays).toBe(1.25); // 5 steps
    expect(s.earlyDays).toBe(0.5); // 2 steps
    expect(s.lateCensored).toBe(false);
    expect(s.earlyCensored).toBe(false);
  });
  it('does not extend across a one-step gap', () => {
    const g = Uint8Array.from([1, 1, 0, 1, 1]);
    expect(slip(g, t0, at(0)).lateDays).toBe(0.25);
    expect(slip(g, t0, at(3)).earlyDays).toBe(0);
    expect(slip(g, t0, at(2)).nextWindow!.lengthDays).toBe(0.5);
  });
  it('does not extend across a gap', () => {
    expect(slip(v, t0, at(11)).lateDays).toBe(0);
    expect(slip(v, t0, at(20)).earlyDays).toBe(0);
  });
  it('marks a run that reaches the end of the range as censored', () => {
    const s = slip(v, t0, at(21));
    expect(s.lateDays).toBe(0.5);
    expect(s.lateCensored).toBe(false); // index 23 is not the last element (31)
    const w = new Uint8Array(8).fill(1);
    const e = slip(w, t0, at(3));
    expect(e.lateCensored).toBe(true);
    expect(e.earlyCensored).toBe(true);
  });
  it('when not viable, gives the next window and its length', () => {
    const s = slip(v, t0, at(14));
    expect(s.viableAtChosen).toBe(false);
    expect(s.nextWindow).toEqual({ startMs: at(20), lengthDays: 1, censored: false });
    expect(slip(v, t0, at(1)).nextWindow!.startMs).toBe(at(4));
    expect(slip(v, t0, at(25)).nextWindow).toBeNull();
  });
  it('rejects a chosen date outside the evaluated range', () => {
    expect(() => slip(v, t0, at(40))).toThrow(RangeError);
    expect(() => slip(v, t0, t0 - 1)).toThrow(RangeError);
  });
});

describe('viable windows from a real series', () => {
  it('a 6.5-day stay on the synthetic cycle is viable only when the Sun and Earth are both up, and slip is read from that', () => {
    const site = { frame: spinSite(), sky: smoothSkyline(2) };
    const ser = series(spinningTable(), site, T2030 - 400 * HOUR_MS, T2030 + 1400 * HOUR_MS, 10);
    const first = T2030 - 300 * HOUR_MS;
    const count = 24 * 4 * 2; // 24 days of 6-hour starts
    const strict = { ...PRESETS.sortie, rules: { sunlitMinPct: 95, darkGapMaxH: 6, earthVisibleMinPct: 90, linkGapMaxH: 6 } };
    const viable = viableSeries(ser, strict, first, count);
    // The Sun is up from -180 h to +180 h of each cycle, Earth from 0 to 360 h, so both are up from 0 to 180 h:
    // a 156 h stay fits when it starts between 0 and 24 h, widened by the 6 h gap allowances: -6 to 30 h.
    const startsViable = Array.from(viable).map((x, k) => (x ? (first + k * 6 * HOUR_MS - T2030) / HOUR_MS : null)).filter((x) => x !== null) as number[];
    const firstWindow = startsViable.filter((x) => x < 400); // the next cycle repeats it 720 h later
    expect(Math.min(...firstWindow)).toBeGreaterThanOrEqual(-7);
    expect(Math.max(...firstWindow)).toBeLessThanOrEqual(31);
    expect(startsViable.some((x) => x > 700)).toBe(true);
    expect(firstWindow.length).toBeGreaterThan(3);
    const s = slip(viable, first, T2030 + 6 * HOUR_MS);
    expect(s.viableAtChosen).toBe(true);
    expect(s.lateDays).toBeGreaterThan(0.9);
    expect(s.lateDays).toBeLessThan(1.4); // 6 h chosen start to the last viable start at 30 h is 24 h
  });
  it('refuses to evaluate a stay that runs past the end of the series, and the one-year preset', () => {
    const site = { frame: spinSite(), sky: smoothSkyline(2) };
    const ser = series(spinningTable(), site, T2030, T2030 + 100 * HOUR_MS, 10);
    expect(() => viableSeries(ser, PRESETS.sortie, T2030, 4)).toThrow(RangeError);
    expect(() => viableSeries(ser, PRESETS.year, T2030, 1)).toThrow();
  });
});
