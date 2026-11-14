// Skyline maths check on synthetic terrain. Every expected value is known before the engine runs:
//   flat ground        -> the smooth-sphere horizon dip
//   a ring-shaped ridge -> the largest value of atan2((R+z)cos(t) - (R+h), (R+z)sin(t)) with t = s/R along the profile
//   a hill due east     -> the highest horizon sits at azimuth 90 degrees
//   refinement          -> halving the step and the ray spacing must leave the stay metrics almost unchanged
import { DEG, HOUR_MS, R_MOON_KM, SKY_BINS, SKY_BIN_DEG } from '../engine/constants.ts';
import type { EphemTable } from '../engine/ephemeris.ts';
import { siteFrame } from '../engine/frame.ts';
import { metrics, type Metrics } from '../engine/metrics.ts';
import { series } from '../engine/series.ts';
import { makeSkyline, smoothHorizonDeg } from '../engine/skyline.ts';
import { buildSkyline, TIER_LIMITS_M, type BuildOptions, type DemGrid, type Tier } from '../engine/terrain.ts';
import { loadTable } from './direction-check.ts';
import { SYNTHETIC_LABEL, syntheticDem, type HeightFn } from './synthetic-terrain.ts';

const R_M = R_MOON_KM * 1000;
export const SKYLINE_THRESHOLD_DEG = 0.01;
/** Largest allowed move of a percentage metric, in percentage points, when the build is refined. */
export const REFINEMENT_LIMIT_POINTS = 1;
/** Largest allowed move of a gap metric when the build is refined, as a percentage of the stay length. */
export const REFINEMENT_LIMIT_GAP_PCT = 1;

/** Synthetic site: off the pole and off every axis, so a mirrored or rotated raster cannot go unnoticed. */
export const CHECK_SITE = { latDeg: -85, lonDeg: 30 };

export interface CaseResult {
  id: string;
  name: string;
  n: number;
  maxDeg: number;
  sumSq: number;
  pass: boolean;
  detail: Record<string, unknown>;
}

export interface CheckOptions {
  /** Used only by the sabotage tests: change every raster before the engine sees it. */
  tweak?: (g: DemGrid) => DemGrid;
  /** Used only by the sabotage and refinement tests: change how the engine builds. */
  build?: BuildOptions;
}

const gaussian = (x: number, w: number) => Math.exp(-((x / w) ** 2));

/** Largest elevation angle (degrees) of the profile z(s) seen from `heightM` above ground of height zero, s in [fromM, toM]. */
export function profileHorizonDeg(z: (sM: number) => number, heightM: number, fromM: number, toM: number, stepM = 0.25): number {
  let best = -Infinity;
  for (let s = fromM; s <= toM; s += stepM) {
    const t = s / R_M;
    const r = R_M + z(s);
    best = Math.max(best, Math.atan2(r * Math.cos(t) - (R_M + heightM), r * Math.sin(t)));
  }
  return best / DEG;
}

function tiersFor(extentM: [number, number, number], heightAt: [HeightFn | undefined, HeightFn | undefined, HeightFn | undefined], opt: CheckOptions): Tier[] {
  const px = [20, 80, 240];
  const out: Tier[] = [];
  for (let t = 0; t < 3; t++) {
    if (!(extentM[t] > 0)) continue;
    const g = syntheticDem(`${SYNTHETIC_LABEL}, ${px[t]} m`, px[t], extentM[t], CHECK_SITE.latDeg, CHECK_SITE.lonDeg, heightAt[t]);
    out.push({ dem: opt.tweak ? opt.tweak(g) : g, maxDistM: TIER_LIMITS_M[t] });
  }
  return out;
}

function compareAll(H: Float32Array, expected: number) {
  let maxDeg = 0, sumSq = 0, worstBin = 0;
  for (let i = 0; i < SKY_BINS; i++) {
    const e = Math.abs(H[i] - expected);
    sumSq += e * e;
    if (e > maxDeg) { maxDeg = e; worstBin = i; }
  }
  return { maxDeg, sumSq, worstAzDeg: (worstBin + 0.5) * SKY_BIN_DEG };
}

