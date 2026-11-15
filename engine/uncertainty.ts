// Uncertainty on a horizon: the skyline shifted by the elevation angle a stated surface-height error subtends at
// the distance of the terrain that sets it.
//
// The rule this file exists to enforce: a range is shown only when a height error has a named source AND a value
// read from that source. A skyline whose product has no error value on file is reported as "no range", never given
// a plausible-looking ±figure. The shift is sigma_z / D, in radians, which is the definition this project fixed
// before the build: a ridge 1 km away and a ridge 100 km away do not get the same band from the same height error.
import { DEG, SKY_BINS } from './constants.ts';
import { skylineAt, type Skyline } from './skyline.ts';

export interface HeightErrorSource {
  /** Stable identifier, printed next to the range. */
  id: string;
  /** Product the error belongs to, for example "LOLA 20 m south-polar DEM". */
  product: string;
  /**
   * One-sigma vertical error, metres, read from the product's own error raster. Null means the error raster exists
   * but its value has not been read into this build, so no range may be shown for this product.
   */
  sigmaZM: number | null;
  /** Where the figure comes from, for the reader to check. */
  source: string;
  /** Date the source was read, for the reader to check it has not changed. */
  retrievedUtc: string;
}

/**
 * The error product that documents each shipped skyline's vertical accuracy. The product page names these rasters;
 * the magnitude is a property of the raster and is read from it, not from the page, so it is not restated here.
 *
 * Both entries ship with `sigmaZM: null` until the error rasters are read by the pipeline. With a null the app
 * prints "no stated height error on file" and shows no band. That is the honest state, and it is a data line to
 * fill in, not a code change.
 */
export const HEIGHT_ERROR_BY_PRODUCT: Record<string, HeightErrorSource> = {
  'LOLA 20 m + LOLA 80 m + LOLA 240 m': {
    id: 'lola-p90-20m',
    product: 'LOLA 20 m south-polar DEM (product 90)',
    sigmaZM: null,
    source:
      'NASA Planetary Geodesy Data Archive, product 90 (Barker et al., "A New View of the Lunar South Pole from LOLA"): the product page lists LDEM_80S_20MPP_ADJ_ERR.TIF, "LDEM surface height error (in meters)". The error value is read from that raster by the pipeline; the raster is not in this checkout. Page read 2026-11-15.',
    retrievedUtc: '2026-11-15',
  },
  'LOLA 240 m': {
    id: 'lola-p90-240m',
    product: 'LOLA 240 m south-polar DEM (product 90)',
    sigmaZM: null,
    source:
      'NASA Planetary Geodesy Data Archive, product 90: the product page lists LDEM_60S_240MPP_ADJ_ERR.TIF, "LDEM surface height error (in meters)". The error value is read from that raster by the pipeline; the raster is not in this checkout. Page read 2026-11-15.',
    retrievedUtc: '2026-11-15',
  },
};

/** The stated height error for a skyline's product, or null when the product has no error record on file. */
export function heightErrorFor(terrain: string): HeightErrorSource | null {
  return HEIGHT_ERROR_BY_PRODUCT[terrain] ?? null;
}

/** True when this terrain name has a height error with a value, so a band can be computed. */
export const hasHeightErrorValue = (terrain: string): boolean => {
  const e = heightErrorFor(terrain);
  return e !== null && e.sigmaZM !== null;
};

/**
 * The angular shift a vertical error subtends at the distance of the blocking terrain, degrees. Returns 0 when the
 * skyline records no distance (a smooth sphere records no terrain, so there is nothing to shift). Refuses a
 * negative sigma rather than treating it as "no uncertainty".
 */
export function horizonShiftDeg(sigmaZM: number, distanceKm: number): number {
  if (!Number.isFinite(sigmaZM) || sigmaZM < 0) throw new RangeError(`height error must be non-negative metres, got ${sigmaZM}`);
  if (!(distanceKm > 0)) return 0;
  return (sigmaZM / (distanceKm * 1000)) / DEG;
}

/** A copy of the skyline with every bin moved by its own distance-dependent shift. The grade is unchanged. */
export function shiftedSkyline(sky: Skyline, sigmaZM: number): Skyline {
  const H = new Float32Array(SKY_BINS);
  for (let i = 0; i < SKY_BINS; i++) {
    const distanceKm = sky.D[i] > 0 ? sky.D[i] / 100 : 0;
    H[i] = sky.H[i] + horizonShiftDeg(sigmaZM, distanceKm);
  }
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const v of H) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
  return { ...sky, H, hMin, hMax };
}

/** Largest shift any bin takes, degrees. Printed next to a range so the reader sees the band, not a bare figure. */
export function worstHorizonShiftDeg(sky: Skyline, sigmaZM: number): number {
  let worst = 0;
  for (let i = 0; i < SKY_BINS; i++) {
    const distanceKm = sky.D[i] > 0 ? sky.D[i] / 100 : 0;
    const s = horizonShiftDeg(sigmaZM, distanceKm);
    if (s > worst) worst = s;
  }
  return worst;
}

/** The horizon at one azimuth with its one-sigma band, degrees, or null sigma when no error value is on file. */
export interface HorizonBand {
  azDeg: number;
  horizonDeg: number;
  /** Null when no height error value is on file; a caller must then print "no band", not 0. */
  sigmaDeg: number | null;
  lowDeg: number | null;
  highDeg: number | null;
}

export function horizonBand(sky: Skyline, azDeg: number, sigmaZM: number | null): HorizonBand {
  const look = skylineAt(sky, azDeg);
  if (sigmaZM === null) return { azDeg, horizonDeg: look.H, sigmaDeg: null, lowDeg: null, highDeg: null };
  const sigmaDeg = horizonShiftDeg(sigmaZM, look.D > 0 ? look.D / 100 : 0);
  return { azDeg, horizonDeg: look.H, sigmaDeg, lowDeg: look.H - sigmaDeg, highDeg: look.H + sigmaDeg };
}
