// The three reports on shipped data: blocking terrain, landing-error robustness, and sensitivity.
//
// The wrongness each report must not commit:
//   blocking:    a ground point named for a skyline that records no terrain, or one not at the stored distance;
//   landing:     a circle share computed from the centre site, or a 5 m raster claimed where none exists;
//   sensitivity: a height-error band shown without a value, or a missing axis reported as zero movement.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { landingCircleWithCentre, nearFieldAvailability, R_MOON_KM, smoothSkyline } from '../engine/index.ts';
import { blockingForAll, blockingGeoJson } from '../pipeline/blocking-report.ts';
import { circlePointSiteId, landingErrorFor } from '../pipeline/landing-error-report.ts';
import { heightSensitivity, horizonShiftSensitivity } from '../pipeline/sensitivity-report.ts';
import { readSkylineIndex } from '../pipeline/skyline-index.ts';

const INDEX = readSkylineIndex();
if (!INDEX) throw new Error('the reports need the shipped skyline index');
const SITES = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;
const START_MS = Date.parse('2027-03-01T00:00:00Z');
const STAY_MS = Math.round((6.5 * 86_400_000) / 60_000) * 60_000;
const CONNECTING_RIDGE = SITES.find((s) => s.id === 'connecting-ridge')!;

describe('the blocking report', () => {
  const rows = blockingForAll(INDEX!, SITES, START_MS, STAY_MS, 2);

  it('covers every polar site at 2 m', () => {
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => r.heightM === 2)).toBe(true);
  });

  it('names a ground point only where the shipped skyline records a terrain distance', () => {
    let withPoint = 0;
    for (const row of rows) {
      for (const b of row.blockers) {
        if (b.distanceKm === null) {
          expect(b.pointLat).toBeNull();
          expect(b.pointELon).toBeNull();
          expect(b.riseM).toBeNull();
        } else {
          expect(b.pointLat).not.toBeNull();
          expect(b.pointELon).not.toBeNull();
          expect(b.pointELon!).toBeGreaterThanOrEqual(0);
          expect(b.pointELon!).toBeLessThan(360);
          withPoint++;
        }
      }
    }
    expect(withPoint).toBeGreaterThan(0);
  });

  it('places the named point the recorded distance from the site', () => {
    const row = blockingForAll(INDEX!, SITES, START_MS, STAY_MS, 2, 'connecting-ridge')[0];
    const b = row.blockers.find((x) => x.kind === 'dark');
    expect(b).toBeDefined();
    const dLat = b!.pointLat! - CONNECTING_RIDGE.lat;
    const dLon = b!.pointELon! - CONNECTING_RIDGE.eLon;
    const planarM = Math.hypot(dLat, dLon * Math.cos((CONNECTING_RIDGE.lat * Math.PI) / 180)) * (Math.PI / 180) * R_MOON_KM * 1000;
    // The planar form is good to a few per cent at 330 m from 89.45 S; the exact distance is in the row.
    expect(Math.abs(planarM - b!.distanceKm! * 1000)).toBeLessThan(b!.distanceKm! * 1000 * 0.05 + 5);
  });

  it('emits one GeoJSON feature per recorded point, and none for a point the skyline never recorded', () => {
    const row = blockingForAll(INDEX!, SITES, START_MS, STAY_MS, 2, 'connecting-ridge');
    const geo = JSON.parse(blockingGeoJson(row)) as { type: string; features: Array<{ properties: Record<string, unknown>; geometry: { coordinates: number[] } }> };
    expect(geo.type).toBe('FeatureCollection');
    const expected = row.flatMap((r) => r.blockers).filter((b) => b.pointLat !== null).length;
    expect(geo.features).toHaveLength(expected);
    for (const f of geo.features) {
      expect(typeof f.properties.distanceKm).toBe('number');
      expect(f.geometry.coordinates).toHaveLength(2);
    }
    expect(blockingGeoJson([{ siteId: 'x', grade: 'D', terrain: 'none (smooth sphere)', heightM: 2, blockers: [] }])).toContain('"features": []');
  });

  it('states clearance with its sign: a body below the horizon has a negative clearance', () => {
    const row = blockingForAll(INDEX!, SITES, START_MS, STAY_MS, 2, 'connecting-ridge')[0];
    const dark = row.blockers.find((b) => b.kind === 'dark')!;
    // A dark span means the Sun's centre is at or under the horizon at mid-span.
    expect(dark.clearanceDeg).toBeLessThanOrEqual(0.01);
  });
});