/** Flat ground must give the smooth-sphere dip at every azimuth, for several heights. */
export function flatCase(opt: CheckOptions = {}): CaseResult {
  const tiers = tiersFor([8_000, 0, 0], [undefined, undefined, undefined], opt);
  let n = 0, maxDeg = 0, sumSq = 0;
  const perHeight = [0, 2, 10, 20].map((h) => {
    const built = buildSkyline(tiers, CHECK_SITE.latDeg, CHECK_SITE.lonDeg, h, opt.build);
    const c = compareAll(built.H, smoothHorizonDeg(h));
    n += SKY_BINS; sumSq += c.sumSq; maxDeg = Math.max(maxDeg, c.maxDeg);
    return { heightM: h, expectedDeg: smoothHorizonDeg(h), maxErrorDeg: c.maxDeg };
  });
  return { id: 'flat', name: 'Flat ground returns the smooth-sphere horizon dip', n, maxDeg, sumSq, pass: maxDeg <= SKYLINE_THRESHOLD_DEG, detail: { perHeight } };
}

export const RIDGES = [
  { id: 'ridge-near', raster: '20 m', distM: 5_000, topM: 400, widthM: 500, extentM: [7_000, 0, 0] as [number, number, number] },
  { id: 'ridge-mid', raster: '80 m', distM: 40_000, topM: 2_500, widthM: 2_000, extentM: [15_500, 46_000, 0] as [number, number, number] },
  { id: 'ridge-far', raster: '240 m', distM: 150_000, topM: 9_000, widthM: 6_000, extentM: [15_500, 81_000, 165_000] as [number, number, number] },
];

/** A ridge that rings the site at a known distance and height, on each of the three raster tiers in turn. */
export function ridgeCase(r: (typeof RIDGES)[number], opt: CheckOptions = {}, heightM = 2): CaseResult {
  const profile = (s: number) => r.topM * gaussian(s - r.distM, r.widthM);
  const ring: HeightFn = (rel) => profile(rel.distM);
  const tier = RIDGES.indexOf(r);
  const tiers = tiersFor(r.extentM, [0, 1, 2].map((t) => (t === tier ? ring : undefined)) as [HeightFn | undefined, HeightFn | undefined, HeightFn | undefined], opt);
  const built = buildSkyline(tiers, CHECK_SITE.latDeg, CHECK_SITE.lonDeg, heightM, opt.build);
  const expectedDeg = profileHorizonDeg(profile, heightM, r.distM - 4 * r.widthM, r.distM + r.widthM);
  const c = compareAll(built.H, expectedDeg);
  const dKm = Array.from(built.D, (d) => d / 100);
  return {
    id: r.id, name: `Ring ridge ${r.topM} m high at ${r.distM / 1000} km, on the ${r.raster} raster`,
    n: SKY_BINS, maxDeg: c.maxDeg, sumSq: c.sumSq, pass: c.maxDeg <= SKYLINE_THRESHOLD_DEG,
    detail: {
      expectedDeg, worstAzDeg: c.worstAzDeg, heightM,
      blockingDistanceKm: { min: Math.min(...dKm), max: Math.max(...dKm) },
      samplesPerTier: built.samplesPerTier, distanceReachedKm: built.distanceReachedM / 1000,
    },
  };
}

const HILL_EAST = { azDeg: 90, distM: 6_000, topM: 600, widthM: 500 };
const HILL_NORTH = { azDeg: 0, distM: 6_000, topM: 300, widthM: 500 };

