// Synthetic elevation rasters with a horizon that is known in advance. Used only by the skyline maths check and the tests.
// The map-to-sphere conversion here is written independently of the engine's sphere-to-map conversion,
// so a mirrored or rotated projection in the engine cannot cancel out.
import { DEG, R_MOON_KM } from '../engine/constants.ts';
import { siteFrame } from '../engine/frame.ts';
import { makeDemGrid, type DemGrid } from '../engine/terrain.ts';
import { cross, dot, norm, type Vec3 } from '../engine/vec.ts';

const R_M = R_MOON_KM * 1000;

export const SYNTHETIC_LABEL = 'synthetic test terrain';

/** Where a ground point sits relative to the site: distance along the surface (m) and azimuth (degrees, north through east). */
export interface Relative { distM: number; azDeg: number; eastM: number; northM: number }
export type HeightFn = (rel: Relative, q: Vec3) => number;

/** Unit vector of the ground point at map position (x, y): inverse south polar stereographic. */
export function groundPoint(xM: number, yM: number): Vec3 {
  const lat = -90 * DEG + 2 * Math.atan(Math.hypot(xM, yM) / (2 * R_M));
  const lon = Math.atan2(xM, yM);
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Unit vector of the point `distM` from the site along azimuth `azDeg`. */
export function pointFromSite(latDeg: number, lonDeg: number, distM: number, azDeg: number): Vec3 {
  const { up, east, north } = siteFrame(latDeg, lonDeg, R_M);
  const t = distM / R_M;
  const c = Math.cos(azDeg * DEG), s = Math.sin(azDeg * DEG);
  return [0, 1, 2].map((i) => up[i] * Math.cos(t) + (north[i] * c + east[i] * s) * Math.sin(t)) as Vec3;
}

export const surfaceDistM = (a: Vec3, b: Vec3) => R_M * Math.atan2(norm(cross(a, b)), dot(a, b));

/** A raster of `pixelM` pixels reaching `halfWidthM` from the site in map x and y, filled from `heightAt` (or zeros). */
export function syntheticDem(name: string, pixelM: number, halfWidthM: number, latDeg: number, lonDeg: number, heightAt?: HeightFn): DemGrid {
  const { up, east, north } = siteFrame(latDeg, lonDeg, R_M);
  const r = 2 * R_M * Math.tan((45 + latDeg / 2) * DEG);
  const cx = r * Math.sin(lonDeg * DEG), cy = r * Math.cos(lonDeg * DEG);
  const xEdgeM = Math.floor((cx - halfWidthM) / pixelM) * pixelM;
  const yEdgeM = Math.ceil((cy + halfWidthM) / pixelM) * pixelM;
  const width = Math.ceil((2 * halfWidthM) / pixelM) + 1;
  const z = new Float32Array(width * width);
  if (heightAt) {
    for (let j = 0; j < width; j++) {
      const y = yEdgeM - (j + 0.5) * pixelM;
      for (let i = 0; i < width; i++) {
        const q = groundPoint(xEdgeM + (i + 0.5) * pixelM, y);
        const distM = surfaceDistM(q, up);
        const az = Math.atan2(dot(q, east), dot(q, north));
        z[j * width + i] = heightAt({ distM, azDeg: az / DEG, eastM: distM * Math.sin(az), northM: distM * Math.cos(az) }, q);
      }
    }
  }
  return makeDemGrid({ name, pixelM, xEdgeM, yEdgeM, width, height: width, z });
}

/** Mirror a raster left to right in place of its columns: what a wrongly mirrored file would hold. */
export function mirrorColumns(g: DemGrid): DemGrid {
  const z = new Float32Array(g.z.length);
  for (let j = 0; j < g.height; j++) for (let i = 0; i < g.width; i++) z[j * g.width + i] = g.z[j * g.width + (g.width - 1 - i)];
  return { ...g, z };
}

/** Transpose a square raster: what a file with swapped axes would hold. */
export function swapAxes(g: DemGrid): DemGrid {
  const z = new Float32Array(g.z.length);
  for (let j = 0; j < g.height; j++) for (let i = 0; i < g.width; i++) z[j * g.width + i] = g.z[i * g.width + j];
  return { ...g, z };
}

/** Multiply every height: what a wrong unit or scale factor would give. */
export function scaleHeights(g: DemGrid, k: number): DemGrid {
  return makeDemGrid({ ...g, z: g.z.map((v) => v * k) });
}
