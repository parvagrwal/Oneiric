// Terrain horizon ("skyline") of a site, computed from elevation rasters in south polar stereographic projection.
// Pure functions: the same code runs in the Node pipeline and in a Web Worker.
import { DEG, R_MOON_KM, SKY_BINS, SKY_BIN_DEG } from './constants.ts';
import { siteFrame } from './frame.ts';
import type { Grade } from './skyline.ts';

const R_M = R_MOON_KM * 1000;

/** Longest ray, metres along the surface. */
export const MAX_RANGE_M = 450_000;
/** Distance limits of the three raster tiers, metres: 20 m data under 15 km, 80 m under 80 km, 240 m beyond. */
export const TIER_LIMITS_M = [15_000, 80_000, Infinity] as const;

/** South polar stereographic on the sphere of radius R: +x toward 90 degrees east, +y toward 0 degrees east. Metres. */
export function southPolarXY(latDeg: number, lonDeg: number): { x: number; y: number } {
  const r = 2 * R_M * Math.tan((45 + latDeg / 2) * DEG);
  return { x: r * Math.sin(lonDeg * DEG), y: r * Math.cos(lonDeg * DEG) };
}

/** An elevation raster: square pixels, row 0 at the largest y, column 0 at the smallest x. */
export interface DemGrid {
  /** Product name, printed as the terrain source. */
  name: string;
  pixelM: number;
  /** Map x of the outer edge of column 0, and map y of the outer edge of row 0, metres. */
  xEdgeM: number;
  yEdgeM: number;
  width: number;
  height: number;
  /** Heights in metres above the sphere of radius R, row by row. NaN marks a pixel with no data. */
  z: Float32Array;
  /** Highest height in the raster, metres. */
  zMaxM: number;
}

/** Validate a raster and find its highest point. Refuses heights that cannot be metres on the Moon. */
export function makeDemGrid(a: Omit<DemGrid, 'zMaxM'>): DemGrid {
  if (!(a.pixelM > 0) || !Number.isFinite(a.xEdgeM) || !Number.isFinite(a.yEdgeM)) throw new RangeError(`raster ${a.name}: bad georeferencing`);
  if (!Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 2 || a.height < 2 || a.z.length !== a.width * a.height)
    throw new RangeError(`raster ${a.name}: size ${a.width} x ${a.height} does not match ${a.z.length} heights`);
  let zMaxM = -Infinity;
  let zMinM = Infinity;
  for (const v of a.z) {
    if (v > zMaxM) zMaxM = v;
    if (v < zMinM) zMinM = v;
  }
  if (!Number.isFinite(zMaxM)) throw new RangeError(`raster ${a.name}: no valid height`);
  // Lunar relief stays within about -9.2 km and +10.8 km of the reference sphere.
  if (zMaxM > 12_000 || zMinM < -12_000) throw new RangeError(`raster ${a.name}: heights from ${zMinM} to ${zMaxM} are not metres above the reference sphere`);
  return { ...a, zMaxM };
}