/** A hill due east and a lower hill due north. The horizon must peak at azimuth 90 and 0, and stay flat to the west and south. */
export function hillCase(opt: CheckOptions = {}, heightM = 2): CaseResult {
  const hills: HeightFn = (rel) => [HILL_EAST, HILL_NORTH].reduce((z, h) => {
    const a = h.azDeg * DEG;
    return z + h.topM * gaussian(Math.hypot(rel.eastM - h.distM * Math.sin(a), rel.northM - h.distM * Math.cos(a)), h.widthM);
  }, 0);
  const tiers = tiersFor([8_500, 0, 0], [hills, undefined, undefined], opt);
  const built = buildSkyline(tiers, CHECK_SITE.latDeg, CHECK_SITE.lonDeg, heightM, opt.build);
  const peak = (centreDeg: number) => {
    let best = -Infinity, at = 0;
    for (let i = 0; i < SKY_BINS; i++) {
      const az = (i + 0.5) * SKY_BIN_DEG;
      if (Math.abs(((az - centreDeg + 540) % 360) - 180) > 45) continue;
      if (built.H[i] > best) { best = built.H[i]; at = az; }
    }
    return { azDeg: at, elDeg: best };
  };
  const flat = smoothHorizonDeg(heightM);
  const checks = [HILL_EAST, HILL_NORTH].map((h) => {
    const found = peak(h.azDeg);
    const expectedDeg = profileHorizonDeg((s) => h.topM * gaussian(s - h.distM, h.widthM), heightM, h.distM - 4 * h.widthM, h.distM + h.widthM);
    const azErrorDeg = Math.abs(((found.azDeg - h.azDeg + 540) % 360) - 180);
    return { hillAzimuthDeg: h.azDeg, foundAzimuthDeg: found.azDeg, azErrorDeg, expectedDeg, foundDeg: found.elDeg, errorDeg: Math.abs(found.elDeg - expectedDeg) };
  });
  const away = [180, 270].map((az) => ({ azimuthDeg: az, foundDeg: peak(az).elDeg, errorDeg: Math.abs(peak(az).elDeg - flat) }));
  const errors = [...checks.map((c) => c.errorDeg), ...away.map((a) => a.errorDeg)];
  const maxDeg = Math.max(...errors);
  const azOk = checks.every((c) => c.azErrorDeg <= SKY_BIN_DEG);
  return {
    id: 'hill-azimuth', name: 'A hill due east appears at azimuth 90 degrees, a hill due north at 0',
    n: errors.length, maxDeg, sumSq: errors.reduce((a, e) => a + e * e, 0),
    pass: azOk && maxDeg <= SKYLINE_THRESHOLD_DEG,
    detail: { hills: checks, flatElsewhere: away, azimuthToleranceDeg: SKY_BIN_DEG },
  };
}

export function syntheticCases(opt: CheckOptions = {}): CaseResult[] {
  return [flatCase(opt), ...RIDGES.map((r) => ridgeCase(r, opt)), hillCase(opt)];
}

// ---- Refinement: rough synthetic terrain, real Sun and Earth positions ----

/** Rough ground with long swells, short bumps and two crests only a few pixels wide. Deterministic. */
export const roughGround: HeightFn = ({ eastM: e, northM: n }) => {
  const away = 1 - gaussian(Math.hypot(e, n), 600); // keeps the short bumps off the site itself
  return 350 * gaussian(Math.hypot(e, n), 3_000)
    + 300 * Math.sin(e / 3_000 + 1) * Math.cos(n / 2_300 + 2)
    + away * 120 * Math.sin(e / 700 + n / 900)
    + away * 40 * Math.sin(e / 160 - n / 210 + 0.5)
    + 180 * gaussian(e * 0.8 + n * 0.6 - 4_000, 60)
    + 150 * gaussian(-e * 0.28 + n * 0.96 - 9_000, 45);
};

export const REFINEMENT_SITE = { latDeg: -89.45, lonDeg: 222.69 };
export const REFINEMENT_STARTS_UTC = ['2027-03-01T00:00:00Z', '2028-07-10T00:00:00Z', '2029-11-20T00:00:00Z'];
const REFINEMENT_STAY_DAYS = 14;

export interface RefinementResult {
  pass: boolean;
  maxMovePoints: number;
  maxGapMovePctOfStay: number;
  maxHorizonMoveDeg: number;
  windows: Array<{ startUtc: string; standard: Record<string, number>; refined: Record<string, number>; movePoints: number; gapMovePctOfStay: number }>;
  standardBuild: { stepPixels: number; subRays: number; samples: number };
  refinedBuild: { stepPixels: number; subRays: number; samples: number };
}

