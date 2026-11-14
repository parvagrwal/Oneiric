import { DEG, R_MOON_KM } from './constants.ts';
import { dot, sub, unit, wrap360, type Vec3 } from './vec.ts';

/** Local frame at a site in the MOON_ME frame (east-positive longitude, +X toward the mean Earth). */
export interface SiteFrame {
  latDeg: number;
  lonDeg: number; // east-positive
  radiusKm: number; // R + z + h
  r0: Vec3; // site position, km, from the Moon's centre
  up: Vec3;
  east: Vec3;
  north: Vec3;
}

/** radiusM = R + z + h in metres (z from the DEM, h the array height). */
export function siteFrame(latDeg: number, lonDeg: number, radiusM: number): SiteFrame {
  if (!(Math.abs(latDeg) <= 90)) throw new RangeError(`latitude out of range: ${latDeg}`);
  if (!Number.isFinite(lonDeg)) throw new RangeError(`longitude not finite: ${lonDeg}`);
  if (!(radiusM > 1_000_000)) throw new RangeError(`radius must be in metres (R + z + h), got ${radiusM}`);
  const p = latDeg * DEG;
  const l = lonDeg * DEG;
  const up: Vec3 = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const east: Vec3 = [-Math.sin(l), Math.cos(l), 0];
  const north: Vec3 = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const radiusKm = radiusM / 1000;
  return { latDeg, lonDeg, radiusKm, r0: [up[0] * radiusKm, up[1] * radiusKm, up[2] * radiusKm], up, east, north };
}

/** Site frame on the smooth sphere of radius R = 1737.4 km, at height h metres. */
export const smoothSiteFrame = (latDeg: number, lonDeg: number, heightM: number) =>
  siteFrame(latDeg, lonDeg, R_MOON_KM * 1000 + heightM);

/** Unit direction from the site (not the Moon's centre) to a body at position `body` (km, Moon-centred). */
export const directionFromSite = (f: SiteFrame, body: Vec3): Vec3 => unit(sub(body, f.r0));

/** Azimuth (degrees from north through east, 0..360) and elevation (degrees) of a unit direction. */
export function azElOfDirection(f: SiteFrame, d: Vec3): { az: number; el: number } {
  const el = (Math.asin(Math.max(-1, Math.min(1, dot(d, f.up)))) * 180) / Math.PI;
  const az = wrap360((Math.atan2(dot(d, f.east), dot(d, f.north)) * 180) / Math.PI);
  return { az, el };
}

/** Azimuth and elevation of a body, seen from the site. */
export const azEl = (f: SiteFrame, body: Vec3) => azElOfDirection(f, directionFromSite(f, body));

/** Azimuth of the Moon-fixed +X axis (mean Earth direction) seen from the site. */
export const meanEarthAzimuth = (f: SiteFrame) => azElOfDirection(f, [1, 0, 0]).az;
