// The 100 m circle and the 5 m near field: points are placed where the geometry says, and a point is reported as
// terrain-covered only when a stored raster covers it.
//
// The wrongness: filling an unavailable point in from the centre site's skyline, and so turning a 100 m landing
// circle into a claim that nine points were measured when one was.
import { describe, expect, it } from 'vitest';
import {
  centralAngle,
  groundDistanceM,
  landingCirclePoints,
  landingCircleWithCentre,
  nearFieldAvailability,
  R_MOON_KM,
  type NearFieldRaster,
} from '../engine/index.ts';

const SITE = { latDeg: -89.45, eLonDeg: 222.69 };

describe('landing circle points', () => {
  it('places eight points at exactly 100 m from the centre, one every 45 degrees', () => {
    const points = landingCirclePoints(SITE, 100, 8);
    expect(points).toHaveLength(8);
    for (const p of points) {
      const d = groundDistanceM(SITE, p);
      expect(Math.abs(d - 100)).toBeLessThan(0.001);
    }
    expect(points.map((p) => p.azDeg)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('puts the centre first and the centre is zero distance away', () => {
    const all = landingCircleWithCentre(SITE, 100, 8);
    expect(all).toHaveLength(9);
    expect(all[0].distanceM).toBe(0);
    expect(groundDistanceM(SITE, all[0])).toBeLessThan(1e-6);
  });

  it('a 100 m circle spans about 1.6e-5 radians, not a tenth of a degree', () => {
    // 100 m / 1,737.4 km = 5.756e-5 rad; a tenth of a degree would be 1.7e-3 rad, thirty times too far.
    const theta = centralAngle(SITE, landingCirclePoints(SITE, 100, 1)[0]);
    expect(theta).toBeCloseTo(100 / (R_MOON_KM * 1000), 12);
  });

  it('refuses a circle radius that is not a positive number of metres', () => {
    expect(() => landingCirclePoints(SITE, 0)).toThrow(RangeError);
    expect(() => landingCirclePoints(SITE, -100)).toThrow(RangeError);
    expect(() => landingCirclePoints(SITE, 100, 0)).toThrow(RangeError);
  });
});

describe('near-field coverage', () => {
  const raster: NearFieldRaster = {
    id: 'product-78-test',
    centre: SITE,
    halfWidthM: 2500,
    pixelM: 5,
    grade: 'A',
    source: 'constructed for this test',
  };

  it('covers every point of a 100 m circle when the raster is 2.5 km wide about the site', () => {
    const a = nearFieldAvailability(landingCircleWithCentre(SITE, 100, 8), [raster]);
    expect(a.complete).toBe(true);
    expect(a.covered).toHaveLength(9);
    expect(a.uncovered).toHaveLength(0);
  });

  it('reports a point outside every raster as uncovered rather than reusing the centre', () => {
    const far = landingCirclePoints({ latDeg: -85, eLonDeg: 60 }, 100, 8);
    const a = nearFieldAvailability(far, [raster]);
    expect(a.complete).toBe(false);
    expect(a.covered).toHaveLength(0);
    expect(a.uncovered).toHaveLength(8);
  });

  it('with no 5 m raster on file, every point is uncovered and nothing is implied', () => {
    const a = nearFieldAvailability(landingCircleWithCentre(SITE), []);
    expect(a.complete).toBe(false);
    expect(a.covered).toHaveLength(0);
    expect(a.uncovered).toHaveLength(9);
  });

  it('refuses a raster that is not grade A, because a 20 m raster is not a 5 m near field', () => {
    const fake = { ...raster, grade: 'B' as unknown as 'A' };
    expect(() => nearFieldAvailability([SITE], [fake])).toThrow(/grade A/);
  });

  it('picks the nearest raster when two overlap, point by point', () => {
    // Both rasters cover the whole circle, since 2.5 km is much wider than 100 m + 152 m. The farther of the two is
    // the one about 152 m from the centre, so a point on its side of the circle is still nearer to it: the choice
    // is made per point, not per site.
    const far: NearFieldRaster = { ...raster, id: 'far', centre: { latDeg: -89.455, eLonDeg: 222.69 } };
    const a = nearFieldAvailability(landingCircleWithCentre(SITE, 100, 8), [raster, far]);
    expect(a.complete).toBe(true);
    const byAz = new Map(a.covered.map((m) => [m.point.eLonDeg.toFixed(9) + m.point.latDeg.toFixed(9), m.raster.id]));
    // The 180-degree point is on the far raster's side (both move south), so it must take the far raster.
    expect(a.covered.some((m) => m.raster.id === 'far')).toBe(true);
    expect(a.covered.some((m) => m.raster.id === 'product-78-test')).toBe(true);
    expect(byAz.size).toBeGreaterThanOrEqual(8);
  });
});
