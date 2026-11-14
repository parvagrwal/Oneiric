import { describe, expect, it } from 'vitest';
import { directionResiduals, loadTable, summarize } from '../pipeline/direction-check.ts';
import { loadSites } from '../pipeline/fetch-fixtures.ts';

const table = loadTable();
const sites = loadSites();

describe('Sun and Earth direction against Horizons site queries', () => {
  it('every one of the eight sites stays within 0.02 degrees', () => {
    const r = summarize(directionResiduals(table, sites));
    expect(r.n).toBe(8000);
    expect(r.maxDeg).toBeLessThanOrEqual(0.02);
  });
  it('sabotage: moving one site by 0.1 degrees of longitude makes the check fail and names that site', () => {
    const bad = directionResiduals(table, sites, (s) => (s.id === 'connecting-ridge' ? { ...s, eLon: s.eLon + 0.1 } : s));
    const over = bad.filter((x) => x.deg > 0.02);
    expect(over.length).toBeGreaterThan(0);
    expect(new Set(over.map((x) => x.site))).toEqual(new Set(['connecting-ridge']));
  });
  it('sabotage: entering west longitudes as east (360 minus the value) fails at the Connecting Ridge', () => {
    const bad = directionResiduals(table, sites, (s) => (s.id === 'connecting-ridge' ? { ...s, eLon: 360 - s.eLon } : s));
    expect(summarize(bad.filter((x) => x.site === 'connecting-ridge')).maxDeg).toBeGreaterThan(1);
  });
  it('sabotage: swapping the sign of latitude fails', () => {
    const bad = directionResiduals(table, sites, (s) => (s.id === 'im-2-athena' ? { ...s, lat: -s.lat } : s));
    expect(summarize(bad.filter((x) => x.site === 'im-2-athena')).maxDeg).toBeGreaterThan(1);
  });
  it('sabotage: measuring from the Moon centre instead of the site is caught for Earth (about 0.26 degrees)', () => {
    const r = directionResiduals(table, sites, undefined, true).filter((x) => x.body === 'earth');
    const m = summarize(r);
    expect(m.maxDeg).toBeGreaterThan(0.2);
    expect(m.maxDeg).toBeLessThan(0.35);
  });
});
