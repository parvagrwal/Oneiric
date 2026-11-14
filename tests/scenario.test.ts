import { describe, expect, it } from 'vitest';
import { calculateScenario, type TerrainPayload } from '../app/src/scenario.ts';
import { buildSkyline, encodeSkyline, smoothSkyline, TIER_LIMITS_M } from '../engine/index.ts';
import { syntheticDem } from '../pipeline/synthetic-terrain.ts';
import { T2030, spinningTable } from './helpers.ts';

const site = {
  id: 'connecting-ridge',
  name: 'Connecting Ridge',
  label: 'Connecting Ridge reference point',
  lat: -89.45,
  eLon: 222.69,
  source: 'Mazarico et al. 2011, via Gläser et al. 2018 Table 1',
  sourceUrl: 'https://quickmap.lroc.im-ldi.com/',
};

describe('scenario worker orchestration', () => {
  it('returns one grade-D scenario from the same engine used by the pipeline', () => {
    const result = calculateScenario(spinningTable(), site, T2030 + 6 * 60 * 60 * 1000, 'sortie');

    expect(result.preset.id).toBe('sortie');
    expect(result.verdict.grade).toBe('D');
    expect(result.verdict.terrain).toBe('none (smooth sphere)');
    expect(result.metrics.grade).toBe('D');
    expect(result.metrics.terrain).toBe('none (smooth sphere)');
    expect(result.track.length).toBeGreaterThan(100);
    expect(result.timeline.length).toBeGreaterThan(10);
    expect(result.skyline).toHaveLength(181);
    expect(result.verdict.presetLabel).toBe('illustrative, not agency requirements');
  });

  it('does not silently turn an unsupported stay into a verdict', () => {
    expect(() => calculateScenario(spinningTable(), site, T2030, 'year')).toThrow(/unsupported preview stay/);
  });
});

describe('scenario with a terrain skyline', () => {
  // Synthetic terrain: a wall 800 m high ringing the site 5 km away, about 9 degrees up at every azimuth.
  const wall = syntheticDem('synthetic test terrain', 20, 7_000, site.lat, site.eLon, (rel) => 800 * Math.exp(-(((rel.distM - 5_000) / 500) ** 2)) + 50);
  const built = buildSkyline([{ dem: wall, maxDistM: TIER_LIMITS_M[0] }], site.lat, site.eLon, 2);
  const payload = (over: Partial<TerrainPayload> = {}): TerrainPayload => ({
    buffer: encodeSkyline(built.H, built.D), grade: 'B', terrain: 'synthetic test terrain', siteElevationM: built.siteElevationM, heightM: 2, ...over,
  });
  const start = T2030 + 6 * 60 * 60 * 1000;

  it('carries the terrain grade and source into the verdict and metrics, and returns every bin with its distance', () => {
    const result = calculateScenario(spinningTable(), site, start, 'sortie', 2, payload());
    expect(result.verdict.grade).toBe('B');
    expect(result.verdict.terrain).toBe('synthetic test terrain');
    expect(result.metrics.grade).toBe('B');
    expect(result.skyline).toHaveLength(1440);
    expect(result.skyline[0].az).toBe(0.125);
    expect(result.skyline[0].distanceKm).toBeGreaterThan(4.8);
    expect(result.skyline[0].distanceKm).toBeLessThan(5.1);
    expect(result.skyline[0].elevation).toBeGreaterThan(8);
  });

  it('the wall hides a Sun that the smooth sphere would show', () => {
    const lit = T2030 + 15 * 86_400_000; // the synthetic Sun is above this site's smooth horizon for these days
    const smooth = calculateScenario(spinningTable(), site, lit, 'sortie');
    const walled = calculateScenario(spinningTable(), site, lit, 'sortie', 2, payload());
    expect(smooth.metrics.sunlitPct).toBe(100);
    expect(walled.metrics.sunlitPct).toBe(0);
    expect(walled.verdict.verdict).toBe('NO-GO');
  });

  it('with the terrain skyline removed the result drops to grade D and never keeps the terrain grade', () => {
    const result = calculateScenario(spinningTable(), site, start, 'sortie', 2, null);
    expect(result.verdict.grade).toBe('D');
    expect(result.verdict.terrain).toBe('none (smooth sphere)');
    expect(result.skyline).toHaveLength(181);
  });

  it('refuses a skyline built for another height, a damaged file, smooth data with a terrain grade, and terrain labelled grade D', () => {
    expect(() => calculateScenario(spinningTable(), site, start, 'sortie', 10, payload())).toThrow(/built for 2 m/);
    expect(() => calculateScenario(spinningTable(), site, start, 'sortie', 2, payload({ buffer: new ArrayBuffer(100) }))).toThrow(/8640 bytes/);
    const flat = smoothSkyline(2);
    expect(() => calculateScenario(spinningTable(), site, start, 'sortie', 2, payload({ buffer: encodeSkyline(flat.H, flat.D) }))).toThrow(/smooth/);
    expect(() => calculateScenario(spinningTable(), site, start, 'sortie', 2, payload({ grade: 'D' }))).toThrow(/grade D/);
    expect(() => calculateScenario(spinningTable(), site, start, 'sortie', 2, payload({ siteElevationM: NaN }))).toThrow(/site elevation/);
  });
});
