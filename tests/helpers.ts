import { AU_KM, ROW, smoothSiteFrame, type EphemTable, type SiteFrame, type Vec3 } from '../engine/index.ts';

/** A body at unit direction `dir` as seen from the site, `distKm` away from the site (Moon-centred position). */
export function bodyAt(frame: SiteFrame, dirEnuElAz: { el: number; az: number }, distKm: number): Vec3 {
  const el = (dirEnuElAz.el * Math.PI) / 180;
  const az = (dirEnuElAz.az * Math.PI) / 180;
  const d: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    d[i] = frame.up[i] * Math.sin(el) + (frame.north[i] * Math.cos(az) + frame.east[i] * Math.sin(az)) * Math.cos(el);
  }
  return [frame.r0[0] + d[0] * distKm, frame.r0[1] + d[1] * distKm, frame.r0[2] + d[2] * distKm];
}

/** Synthetic hourly table (2030 only) where the Sun and Earth directions come from `fn(hoursSinceJan1)`. */
export function syntheticTable(fn: (h: number) => { sun: Vec3; earth: Vec3 }, year = 2030): EphemTable {
  const rows = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000 + 1;
  const data = new Float32Array(rows * ROW);
  for (let i = 0; i < rows; i++) {
    const { sun, earth } = fn(i);
    const rs = Math.hypot(...sun), re = Math.hypot(...earth);
    data.set([sun[0] / rs, sun[1] / rs, sun[2] / rs, rs, earth[0] / re, earth[1] / re, earth[2] / re, re], i * ROW);
  }
  return { years: new Map([[year, data]]) };
}

/** Period of the synthetic turning Sun, hours. A real Moon-fixed Sun turns once in about 708 h; hourly rows then barely cut the arc. */
export const SPIN_PERIOD_H = 720;
export const SPIN_RATE_DEG_PER_H = 360 / SPIN_PERIOD_H;

/** Sun turning once per 720 h around a site at lat 0, lon 0 (overhead at hour 0 of each cycle), Earth 90 degrees behind it. */
export function spinningTable(): EphemTable {
  const w = (2 * Math.PI) / SPIN_PERIOD_H;
  return syntheticTable((h) => ({
    sun: [AU_KM * Math.cos(w * h), AU_KM * Math.sin(w * h), 0],
    earth: [384400 * Math.cos(w * h - Math.PI / 2), 384400 * Math.sin(w * h - Math.PI / 2), 0],
  }));
}
export const spinSite = () => smoothSiteFrame(0, 0, 2);
/** Start of a cycle: Jan 1 2030 plus 120 days (a whole number of cycles). */
export const T2030 = Date.UTC(2030, 0, 1) + 120 * 86_400_000;
