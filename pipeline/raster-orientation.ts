// Orientation check for the elevation rasters: two named craters must be low ground at their catalogue coordinates,
// and lower than the ground at the mirrored longitude. A mirrored, rotated or transposed raster fails.
import { DEG, R_MOON_KM } from '../engine/constants.ts';
import { siteFrame } from '../engine/frame.ts';

/**
 * Centre coordinates and diameters as listed for IAU feature IDs 5450 and 953. The values were first read from a copy
 * of the IAU feature list (github.com/cosmoscout/cosmoscout-vr, resources/locations/moon.csv) and then verified
 * against the gazetteer pages themselves on 2026-11-15; they match the gazetteer's primary listing for each feature.
 * `source` is that gazetteer page.
 */
export const CRATERS = [
  { name: 'Shackleton', featureId: 5450, latDeg: -89.67, eLonDeg: 129.78, diameterKm: 20.92, source: 'https://planetarynames.wr.usgs.gov/Feature/5450' },
  { name: 'Cabeus', featureId: 953, latDeg: -85.33, eLonDeg: 360 - 42.13, diameterKm: 100.58, source: 'https://planetarynames.wr.usgs.gov/Feature/953' },
];
export const RING_POINTS = 24;

export type HeightAt = (latDeg: number, eLonDeg: number) => number | Promise<number>;

export interface CraterResult {
  name: string; latDeg: number; eLonDeg: number;
  centreM: number; rimMedianM: number; mirroredLongitudeM: number;
  isLow: boolean; lowerThanMirrored: boolean; pass: boolean;
}

/** Latitude and east longitude of the point `distKm` from (lat, lon) along azimuth `azDeg`. */
export function offsetPoint(latDeg: number, lonDeg: number, distKm: number, azDeg: number): { latDeg: number; eLonDeg: number } {
  const { up, east, north } = siteFrame(latDeg, lonDeg, R_MOON_KM * 1000);
  const t = distKm / R_MOON_KM, c = Math.cos(azDeg * DEG), s = Math.sin(azDeg * DEG);
  const q = [0, 1, 2].map((i) => up[i] * Math.cos(t) + (north[i] * c + east[i] * s) * Math.sin(t));
  return { latDeg: Math.asin(q[2]) / DEG, eLonDeg: ((Math.atan2(q[1], q[0]) / DEG) + 360) % 360 };
}

/** The rule, fixed before any raster was read: the centre is below the median of 24 points one crater radius away,
 *  and below the point at the same latitude and the mirrored longitude (360 minus the east longitude). */
export async function orientationCheck(heightAt: HeightAt): Promise<CraterResult[]> {
  const out: CraterResult[] = [];
  for (const c of CRATERS) {
    const centreM = await heightAt(c.latDeg, c.eLonDeg);
    const ring: number[] = [];
    for (let k = 0; k < RING_POINTS; k++) {
      const p = offsetPoint(c.latDeg, c.eLonDeg, c.diameterKm / 2, (360 * k) / RING_POINTS);
      ring.push(await heightAt(p.latDeg, p.eLonDeg));
    }
    ring.sort((a, b) => a - b);
    const rimMedianM = (ring[RING_POINTS / 2 - 1] + ring[RING_POINTS / 2]) / 2;
    const mirroredLongitudeM = await heightAt(c.latDeg, 360 - c.eLonDeg);
    const isLow = centreM < rimMedianM;
    const lowerThanMirrored = centreM < mirroredLongitudeM;
    out.push({ name: c.name, latDeg: c.latDeg, eLonDeg: c.eLonDeg, centreM, rimMedianM, mirroredLongitudeM, isLow, lowerThanMirrored, pass: isLow && lowerThanMirrored });
  }
  return out;
}
