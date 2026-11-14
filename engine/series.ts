import { DARK_BELOW, MIN_MS } from './constants.ts';
import { ephemAt, type EphemTable } from './ephemeris.ts';
import { azElOfDirection, directionFromSite, type SiteFrame } from './frame.ts';
import { type Grade, type Skyline } from './skyline.ts';
import { earthVisible, sunFraction } from './sunlight.ts';
import { norm, sub } from './vec.ts';

export interface Sample {
  sunAz: number; sunEl: number; sunF: number; earthCover: number;
  earthAz: number; earthEl: number; earthVis: boolean; sunDistKm: number;
}

export interface Site {
  frame: SiteFrame;
  sky: Skyline;
  /** Earth visibility margin above the skyline, degrees (default 0). */
  marginDeg?: number;
}

/** The single place where Sun and Earth state at one instant is computed. */
export function sampleAt(table: EphemTable, site: Site, tMs: number): Sample {
  const { sun, earth } = ephemAt(table, tMs);
  const fr = site.frame;
  const s = azElOfDirection(fr, directionFromSite(fr, sun));
  const e = azElOfDirection(fr, directionFromSite(fr, earth));
  const r = sunFraction(fr, sun, earth, site.sky);
  return {
    sunAz: s.az, sunEl: s.el, sunF: r.f, earthCover: r.cover,
    earthAz: e.az, earthEl: e.el,
    earthVis: earthVisible(fr, earth, site.sky, site.marginDeg ?? 0),
    sunDistKm: norm(sub(sun, fr.r0)),
  };
}

export interface Series {
  t0Ms: number;
  stepMs: number;
  n: number;
  sunAz: Float64Array; sunEl: Float64Array; sunF: Float32Array; earthCover: Float32Array;
  earthAz: Float64Array; earthEl: Float64Array; earthVis: Uint8Array; sunDistKm: Float64Array;
  grade: Grade;
  terrain: string;
  heightM: number;
  /** Evaluate one instant with the same code that filled the arrays (used to refine times to 1 minute). */
  probe: (tMs: number) => Sample;
}

/** Samples at t0 + k * step for k = 0 .. n-1, covering the window [t0, t1). Step k stands for [t_k, t_k + step). */
export function series(table: EphemTable, site: Site, t0Ms: number, t1Ms: number, stepMin: number): Series {
  const stepMs = stepMin * MIN_MS;
  if (!(stepMs > 0) || !(t1Ms > t0Ms)) throw new RangeError('series needs t1 > t0 and a positive step');
  const n = Math.ceil((t1Ms - t0Ms) / stepMs);
  const out: Series = {
    t0Ms, stepMs, n,
    sunAz: new Float64Array(n), sunEl: new Float64Array(n), sunF: new Float32Array(n), earthCover: new Float32Array(n),
    earthAz: new Float64Array(n), earthEl: new Float64Array(n), earthVis: new Uint8Array(n), sunDistKm: new Float64Array(n),
    grade: site.sky.grade, terrain: site.sky.terrain, heightM: site.sky.heightM,
    probe: (t) => sampleAt(table, site, t),
  };
  for (let k = 0; k < n; k++) {
    const p = sampleAt(table, site, t0Ms + k * stepMs);
    out.sunAz[k] = p.sunAz; out.sunEl[k] = p.sunEl; out.sunF[k] = p.sunF; out.earthCover[k] = p.earthCover;
    out.earthAz[k] = p.earthAz; out.earthEl[k] = p.earthEl; out.earthVis[k] = p.earthVis ? 1 : 0; out.sunDistKm[k] = p.sunDistKm;
  }
  return out;
}

export const isDark = (f: number) => f < DARK_BELOW;
