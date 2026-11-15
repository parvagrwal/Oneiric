// Great-circle geometry on the observing sphere, shared by the blocking-terrain lookup and the landing-circle
// points. One implementation so the pipeline and the browser worker cannot drift apart.
import { DEG, R_MOON_KM } from './constants.ts';
import type { Vec3 } from './vec.ts';

export interface LatLon {
  latDeg: number;
  /** East-positive longitude in degrees, 0..360 (or -180..180; it is wrapped on use). */
  eLonDeg: number;
}

export interface GreatCircle {
  /** Central angle from the start point, radians (distance / R). */
  thetaRad: number;
  /** Azimuth from the start point, degrees from north through east, 0..360. */
  azDeg: number;
}

/**
 * Destination point a central angle `thetaRad` away from `from` along `azDeg`, on a sphere of the Moon's radius.
 * The same formula as the south-polar projection's inverse, so a point reported here lands where the skyline
 * builder sampled terrain.
 */
export function destinationPoint(from: LatLon, azDeg: number, thetaRad: number): LatLon {
  const p1 = from.latDeg * DEG;
  const l1 = from.eLonDeg * DEG;
  const az = azDeg * DEG;
  const sinLat2 = Math.sin(p1) * Math.cos(thetaRad) + Math.cos(p1) * Math.sin(thetaRad) * Math.cos(az);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const y = Math.sin(az) * Math.sin(thetaRad) * Math.cos(p1);
  const x = Math.cos(thetaRad) - Math.sin(p1) * sinLat2;
  const l2 = l1 + Math.atan2(y, x);
  const eLonDeg = ((l2 / DEG) % 360 + 360) % 360;
  const latDeg = lat2 / DEG;
  return { latDeg, eLonDeg: Object.is(eLonDeg, -0) ? 0 : eLonDeg };
}

/**
 * Central angle between two points, radians.
 *
 * Uses atan2 of the chord against the dot product rather than acos alone: acos loses about half its digits as the
 * angle approaches zero, and a 100 m landing circle is 1.6e-5 radians. The chord form keeps full precision there.
 */
export function centralAngle(a: LatLon, b: LatLon): number {
  const p1 = a.latDeg * DEG;
  const p2 = b.latDeg * DEG;
  const dl = (b.eLonDeg - a.eLonDeg) * DEG;
  const sinDl = Math.sin(dl);
  const cross: Vec3 = [
    Math.cos(p2) * sinDl,
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
    Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl),
  ];
  const dotProdc = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.atan2(Math.hypot(cross[0], cross[1]), dotProdc);
}

/** Ground distance between two points, metres, on the Moon's mean radius. */
export const groundDistanceM = (a: LatLon, b: LatLon): number => centralAngle(a, b) * R_MOON_KM * 1000;
