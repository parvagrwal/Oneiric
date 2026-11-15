// What blocks the Sun or the Earth: the terrain at the body's azimuth, and where that terrain is on the ground.
//
// The rule this file exists to enforce: the answer is read from the stored skyline's blocking distance (D), never
// invented. A smooth-sphere skyline records no terrain, so it reports that there is nothing to point at instead of
// naming a ridge that was never in the data. The app draws the point this returns; it computes no lookups of its own.
import { DEG } from './constants.ts';
import { SKY_BIN_DEG } from './constants.ts';
import { destinationPoint, groundDistanceM, type LatLon } from './geo.ts';
import { skylineAt, type Skyline } from './skyline.ts';

export interface BlockingTerrain {
  /** Body azimuth at the instant, degrees from north through east. */
  azDeg: number;
  /** Skyline elevation at that azimuth, degrees. */
  horizonDeg: number;
  /** Body elevation at the instant, degrees. */
  bodyElDeg: number;
  /** How far the body sits above the horizon, degrees. Negative when the body itself is below it. */
  clearanceDeg: number;
  /** Distance to the blocking terrain, km, from the skyline's recorded D. Null when the skyline records none. */
  distanceKm: number | null;
  /** Where that terrain is, on the ground. Null when the skyline records no blocking distance. */
  point: LatLon | null;
  /** Recovered height of the blocking terrain above the site's own surface, metres. Null when D is unknown. */
  riseM: number | null;
  /** Index of the 0.25° skyline bin the lookup used, for a caller that wants to shade that bin. */
  binIndex: number;
}

/**
 * The terrain that sets the horizon at `azDeg`, and the point on the ground it sits at.
 *
 * The rise is derived from the recorded distance and horizon angle alone, so it is a consequence of the shipped
 * file rather than a second measurement, and needs no separate site elevation.
 */
export function blockingTerrain(
  site: LatLon,
  sky: Skyline,
  azDeg: number,
  bodyElDeg: number,
): BlockingTerrain {
  const look = skylineAt(sky, azDeg);
  const binIndex = Math.round((((azDeg % 360) + 360) % 360) / SKY_BIN_DEG - 0.5) % sky.H.length;
  const wrappedBin = binIndex < 0 ? binIndex + sky.H.length : binIndex;
  const distanceKm = sky.grade === 'D' || look.D <= 0 ? null : look.D / 100;
  let point: LatLon | null = null;
  let riseM: number | null = null;
  if (distanceKm !== null) {
    point = destinationPoint(site, azDeg, distanceKm / 1737.4);
    // Height of the terrain above the site's own horizon plane, from the horizon angle it subtends.
    riseM = distanceKm * 1000 * Math.tan(Math.max(0, look.H) * DEG);
  }
  return {
    azDeg,
    horizonDeg: look.H,
    bodyElDeg,
    clearanceDeg: bodyElDeg - look.H,
    distanceKm,
    point,
    riseM,
    binIndex: wrappedBin,
  };
}

/** Straight-line ground distance from a site to a blocking point, metres. Null when no point is recorded. */
export const blockingGroundDistanceM = (site: LatLon, b: Pick<BlockingTerrain, 'point'>): number | null =>
  b.point ? groundDistanceM(site, b.point) : null;