const picked = (m: Metrics) => ({
  sunlitPct: m.sunlitPct, earthVisiblePct: m.earthVisiblePct, overlapPct: m.overlapPct,
  longestDarkGapH: m.longestDarkGapH, longestLinkGapH: m.longestLinkGapH,
});

/** Build once with the standard step and ray spacing and once with both halved; compare the stay metrics. */
export function refinementCheck(table: EphemTable, standard: BuildOptions = {}, extentM: [number, number, number] = [15_500, 40_000, 60_000]): RefinementResult {
  const { latDeg, lonDeg } = REFINEMENT_SITE;
  const tiers: Tier[] = [20, 80, 240].flatMap((p, t) => (extentM[t] > 0
    ? [{ dem: syntheticDem(`${SYNTHETIC_LABEL}, ${p} m`, p, extentM[t], latDeg, lonDeg, roughGround), maxDistM: TIER_LIMITS_M[t] }] : []));
  const a = buildSkyline(tiers, latDeg, lonDeg, 2, standard);
  const b = buildSkyline(tiers, latDeg, lonDeg, 2, { ...standard, stepPixels: a.stepPixels / 2, subRays: a.subRays * 2 });
  const site = (built: typeof a) => ({
    frame: siteFrame(latDeg, lonDeg, R_M + built.siteElevationM + built.heightM),
    sky: makeSkyline({ H: built.H, D: built.D, grade: 'B', terrain: SYNTHETIC_LABEL, heightM: built.heightM }),
  });
  let maxHorizonMoveDeg = 0;
  for (let i = 0; i < SKY_BINS; i++) maxHorizonMoveDeg = Math.max(maxHorizonMoveDeg, Math.abs(a.H[i] - b.H[i]));
  const stayMs = REFINEMENT_STAY_DAYS * 24 * HOUR_MS;
  const windows = REFINEMENT_STARTS_UTC.map((startUtc) => {
    const t0 = Date.parse(startUtc);
    const ma = picked(metrics(series(table, site(a), t0, t0 + stayMs, 10), t0, t0 + stayMs));
    const mb = picked(metrics(series(table, site(b), t0, t0 + stayMs, 10), t0, t0 + stayMs));
    const movePoints = Math.max(Math.abs(ma.sunlitPct - mb.sunlitPct), Math.abs(ma.earthVisiblePct - mb.earthVisiblePct), Math.abs(ma.overlapPct - mb.overlapPct));
    const gapMoveH = Math.max(Math.abs(ma.longestDarkGapH - mb.longestDarkGapH), Math.abs(ma.longestLinkGapH - mb.longestLinkGapH));
    return { startUtc, standard: ma, refined: mb, movePoints, gapMovePctOfStay: (100 * gapMoveH) / (REFINEMENT_STAY_DAYS * 24) };
  });
  const maxMovePoints = Math.max(...windows.map((w) => w.movePoints));
  const maxGapMovePctOfStay = Math.max(...windows.map((w) => w.gapMovePctOfStay));
  const sum = (x: number[]) => x.reduce((p, q) => p + q, 0);
  return {
    pass: maxMovePoints < REFINEMENT_LIMIT_POINTS && maxGapMovePctOfStay < REFINEMENT_LIMIT_GAP_PCT,
    maxMovePoints, maxGapMovePctOfStay, maxHorizonMoveDeg, windows,
    standardBuild: { stepPixels: a.stepPixels, subRays: a.subRays, samples: sum(a.samplesPerTier) },
    refinedBuild: { stepPixels: b.stepPixels, subRays: b.subRays, samples: sum(b.samplesPerTier) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = Date.now();
  for (const c of syntheticCases()) console.log(c.pass ? 'PASS' : 'FAIL', c.id.padEnd(13), 'n', c.n, 'max', c.maxDeg.toFixed(5), JSON.stringify(c.detail));
  console.log('synthetic cases took', Date.now() - t, 'ms');
  const r = refinementCheck(loadTable());
  console.log(JSON.stringify(r, null, 1));
  console.log('total', Date.now() - t, 'ms');
}
