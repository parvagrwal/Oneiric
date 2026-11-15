// The illumination comparison: it reports what it measured, and it does not claim a pass it cannot support.
//
// The wrongness: picking the height that agrees with the paper, so a comparison passes; or reporting a pass when
// the published observer height is unknown and the spread across heights is larger than the tolerance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { annualSunlitPct, compareRows, COMPARISON_TOLERANCE_POINTS, type PublishedValue } from '../pipeline/illumination-compare.ts';
import { readSkylineIndex } from '../pipeline/skyline-index.ts';
import { loadTable } from '../pipeline/direction-check.ts';

const INDEX = readSkylineIndex();
if (!INDEX) throw new Error('the comparison needs the shipped skyline index');
const SITES = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;
const pointOf = (id: string) => {
  const s = SITES.find((x) => x.id === id)!;
  return { latDeg: s.lat, eLonDeg: s.eLon };
};
const siteAt = (p: { latDeg: number; eLonDeg: number }) =>
  SITES.find((s) => Math.abs(s.lat - p.latDeg) < 1e-3 && Math.abs(s.eLon - p.eLonDeg) < 1e-3)?.id ?? null;

const REF = (patch: Partial<PublishedValue> = {}): PublishedValue => ({
  id: 'test',
  point: pointOf('connecting-ridge'),
  valuePct: 76,
  rasterPixelM: 20,
  observerHeightM: null,
  citation: 'a paper',
  definition: 'annual average',
  verified: false,
  verificationNote: 'not read',
  ...patch,
});

/** Deterministic stand-in for the engine, so the row logic is tested without a year of computation. */
const fakeCompute = (valueForHeight: Record<number, number>) => (_siteId: string, entry: { heightM: number }) => valueForHeight[entry.heightM] ?? 0;

describe('a comparison needs a comparable quantity', () => {
  it('is not comparable when the published observer height is unknown, and shows the spread that explains why', () => {
    const rows = compareRows([REF()], INDEX!, siteAt, fakeCompute({ 0: 31, 2: 64, 10: 92, 20: 93 }));
    const row = rows[0];
    expect(row.status).toBe('not-comparable');
    expect(row.withinTolerance).toBeNull();
    expect(row.matched).toBeNull();
    expect(row.samples.map((s) => s.heightM)).toEqual([0, 2, 10, 20]);
    expect(row.explanation.join(' ')).toMatch(/spread across heights alone is 62\.00 points/);
    expect(row.explanation.join(' ')).toMatch(/no pass or fail is claimed/);
  });

  it('is not comparable when the published value itself is unverified, even at a known height', () => {
    const rows = compareRows([REF({ observerHeightM: 2 })], INDEX!, siteAt, fakeCompute({ 0: 31, 2: 64, 10: 92, 20: 93 }));
    expect(rows[0].status).toBe('not-comparable');
    expect(rows[0].explanation.join(' ')).toMatch(/unverified against the paper/);
  });

  it('is comparable, and inside tolerance, when the height is known, the value verified, and the figures agree', () => {
    const rows = compareRows([REF({ observerHeightM: 2, valuePct: 66, verified: true })], INDEX!, siteAt, fakeCompute({ 0: 31, 2: 64, 10: 92, 20: 93 }));
    expect(rows[0].status).toBe('comparable');
    expect(rows[0].matched!.heightM).toBe(2);
    expect(rows[0].withinTolerance).toBe(true);
    expect(Math.abs(rows[0].matched!.differencePoints)).toBeLessThanOrEqual(COMPARISON_TOLERANCE_POINTS);
  });

  it('is comparable but outside tolerance when the figures disagree at the published height', () => {
    const rows = compareRows([REF({ observerHeightM: 10, valuePct: 76, verified: true })], INDEX!, siteAt, fakeCompute({ 0: 31, 2: 64, 10: 92, 20: 93 }));
    expect(rows[0].status).toBe('comparable');
    expect(rows[0].withinTolerance).toBe(false);
    expect(rows[0].explanation.join(' ')).toMatch(/resolution alone cannot account for a gap this large/);
  });

  it('refuses to substitute another height when the published height has no stored skyline', () => {
    const rows = compareRows([REF({ observerHeightM: 5, verified: true })], INDEX!, siteAt, fakeCompute({ 0: 31, 2: 64, 10: 92, 20: 93 }));
    expect(rows[0].status).toBe('not-comparable');
    expect(rows[0].matched).toBeNull();
    expect(rows[0].explanation.join(' ')).toMatch(/no stored skyline at the published height of 5 m/);
  });

  it('reports a point with no library site as covering nothing, not as zero illumination', () => {
    const rows = compareRows([REF({ point: { latDeg: -45, eLonDeg: 10 } })], INDEX!, siteAt, fakeCompute({}));
    expect(rows[0].status).toBe('not-comparable');
    expect(rows[0].samples).toHaveLength(0);
    expect(rows[0].explanation.join(' ')).toMatch(/no library site sits at/);
  });
});

describe('the measured figures, from the shipped skylines', () => {
  const table = loadTable();
  const site = SITES.find((s) => s.id === 'connecting-ridge')!;

  it('compute an annual average that rises with observer height, as geometry requires', () => {
    const values: Array<{ heightM: number; pct: number }> = [];
    for (const h of [0, 2, 10, 20]) {
      const entry = INDEX!.skylines.find((e) => e.siteId === 'connecting-ridge' && e.heightM === h)!;
      values.push({ heightM: h, pct: annualSunlitPct(table, entry, site.lat, site.eLon) });
    }
    // A higher observer sees over more terrain, so the annual average cannot fall with height at the pole.
    for (let i = 1; i < values.length; i++) expect(values[i].pct).toBeGreaterThanOrEqual(values[i - 1].pct - 0.5);
    expect(values[0].pct).toBeGreaterThanOrEqual(0);
    expect(values.at(-1)!.pct).toBeLessThanOrEqual(100);
    // The published comparator sits inside this range, which is the point the report makes.
    for (const published of [76, 89]) {
      const lo = Math.min(...values.map((v) => v.pct));
      const hi = Math.max(...values.map((v) => v.pct));
      expect(published).toBeGreaterThanOrEqual(lo);
      expect(published).toBeLessThanOrEqual(hi);
    }
  }, 15_000); // Four annual averages over the shipped skylines: over 6 s on a loaded machine.

  it('the annual average is not the 6.5-day stay figure, and the two are reported separately', () => {
    const entry = INDEX!.skylines.find((e) => e.siteId === 'connecting-ridge' && e.heightM === 0)!;
    const annual = annualSunlitPct(table, entry, site.lat, site.eLon);
    // A 6.5-day sortie at 2027-03-01 gives 1.47% at 0 m, a very different question from the annual average.
    expect(annual).toBeGreaterThan(10);
  });
});

describe('the shipped published table', () => {
  it('names a source and a verification state for every row, and claims no verification it does not have', () => {
    const published = JSON.parse(readFileSync('data/published-illumination.json', 'utf8')) as { values: PublishedValue[] };
    expect(published.values.length).toBeGreaterThanOrEqual(2);
    for (const v of published.values) {
      expect(v.citation.length).toBeGreaterThan(20);
      expect(v.definition.length).toBeGreaterThan(10);
      expect(v.verificationNote.length).toBeGreaterThan(10);
      // Every row in this checkout is unverified: no paper was opened to produce it.
      expect(v.verified).toBe(false);
      expect(v.observerHeightM).toBeNull();
    }
  });
});
