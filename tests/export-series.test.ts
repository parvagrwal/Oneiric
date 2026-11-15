import { describe, expect, it } from 'vitest';
import { SiteSeriesCache, exportSeriesCsv } from '../app/src/scenario.ts';
import { spinningTable, T2030 } from './helpers.ts';

const site = {
  id: 'export-test',
  name: 'Export test site',
  label: 'Export test site',
  lat: 0,
  eLon: 0,
  source: 'synthetic',
  sourceUrl: 'https://example.invalid/',
};

describe('CSV export of the stay series', () => {
  it('writes the header, one row per 10-minute step of the stay, and well-formed UTC timestamps', () => {
    const cache = new SiteSeriesCache(spinningTable());
    const csv = exportSeriesCsv(cache, site, T2030 + 6 * 3_600_000, 'sortie', 2, null);
    const lines = csv.trimEnd().split('\n');

    expect(lines[0]).toBe('t_utc,sun_az_deg,sun_el_deg,sun_fraction,earth_az_deg,earth_el_deg,earth_visible');
    // 6.5-day stay at 10 minutes per step, snapped to the step grid.
    expect(lines.length).toBe(1 + 6.5 * 144);

    const first = Date.parse(lines[1].split(',')[0]);
    const last = Date.parse(lines[lines.length - 1].split(',')[0]);
    expect(Number.isFinite(first)).toBe(true);
    expect(last - first).toBe(lines.length - 2 > 0 ? (lines.length - 2) * 600_000 : 0);

    for (const line of lines.slice(1)) {
      const [t, az, el, f, earthAz, earthEl, earthVis] = line.split(',');
      expect(Number.isFinite(Date.parse(t))).toBe(true);
      expect(Number.isFinite(Number(az))).toBe(true);
      expect(Number.isFinite(Number(el))).toBe(true);
      expect(Number(f)).toBeGreaterThanOrEqual(0);
      expect(Number(f)).toBeLessThanOrEqual(1);
      expect(Number.isFinite(Number(earthAz))).toBe(true);
      expect(Number.isFinite(Number(earthEl))).toBe(true);
      expect(['0', '1']).toContain(earthVis);
    }
  });

  it('snaps an unaligned start down to the ten-minute grid', () => {
    const cache = new SiteSeriesCache(spinningTable());
    const csv = exportSeriesCsv(cache, site, T2030 + 6 * 3_600_000 + 7 * 60_000, 'sortie', 2, null);
    const firstStamp = Date.parse(csv.trimEnd().split('\n')[1].split(',')[0]);
    expect(firstStamp % 600_000).toBe(0);
    expect(firstStamp).toBe(T2030 + 6 * 3_600_000);
  });
});
