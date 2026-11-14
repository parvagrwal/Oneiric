import { DEG, DISC_SAMPLES, EARTH_RADIUS_KM, SUN_RADIUS_KM } from './constants.ts';
import { azElOfDirection, directionFromSite, type SiteFrame } from './frame.ts';
import { horizonRange, skylineAt, type Skyline } from './skyline.ts';
import { cross, dot, norm, sub, unit, type Vec3 } from './vec.ts';

// 64 points spread evenly (by area) over the unit disc: radius sqrt((k + 0.5) / n), golden-angle spiral.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DISC = Array.from({ length: DISC_SAMPLES }, (_, k) => ({
  r: Math.sqrt((k + 0.5) / DISC_SAMPLES),
  c: Math.cos(k * GOLDEN),
  s: Math.sin(k * GOLDEN),
}));

export interface SunResult {
  /** Share of the solar disc samples that are above the skyline and not behind Earth's disc (0..1). */
  f: number;
  /** Share of the solar disc samples covered by Earth's disc, whatever the terrain (0..1). */
  cover: number;
}

/** Angular radius (radians) of a sphere of radius `rKm` seen from `distKm`. */
const angRadius = (rKm: number, distKm: number) => Math.asin(Math.min(1, rKm / distKm));

/** Sunlit fraction f. `sun` and `earth` are Moon-centred vectors in km. Direction is taken from the site. */
export function sunFraction(frame: SiteFrame, sun: Vec3, earth: Vec3, sky: Skyline, noFastPath = false): SunResult {
  const vs = sub(sun, frame.r0);
  const ve = sub(earth, frame.r0);
  const dist = norm(vs);
  const ds = unit(vs);
  const de = unit(ve);
  const rhoS = angRadius(SUN_RADIUS_KM, dist);
  const rhoE = angRadius(EARTH_RADIUS_KM, norm(ve));
  const c = azElOfDirection(frame, ds);

  if (!noFastPath) {
    // Fast path: if the Sun's disc (plus 0.03 degrees) is entirely clear of, or entirely below, every skyline
    // bin that could reach it, and Earth is nowhere near, f is 1 or 0 without sampling the disc.
    const sepRad = Math.acos(Math.max(-1, Math.min(1, dot(ds, de))));
    if (sepRad > rhoS + rhoE + 0.5 * DEG) {
      const margin = 0.3;
      const cosEl = Math.cos(c.el * DEG);
      const dAz = cosEl < 0.05 ? 180 : Math.min(180, margin / cosEl);
      const { lo, hi } = horizonRange(sky, c.az, dAz);
      if (c.el - margin > hi) return { f: 1, cover: 0 };
      if (c.el + margin < lo) return { f: 0, cover: 0 };
    }
  }

  // Tangent basis around the Sun's direction.
  const ref: Vec3 = Math.abs(ds[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const a = unit(cross(ds, ref));
  const b = cross(ds, a);
  const cosE = Math.cos(rhoE);
  let visible = 0;
  let covered = 0;
  for (const p of DISC) {
    const rr = p.r * rhoS;
    const sr = Math.sin(rr);
    const cr = Math.cos(rr);
    const ox = p.c * sr;
    const oy = p.s * sr;
    const dir: Vec3 = [
      ds[0] * cr + a[0] * ox + b[0] * oy,
      ds[1] * cr + a[1] * ox + b[1] * oy,
      ds[2] * cr + a[2] * ox + b[2] * oy,
    ];
    const behindEarth = dot(dir, de) > cosE;
    if (behindEarth) covered++;
    const { az, el } = azElOfDirection(frame, dir);
    if (!behindEarth && el >= skylineAt(sky, az).H) visible++;
  }
  return { f: visible / DISC_SAMPLES, cover: covered / DISC_SAMPLES };
}

/** Earth is visible when its centre is at or above the skyline plus the margin (degrees, default 0). */
export function earthVisible(frame: SiteFrame, earth: Vec3, sky: Skyline, marginDeg = 0): boolean {
  const { az, el } = azElOfDirection(frame, directionFromSite(frame, earth));
  return el >= skylineAt(sky, az).H + marginDeg;
}
