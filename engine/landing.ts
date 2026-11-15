// Landing-error robustness: the points around a site that a lander could actually reach, and the near field a
// 5 m product would cover.
//
// The rule this file exists to enforce: a point is reported as terrain-covered only when a stored skyline exists
// for that exact point at that exact observer height. Everything else is reported as unavailable, with the reason,
// and a caller must not substitute the centre site's skyline for a circle point. Inventing terrain for a point
// that has no stored skyline is the failure this file is written to make impossible.
import { R_MOON_KM } from './constants.ts';
import { centralAngle, destinationPoint, type LatLon } from './geo.ts';

/** Circle radius in the product's own terms: a 100 m landing circle means 100 m from the target point. */
export const DEFAULT_CIRCLE_RADIUS_M = 100;

/** Eight points, every 45°, plus the centre when `includeCentre`. North first, then clockwise (north through east). */
export const CIRCLE_AZIMUTHS_DEG: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];

export interface CirclePoint extends LatLon {
  /** 0 for the centre, otherwise the azimuth from the centre, degrees from north through east. */
  azDeg: number;
  /** Ground distance from the centre, metres. */
  distanceM: number;
}

/** `count` points on a circle of `radiusM` around `centre`, evenly spaced in azimuth, north through east. */
export function landingCirclePoints(centre: LatLon, radiusM = DEFAULT_CIRCLE_RADIUS_M, count = CIRCLE_AZIMUTHS_DEG.length): CirclePoint[] {
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new RangeError(`circle radius must be positive metres, got ${radiusM}`);
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`circle point count must be a positive integer, got ${count}`);
  const theta = radiusM / (R_MOON_KM * 1000);
  const out: CirclePoint[] = [];
  for (let k = 0; k < count; k++) {
    const azDeg = (360 / count) * k;
    const p = destinationPoint(centre, azDeg, theta);
    out.push({ ...p, azDeg, distanceM: radiusM });
  }
  return out;
}

/** The centre plus every circle point, in the order the report prints them. */
export function landingCircleWithCentre(
  centre: LatLon,
  radiusM = DEFAULT_CIRCLE_RADIUS_M,
  count = CIRCLE_AZIMUTHS_DEG.length,
): CirclePoint[] {
  return [{ ...centre, azDeg: 0, distanceM: 0 }, ...landingCirclePoints(centre, radiusM, count)];
}

/** A stored 5 m near-field raster, as far as the geometry of a circle point is concerned. */
export interface NearFieldRaster {
  /** Stable identifier, shown to the reader. */
  id: string;
  /** The point the raster is published for. */
  centre: LatLon;
  /** Half-width of the raster's coverage, metres. A point is covered when it is inside this radius. */
  halfWidthM: number;
  /** Native pixel size, metres. */
  pixelM: number;
  grade: 'A';
  source: string;
}

export interface NearFieldMatch {
  point: LatLon;
  /** Distance from the raster centre to the point, metres. */
  distanceFromCentreM: number;
  raster: NearFieldRaster;
}

export interface NearFieldAvailability {
  /** Points covered by a stored 5 m raster. */
  covered: NearFieldMatch[];
  /** Points inside no raster's coverage. Reported, never filled in from a coarser product. */
  uncovered: LatLon[];
  /** True only when every point is covered by some raster. */
  complete: boolean;
}

/**
 * Which circle points sit inside a stored 5 m near-field raster. A point inside the coverage circle is a
 * candidate; a caller with the raster in hand still has to read it. Nothing here implies a height was measured.
 */
export function nearFieldAvailability(points: readonly LatLon[], rasters: readonly NearFieldRaster[]): NearFieldAvailability {
  for (const r of rasters) {
    if (r.grade !== 'A') throw new Error(`a near-field raster must be grade A, got ${r.grade} for ${r.id}`);
    if (!(r.halfWidthM > 0)) throw new RangeError(`near-field raster ${r.id} has no coverage half-width`);
  }
  const covered: NearFieldMatch[] = [];
  const uncovered: LatLon[] = [];
  for (const point of points) {
    let best: NearFieldMatch | null = null;
    for (const raster of rasters) {
      const d = centralAngle(raster.centre, point) * R_MOON_KM * 1000;
      if (d <= raster.halfWidthM && (!best || d < best.distanceFromCentreM)) {
        best = { point, distanceFromCentreM: d, raster };
      }
    }
    if (best) covered.push(best);
    else uncovered.push(point);
  }
  return { covered, uncovered, complete: uncovered.length === 0 };
}