/** Height at map point (x, y), bilinear between pixel centres. NaN outside the raster or next to a no-data pixel. */
export function demHeight(g: DemGrid, xM: number, yM: number): number {
  const cx = (xM - g.xEdgeM) / g.pixelM - 0.5;
  const cy = (g.yEdgeM - yM) / g.pixelM - 0.5;
  let i = Math.floor(cx);
  let j = Math.floor(cy);
  // A point exactly on the last pixel centre still has a height.
  if (cx === g.width - 1) i--;
  if (cy === g.height - 1) j--;
  if (!(i >= 0 && j >= 0 && i + 1 < g.width && j + 1 < g.height)) return NaN;
  const fx = cx - i;
  const fy = cy - j;
  const k = j * g.width + i;
  const top = g.z[k] * (1 - fx) + g.z[k + 1] * fx;
  const bottom = g.z[k + g.width] * (1 - fx) + g.z[k + g.width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** One raster and the distance (metres from the site) below which it is preferred. */
export interface Tier {
  dem: DemGrid;
  maxDistM: number;
}

export interface BuildOptions {
  /** Step along the ray, in pixels of the raster in use (default 0.5). */
  stepPixels?: number;
  /** Rays per 0.25 degree azimuth bin (default 4). */
  subRays?: number;
  maxRangeM?: number;
}

export interface BuiltSkyline {
  /** Horizon elevation, degrees, one value per 0.25 degree bin; the highest of the bin's rays. */
  H: Float32Array;
  /** Distance to the terrain that sets the horizon, in 10 m units. */
  D: Uint16Array;
  heightM: number;
  /** Terrain height at the site, metres above the reference sphere, from the finest raster that covers it. */
  siteElevationM: number;
  /** Names of the rasters that supplied at least one sample, finest first. */
  products: string[];
  /** Samples taken from each tier, in tier order. */
  samplesPerTier: number[];
  /** Farthest sample taken on any ray, metres. */
  distanceReachedM: number;
  /** Rays that ran off every raster before reaching the range limit or the point where no terrain could matter. */
  raysEndedAtRasterEdge: number;
  /** True when every sample nearer than the first tier's limit came from the first tier. */
  nearFieldComplete: boolean;
  stepPixels: number;
  subRays: number;
}

/**
 * Skyline of the point (lat, lon) seen from `heightM` above the terrain.
 * Each ray walks outward along a great circle. The elevation of each terrain sample is taken in 3-D from the
 * site at radius R + z_site + h to the sample at radius R + z, so the Moon's curvature is included.
 * A ray stops at the range limit, when it leaves every raster, or when even the highest terrain in the rasters,
 * placed at that distance or anywhere beyond it, would sit below the horizon found so far.
 */
export function buildSkyline(tiers: Tier[], latDeg: number, lonDeg: number, heightM: number, opts: BuildOptions = {}): BuiltSkyline {
  const stepPixels = opts.stepPixels ?? 0.5;
  const subRays = opts.subRays ?? 4;
  const maxRangeM = opts.maxRangeM ?? MAX_RANGE_M;
  if (tiers.length === 0) throw new Error('buildSkyline needs at least one elevation raster');
  if (!(stepPixels > 0) || !Number.isInteger(subRays) || subRays < 1 || !(maxRangeM > 0)) throw new RangeError('bad skyline build options');
  if (!(heightM >= 0)) throw new RangeError(`height above terrain must be zero or more, got ${heightM}`);
  for (let t = 1; t < tiers.length; t++) {
    if (!(tiers[t].maxDistM > tiers[t - 1].maxDistM) || !(tiers[t].dem.pixelM > tiers[t - 1].dem.pixelM))
      throw new Error('raster tiers must go from fine and near to coarse and far');
  }

  const sitePoint = southPolarXY(latDeg, lonDeg);
  let siteElevationM = NaN;
  for (const t of tiers) {
    siteElevationM = demHeight(t.dem, sitePoint.x, sitePoint.y);
    if (Number.isFinite(siteElevationM)) break;
  }
  if (!Number.isFinite(siteElevationM)) throw new RangeError(`site ${latDeg}, ${lonDeg} is outside every elevation raster`);

  const siteRadiusM = R_M + siteElevationM + heightM;
  const { up, east, north } = siteFrame(latDeg, lonDeg, siteRadiusM);
  const topRadiusM = R_M + Math.max(...tiers.map((t) => t.dem.zMaxM));
  /** Elevation angle (radians) of a point at `radiusM` from the Moon's centre, an angle theta away around the sphere. */
  const elevation = (radiusM: number, cosT: number, sinT: number) => Math.atan2(radiusM * cosT - siteRadiusM, radiusM * sinT);

  const H = new Float32Array(SKY_BINS);
  const D = new Uint16Array(SKY_BINS);
  const samplesPerTier = tiers.map(() => 0);
  let distanceReachedM = 0;
  let raysEndedAtRasterEdge = 0;
  let nearFieldComplete = true;

  for (let bin = 0; bin < SKY_BINS; bin++) {
    let best = -Infinity;
    let bestDistM = 0;
    for (let ray = 0; ray < subRays; ray++) {
      const az = (bin + (ray + 0.5) / subRays) * SKY_BIN_DEG * DEG;
      const ca = Math.cos(az);
      const sa = Math.sin(az);
      const dx = north[0] * ca + east[0] * sa;
      const dy = north[1] * ca + east[1] * sa;
      const dz = north[2] * ca + east[2] * sa;
      let s = tiers[0].dem.pixelM;
      while (s < maxRangeM) {
        const theta = s / R_M;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        // Unit vector of the ground point, then its south polar stereographic map position.
        const px = up[0] * cosT + dx * sinT;
        const py = up[1] * cosT + dy * sinT;
        const pz = up[2] * cosT + dz * sinT;
        const k = (2 * R_M) / (1 - pz);
        const x = k * py;
        const y = k * px;
        let used = -1;
        let z = NaN;
        for (let t = 0; t < tiers.length; t++) {
          if (s >= tiers[t].maxDistM) continue;
          z = demHeight(tiers[t].dem, x, y);
          if (Number.isFinite(z)) { used = t; break; }
        }
        if (used < 0) {
          raysEndedAtRasterEdge++;
          if (s < tiers[0].maxDistM) nearFieldComplete = false;
          break;
        }
        if (used > 0 && s < tiers[0].maxDistM) nearFieldComplete = false;
        samplesPerTier[used]++;
        if (s > distanceReachedM) distanceReachedM = s;
        const el = elevation(R_M + z, cosT, sinT);
        if (el > best) { best = el; bestDistM = s; }
        // Past its own tangent point, the highest shell only sinks as the ray goes on. Before that point it still rises,
        // so the test must wait: the horizon so far may come from another ray of this bin.
        if (siteRadiusM * cosT < topRadiusM && elevation(topRadiusM, cosT, sinT) < best) break;
        s += stepPixels * tiers[used].dem.pixelM;
      }
    }
    if (!Number.isFinite(best)) throw new RangeError(`no terrain sample in the azimuth bin starting at ${bin * SKY_BIN_DEG} degrees; the site is at the edge of the rasters`);
    H[bin] = best / DEG;
    D[bin] = Math.min(65535, Math.round(bestDistM / 10));
  }

  return {
    H, D, heightM, siteElevationM,
    products: tiers.filter((_, t) => samplesPerTier[t] > 0).map((t) => t.dem.name),
    samplesPerTier, distanceReachedM, raysEndedAtRasterEdge, nearFieldComplete, stepPixels, subRays,
  };
}

/**
 * Fidelity grade of a built skyline. B: a 20 m raster supplied the whole near field.
 * C: the 240 m raster alone. Any other mix has no defined grade and is refused.
 */
export function terrainGrade(tiers: Tier[], built: Pick<BuiltSkyline, 'nearFieldComplete' | 'samplesPerTier'>): Grade {
  const used = tiers.filter((_, t) => built.samplesPerTier[t] > 0).map((t) => t.dem.pixelM);
  if (tiers[0].dem.pixelM <= 20 && built.nearFieldComplete) return 'B';
  if (used.length === 1 && used[0] === 240) return 'C';
  throw new Error(`no fidelity grade is defined for rasters of ${used.join(', ')} m without a complete 20 m near field`);
}

/** Size of a stored skyline: 1,440 little-endian 32-bit floats (H) followed by 1,440 little-endian 16-bit integers (D). */
export const SKYLINE_BYTES = SKY_BINS * 6;

export function encodeSkyline(H: Float32Array, D: Uint16Array): ArrayBuffer {
  if (H.length !== SKY_BINS || D.length !== SKY_BINS) throw new RangeError(`skyline needs ${SKY_BINS} bins`);
  const buf = new ArrayBuffer(SKYLINE_BYTES);
  const view = new DataView(buf);
  for (let i = 0; i < SKY_BINS; i++) {
    view.setFloat32(i * 4, H[i], true);
    view.setUint16(SKY_BINS * 4 + i * 2, D[i], true);
  }
  return buf;
}

export function decodeSkyline(buf: ArrayBuffer): { H: Float32Array; D: Uint16Array } {
  if (buf.byteLength !== SKYLINE_BYTES) throw new RangeError(`a stored skyline is ${SKYLINE_BYTES} bytes, got ${buf.byteLength}`);
  const view = new DataView(buf);
  const H = new Float32Array(SKY_BINS);
  const D = new Uint16Array(SKY_BINS);
  for (let i = 0; i < SKY_BINS; i++) {
    H[i] = view.getFloat32(i * 4, true);
    D[i] = view.getUint16(SKY_BINS * 4 + i * 2, true);
  }
  return { H, D };
}
