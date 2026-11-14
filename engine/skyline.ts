import { DEG, R_MOON_KM, SKY_BINS, SKY_BIN_DEG } from './constants.ts';
import { wrap360 } from './vec.ts';

export type Grade = 'A' | 'B' | 'C' | 'D';
export const SMOOTH_TERRAIN_LABEL = 'none (smooth sphere)';

export interface Skyline {
  /** Horizon elevation in degrees at the centre of each 0.25 degree azimuth bin (bin i is centred on (i + 0.5) * 0.25). */
  H: Float32Array;
  /** Distance to the blocking terrain, in 10 m units. */
  D: Uint16Array;
  grade: Grade;
  /** Name of the terrain product, or SMOOTH_TERRAIN_LABEL. */
  terrain: string;
  heightM: number;
  hMin: number;
  hMax: number;
}

/** Horizon dip on a smooth sphere seen from height h metres, degrees (negative). */
export const smoothHorizonDeg = (heightM: number) =>
  -Math.acos(R_MOON_KM / (R_MOON_KM + heightM / 1000)) / DEG;

export function smoothSkyline(heightM: number): Skyline {
  const h = smoothHorizonDeg(heightM);
  return {
    H: new Float32Array(SKY_BINS).fill(h),
    D: new Uint16Array(SKY_BINS),
    grade: 'D',
    terrain: SMOOTH_TERRAIN_LABEL,
    heightM,
    hMin: Math.fround(h),
    hMax: Math.fround(h),
  };
}

/** Validate and wrap terrain data. Refuses a smooth sphere dressed up as terrain, and terrain labelled grade D. */
export function makeSkyline(a: { H: Float32Array; D: Uint16Array; grade: Grade; terrain: string; heightM: number }): Skyline {
  if (a.H.length !== SKY_BINS || a.D.length !== SKY_BINS) throw new RangeError(`skyline needs ${SKY_BINS} bins`);
  if (!['A', 'B', 'C', 'D'].includes(a.grade)) throw new Error(`unknown grade: ${String(a.grade)}`);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const v of a.H) {
    if (!Number.isFinite(v)) throw new RangeError('skyline contains a non-finite elevation');
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  const smooth = Math.fround(smoothHorizonDeg(a.heightM));
  const looksSmooth = Math.abs(hMax - smooth) < 1e-6 && Math.abs(hMin - smooth) < 1e-6;
  if (a.grade !== 'D' && a.terrain === SMOOTH_TERRAIN_LABEL) throw new Error('grade above D needs a terrain product name');
  if (a.grade !== 'D' && looksSmooth) throw new Error('smooth-sphere data cannot carry a terrain grade; use grade D');
  if (a.grade === 'D' && a.terrain !== SMOOTH_TERRAIN_LABEL) throw new Error('grade D means smooth sphere; terrain must be "none (smooth sphere)"');
  return { ...a, hMin, hMax };
}

/** Use the terrain skyline if there is one. Otherwise fall back to the smooth sphere, which is always grade D. */
export const skylineOrSmooth = (sky: Skyline | undefined | null, heightM: number): Skyline =>
  sky ?? smoothSkyline(heightM);

/** Horizon elevation (linear between bin centres, wraps at 360) and the distance of the nearer bin. */
export function skylineAt(sky: Skyline, azDeg: number): { H: number; D: number } {
  const x = wrap360(azDeg) / SKY_BIN_DEG - 0.5;
  const i0f = Math.floor(x);
  const f = x - i0f;
  const i0 = ((i0f % SKY_BINS) + SKY_BINS) % SKY_BINS;
  const i1 = (i0 + 1) % SKY_BINS;
  return { H: sky.H[i0] * (1 - f) + sky.H[i1] * f, D: sky.D[f < 0.5 ? i0 : i1] };
}

/** Lowest and highest horizon elevation among the bins that can influence azimuths in [az - dAz, az + dAz]. */
export function horizonRange(sky: Skyline, azDeg: number, dAzDeg: number): { lo: number; hi: number } {
  if (dAzDeg >= 180) return { lo: sky.hMin, hi: sky.hMax };
  const a = Math.floor((azDeg - dAzDeg) / SKY_BIN_DEG - 0.5) - 1;
  const b = Math.ceil((azDeg + dAzDeg) / SKY_BIN_DEG - 0.5) + 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = a; k <= b; k++) {
    const v = sky.H[((k % SKY_BINS) + SKY_BINS) % SKY_BINS];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}