describe('the landing-error report', () => {
  const row = landingErrorFor(INDEX!, CONNECTING_RIDGE, START_MS, 'sortie', 100, 2, []);

  it('reports the centre verdict from the centre skyline and nine circle points', () => {
    expect(row).not.toBeNull();
    expect(row!.points).toHaveLength(9);
    expect(row!.centreVerdict.verdict).not.toBe('NONE');
    expect(row!.centreVerdict.rule.length).toBeGreaterThan(0);
    expect(row!.centreVerdict.grade).toBe(row!.grade);
  });

  it('reports no share at all when no circle point could be computed', () => {
    expect(row!.points.every((p) => p.status === 'no-stored-skyline')).toBe(true);
    expect(row!.shareKeepingVerdict).toBeNull();
    expect(row!.points.every((p) => p.verdict === null)).toBe(true);
  });

  it('puts every circle point where the engine geometry puts it', () => {
    const geo = landingCircleWithCentre({ latDeg: CONNECTING_RIDGE.lat, eLonDeg: CONNECTING_RIDGE.eLon }, 100, 8);
    expect(row!.points.map((p) => p.latDeg)).toEqual(geo.map((p) => p.latDeg));
    expect(row!.points.map((p) => p.eLonDeg)).toEqual(geo.map((p) => p.eLonDeg));
    expect(row!.points.map((p) => p.azDeg)).toEqual(geo.map((p) => p.azDeg));
  });

  it('claims a 5 m near field only for the points a raster covers', () => {
    const raster = { id: 'p78', centre: { latDeg: CONNECTING_RIDGE.lat, eLonDeg: CONNECTING_RIDGE.eLon }, halfWidthM: 1500, pixelM: 5, grade: 'A' as const, source: 'test' };
    const covered = landingErrorFor(INDEX!, CONNECTING_RIDGE, START_MS, 'sortie', 100, 2, [raster])!;
    expect(covered.nearFieldComplete).toBe(true);
    expect(covered.points.every((p) => p.nearField === 'inside-5m-raster')).toBe(true);
    expect(row!.nearFieldComplete).toBe(false);
    expect(row!.points.every((p) => p.nearField === 'no-5m-raster')).toBe(true);
  });

  it('names the index id a circle-point skyline would carry, so a reader can add one', () => {
    expect(circlePointSiteId('connecting-ridge', 0)).toBe('connecting-ridge~circle-0');
    expect(circlePointSiteId('connecting-ridge', 45)).toBe('connecting-ridge~circle-45');
    expect(circlePointSiteId('connecting-ridge', 337.5)).toBe('connecting-ridge~circle-337.5');
  });
});

describe('the sensitivity report', () => {
  it('reports the movement between neighbouring heights from the rows, not from a constant', () => {
    const row = (heightM: number, sunlitPct: number, longestDarkGapH: number) => ({
      siteId: 'a', grade: 'B' as const, terrain: 't', startUtc: '', heightM, sunlitPct, longestDarkGapH, earthVisiblePct: 50, longestLinkGapH: 10,
    });
    const steps = heightSensitivity([row(0, 1, 24), row(2, 30, 12), row(10, 90, 1)]);
    expect(steps).toHaveLength(2);
    expect(steps[0].fromHeightM).toBe(0);
    expect(steps[0].sunlitPoints).toBeCloseTo(29, 9);
    expect(steps[1].fromHeightM).toBe(2);
    expect(steps[1].sunlitPoints).toBeCloseTo(60, 9);
    expect(steps[1].darkGapHours).toBeCloseTo(-11, 9);
  });

  it('reports no horizon-shift band while no error value is on file, instead of a zero band', () => {
    const entry = INDEX!.skylines.find((e) => e.siteId === CONNECTING_RIDGE.id && e.heightM === 2)!;
    const shift = horizonShiftSensitivity({ years: new Map() } as never, entry, CONNECTING_RIDGE.lat, CONNECTING_RIDGE.eLon, START_MS, STAY_MS);
    expect(shift).toBeNull();
  });

  it('a smooth sphere reports no near field at any point, and nothing is implied by the absence', () => {
    const a = nearFieldAvailability(landingCircleWithCentre({ latDeg: CONNECTING_RIDGE.lat, eLonDeg: CONNECTING_RIDGE.eLon }, 100, 8), []);
    expect(a.complete).toBe(false);
    expect(a.covered).toHaveLength(0);
    expect(smoothSkyline(2).grade).toBe('D');
  });
});
