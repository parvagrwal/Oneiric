// Landing-error robustness: the verdict at the site and at the points around it, plus the near-field availability
// of each point in a 5 m product.
//
//   npm run landing-report                      # 100 m circle, eight points, every polar site
//   npm run landing-report -- --site connecting-ridge --radius 100 --start 2027-03-01
//   npm run landing-report -- --sensitivity      # the pessimistic and optimistic horizon bands too
//
// The rule this script follows, in the order it matters:
//   1. The centre's verdict is the card's verdict. It is computed from the centre's stored skyline.
//   2. A circle point is computed only when a stored skyline exists for that exact point at that exact height.
//      Today none do, so every circle point is reported "no stored skyline" and the share is reported as NOT
//      COMPUTED. It is never filled in from the centre, and never estimated from the smooth sphere.
//   3. A range is shown only when the product's error raster has been read. Until then it says so.
import { readFileSync } from 'node:fs';
import { MIN_MS } from '../engine/constants.ts';
import { landingCircleWithCentre, nearFieldAvailability, type NearFieldRaster } from '../engine/landing.ts';
import { metrics } from '../engine/metrics.ts';
import { PRESETS, slip, verdict, viableFromRolling } from '../engine/requirements.ts';
import { prepareRolling, type RuleSummary } from '../engine/metrics.ts';
import { R_MOON_KM } from '../engine/constants.ts';
import { siteFrame } from '../engine/frame.ts';
import { series } from '../engine/series.ts';
import { makeSkyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { hasHeightErrorValue, heightErrorFor, shiftedSkyline, worstHorizonShiftDeg } from '../engine/uncertainty.ts';
import type { Verdict } from '../engine/requirements.ts';
import { loadTable } from './direction-check.ts';
import { SKYLINE_DIR } from './skyline-files.ts';
import { readSkylineIndex, type SkylineIndexEntry } from './skyline-index.ts';

const DAY_MS = 86_400_000;
const STEP_MIN = 10;
const DEFAULT_RADIUS_M = 100;
const DEFAULT_HEIGHT_M = 2;
const SLIP_EARLY_DAYS = 30;
const SLIP_LATE_DAYS = 120;

export interface CirclePointResult {
  azDeg: number;
  latDeg: number;
  eLonDeg: number;
  distanceM: number;
  /** 'computed' when a stored skyline exists at this point and height; 'no-stored-skyline' otherwise. */
  status: 'computed' | 'no-stored-skyline';
  verdict: string | null;
  rule: string | null;
  nearField: 'inside-5m-raster' | 'no-5m-raster';
}

export interface LandingErrorRow {
  siteId: string;
  grade: string;
  terrain: string;
  heightM: number;
  centreVerdict: Verdict;
  centreMetrics: { sunlitPct: number; longestDarkGapH: number; earthVisiblePct: number; longestLinkGapH: number };
  radiusM: number;
  points: CirclePointResult[];
  /** Share of circle points that keep the centre verdict, or null when no point could be computed. */
  shareKeepingVerdict: number | null;
  nearFieldComplete: boolean;
  /** Pessimistic and optimistic sunlit share from a shifted horizon, or null when no error value is on file. */
  sensitivity: null | {
    sigmaZM: number;
    source: string;
    worstShiftDeg: number;
    pessimisticSunlitPct: number;
    optimisticSunlitPct: number;
  };
}

function loadSkylineAt(entry: SkylineIndexEntry) {
  const bytes = readFileSync(`${SKYLINE_DIR}/${entry.file}`);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { H, D } = decodeSkyline(copy as ArrayBuffer);
  return makeSkyline({ H, D, grade: entry.grade as 'A' | 'B' | 'C' | 'D', terrain: entry.terrain, heightM: entry.heightM });
}

/** Stay metrics and verdict at one frame, using the same engine call the card uses. */
function evaluate(
  table: ReturnType<typeof loadTable>,
  entry: SkylineIndexEntry,
  latDeg: number,
  eLonDeg: number,
  sky: ReturnType<typeof makeSkyline>,
  startMs: number,
  stayMs: number,
  presetId: string,
): { summary: RuleSummary; metrics: ReturnType<typeof metrics>; verdict: Verdict } {
  const preset = PRESETS[presetId];
  const frame = siteFrame(latDeg, eLonDeg, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
  const gridMs = 6 * 3_600_000;
  const firstStartMs = Math.floor((startMs - SLIP_EARLY_DAYS * DAY_MS) / gridMs) * gridMs;
  const lastStartMs = startMs + SLIP_LATE_DAYS * DAY_MS;
  const s = series(table, { frame, sky, marginDeg: 0 }, firstStartMs, lastStartMs + stayMs, STEP_MIN);
  const rolling = prepareRolling(s);
  const m = metrics(s, startMs, startMs + stayMs);
  let tolerance = { viableAtChosen: false, lateDays: null, earlyDays: null, lateCensored: false, earlyCensored: false, nextWindow: null } as ReturnType<typeof slip>;
  if (preset.rules) {
    const count = Math.floor((lastStartMs - firstStartMs) / gridMs) + 1;
    tolerance = slip(viableFromRolling(rolling, preset, firstStartMs, count, gridMs), firstStartMs, startMs, gridMs);
  }
  return { summary: rolling.summary(startMs, startMs + stayMs), metrics: m, verdict: verdict(m, preset, tolerance) };
}

export function landingErrorFor(
  index: { skylines: SkylineIndexEntry[] },
  site: { id: string; lat: number; eLon: number },
  startMs: number,
  presetId = 'sortie',
  radiusM = DEFAULT_RADIUS_M,
  heightM = DEFAULT_HEIGHT_M,
  rasters: NearFieldRaster[] = [],
): LandingErrorRow | null {
  const entry = index.skylines.find((e) => e.siteId === site.id && e.heightM === heightM);
  if (!entry) return null;
  const table = loadTable();
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`unknown preset ${presetId}`);
  const stayMs = Math.round((preset.stayDays * DAY_MS) / MIN_MS) * MIN_MS;
  const sky = loadSkylineAt(entry);
  const centre = evaluate(table, entry, site.lat, site.eLon, sky, startMs, stayMs, presetId);

  const circle = landingCircleWithCentre({ latDeg: site.lat, eLonDeg: site.eLon }, radiusM, 8);
  const availability = nearFieldAvailability(circle, rasters);
  const inside5m = new Set(availability.covered.map((m) => `${m.point.latDeg.toFixed(9)},${m.point.eLonDeg.toFixed(9)}`));
  const points: CirclePointResult[] = [];
  for (const p of circle) {
    const nearField = inside5m.has(`${p.latDeg.toFixed(9)},${p.eLonDeg.toFixed(9)}`) ? 'inside-5m-raster' : 'no-5m-raster';
    // A point skyline is looked up by the id convention in docs/circle-points.md. None exists in the shipped index
    // today, so the point reports that plainly. When the files land under that name, this loop picks them up.
    const pointEntry = index.skylines.find((e) => e.siteId === circlePointSiteId(site.id, p.azDeg) && e.heightM === heightM);
    if (!pointEntry) {
      points.push({ azDeg: p.azDeg, latDeg: p.latDeg, eLonDeg: p.eLonDeg, distanceM: p.distanceM, status: 'no-stored-skyline', verdict: null, rule: null, nearField });
      continue;
    }
    const pointSky = loadSkylineAt(pointEntry);
    const r = evaluate(table, pointEntry, p.latDeg, p.eLonDeg, pointSky, startMs, stayMs, presetId);
    points.push({ azDeg: p.azDeg, latDeg: p.latDeg, eLonDeg: p.eLonDeg, distanceM: p.distanceM, status: 'computed', verdict: r.verdict.verdict, rule: r.verdict.rule, nearField });
  }
  const computed = points.filter((p) => p.status === 'computed');
  const shareKeepingVerdict = computed.length === 0
    ? null
    : computed.filter((p) => p.verdict === centre.verdict.verdict).length / computed.length;

  const err = heightErrorFor(entry.terrain);
  let sensitivity: LandingErrorRow['sensitivity'] = null;
  if (err && hasHeightErrorValue(entry.terrain) && err.sigmaZM !== null) {
    const up = metrics(series(table, { frame: siteFrame(site.lat, site.eLon, R_MOON_KM * 1000 + entry.siteElevationM + heightM), sky: shiftedSkyline(sky, err.sigmaZM), marginDeg: 0 }, startMs, startMs + stayMs, STEP_MIN), startMs, startMs + stayMs);
    const down = metrics(series(table, { frame: siteFrame(site.lat, site.eLon, R_MOON_KM * 1000 + entry.siteElevationM + heightM), sky: shiftedSkyline(sky, -err.sigmaZM), marginDeg: 0 }, startMs, startMs + stayMs, STEP_MIN), startMs, startMs + stayMs);
    sensitivity = {
      sigmaZM: err.sigmaZM,
      source: err.source,
      worstShiftDeg: worstHorizonShiftDeg(sky, err.sigmaZM),
      pessimisticSunlitPct: down.sunlitPct,
      optimisticSunlitPct: up.sunlitPct,
    };
  }

  return {
    siteId: entry.siteId,
    grade: entry.grade,
    terrain: entry.terrain,
    heightM: entry.heightM,
    centreVerdict: centre.verdict,
    centreMetrics: {
      sunlitPct: centre.metrics.sunlitPct,
      longestDarkGapH: centre.metrics.longestDarkGapH,
      earthVisiblePct: centre.metrics.earthVisiblePct,
      longestLinkGapH: centre.metrics.longestLinkGapH,
    },
    radiusM,
    points,
    shareKeepingVerdict,
    nearFieldComplete: availability.complete,
    sensitivity,
  };
}

/** The index id a circle-point skyline would carry: `<centreId>~circle-<azDeg>`, azimuth with no trailing zeros. */
export function circlePointSiteId(centreId: string, azDeg: number): string {
  return `${centreId}~circle-${Number(azDeg.toFixed(2))}`;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const presetId = flag('--preset', 'sortie');
  if (!PRESETS[presetId]) throw new Error('unknown preset; try sortie, lander or year');
  const startMs = Date.parse(`${flag('--start', '2027-03-01')}T00:00:00Z`);
  if (!Number.isFinite(startMs)) throw new Error('--start takes a UTC date, for example 2027-03-01');
  const radiusM = Number(flag('--radius', String(DEFAULT_RADIUS_M)));
  const heightM = Number(flag('--height', String(DEFAULT_HEIGHT_M)));
  const onlySite = argv.includes('--site') ? flag('--site', '') : undefined;

  const index = readSkylineIndex();
  if (!index) {
    console.log('No skyline index in app/public/data/skylines/. Run npm run build:skylines first.');
    return;
  }
  const sites = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;

  const rows: LandingErrorRow[] = [];
  for (const site of sites) {
    if (onlySite && site.id !== onlySite) continue;
    const row = landingErrorFor(index, site, startMs, presetId, radiusM, heightM, []);
    if (row) rows.push(row);
  }
  if (rows.length === 0) {
    console.log('No site has a stored skyline at this height, so nothing is reported.');
    return;
  }

  console.log(`Landing-error robustness: ${PRESETS[presetId].name} (illustrative, not agency requirements), start ${new Date(startMs).toISOString()}, ${heightM} m observer, ${radiusM} m circle`);
  console.log('A circle point is computed only where a stored skyline exists for that point at that height.\n');
  let anyComputed = false;
  for (const row of rows) {
    console.log(`${row.siteId}  grade ${row.grade}  centre ${row.centreVerdict.verdict}: ${row.centreVerdict.rule}`);
    console.log(`  centre: sunlit ${row.centreMetrics.sunlitPct.toFixed(2)}%, dark gap ${row.centreMetrics.longestDarkGapH.toFixed(1)} h, Earth visible ${row.centreMetrics.earthVisiblePct.toFixed(2)}%, link gap ${row.centreMetrics.longestLinkGapH.toFixed(1)} h`);
    const computed = row.points.filter((p) => p.status === 'computed').length;
    anyComputed ||= computed > 0;
    console.log(`  ${row.points.length} circle points, ${computed} computed from a stored skyline, ${row.points.length - computed} with no stored skyline`);
    console.log(`  share of the circle that keeps the centre verdict: ${row.shareKeepingVerdict === null ? 'not computed' : `${(row.shareKeepingVerdict * 100).toFixed(0)}%`}`);
    console.log(`  5 m near field: ${row.nearFieldComplete ? 'every point inside a stored 5 m raster' : 'no 5 m raster covers these points in this checkout'}`);
    const err = heightErrorFor(row.terrain);
    console.log(`  range: ${row.sensitivity === null
      ? `not available. The product documents an error raster (${err ? err.product : 'none on file'}) but its value has not been read into this checkout, so no band is shown.`
      : `sunlit ${row.sensitivity.pessimisticSunlitPct.toFixed(1)}–${row.sensitivity.optimisticSunlitPct.toFixed(1)}% (±1σ height error ${row.sensitivity.sigmaZM} m, worst horizon shift ${row.sensitivity.worstShiftDeg.toFixed(4)}°)`}`);
  }
  console.log(`\nSites with at least one computed circle point: ${anyComputed ? 'yes' : 'none'}. The share is reported as not computed rather than assumed, and no horizon is borrowed from the centre site.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
