// What blocks a dark span or a closed-link span, for every polar site: the body's azimuth at mid-span, the horizon
// there, the distance to the terrain that sets it, and the point on the ground.
//
//   npm run blocking-report                       # every polar site, 6.5-day sortie from 2027-03-01
//   npm run blocking-report -- --site connecting-ridge --start 2028-09-05
//   npm run blocking-report -- --json             # machine-readable, for the map layer in the app
//
// Values only, no threshold and no pass mark. A smooth-sphere site reports that the skyline records no terrain,
// with no distance and no point: a ridge is never named for data that does not contain one.
import { readFileSync } from 'node:fs';
import { DEG, MIN_MS, R_MOON_KM } from '../engine/constants.ts';
import { blockingTerrain } from '../engine/blocking.ts';
import { azElOfDirection, directionFromSite, siteFrame } from '../engine/frame.ts';
import { ephemAt } from '../engine/ephemeris.ts';
import { metrics, refine } from '../engine/metrics.ts';
import { PRESETS } from '../engine/requirements.ts';
import { series, type Series } from '../engine/series.ts';
import { isDark } from '../engine/series.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { makeSkyline } from '../engine/skyline.ts';
import { loadTable } from './direction-check.ts';
import { SKYLINE_DIR } from './skyline-files.ts';
import { readSkylineIndex, type SkylineIndexEntry } from './skyline-index.ts';

const DAY_MS = 86_400_000;
const STEP_MIN = 10;
const DEFAULT_HEIGHT_M = 2;

export interface SpanBlock {
  kind: 'dark' | 'no-link';
  startUtc: string;
  endUtc: string;
  midUtc: string;
  hours: number;
  bodyAzDeg: number;
  horizonDegAtMidAz: number;
  bodyElDegAtMidAz: number;
  clearanceDeg: number;
  distanceKm: number | null;
  riseM: number | null;
  pointLat: number | null;
  pointELon: number | null;
}

export interface SiteBlocking {
  siteId: string;
  grade: string;
  terrain: string;
  heightM: number;
  blockers: SpanBlock[];
}

function longestSpan(s: Series, flag: (i: number) => boolean, probeFlag: (t: number) => boolean) {
  let best: { start: number; end: number } | null = null;
  let i = 0;
  while (i < s.n) {
    if (!flag(i)) { i++; continue; }
    let j = i;
    while (j < s.n && flag(j)) j++;
    let start = s.t0Ms + i * s.stepMs;
    let end = s.t0Ms + j * s.stepMs;
    if (i > 0) start = refine(probeFlag, start - s.stepMs, start);
    if (j < s.n) end = refine((t) => !probeFlag(t), end - s.stepMs, end);
    if (!best || end - start > best.end - best.start) best = { start, end };
    i = j;
  }
  return best;
}

export function blockingForSite(
  table: ReturnType<typeof loadTable>,
  entry: SkylineIndexEntry,
  latDeg: number,
  eLonDeg: number,
  startMs: number,
  stayMs: number,
): SiteBlocking {
  const bytes = readFileSync(`${SKYLINE_DIR}/${entry.file}`);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { H, D } = decodeSkyline(copy as ArrayBuffer);
  const sky = makeSkyline({ H, D, grade: entry.grade as 'A' | 'B' | 'C' | 'D', terrain: entry.terrain, heightM: entry.heightM });
  const frame = siteFrame(latDeg, eLonDeg, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
  const s = series(table, { frame, sky, marginDeg: 0 }, startMs, startMs + stayMs, STEP_MIN);
  const m = metrics(s, startMs, startMs + stayMs);

  const spans: Array<{ kind: 'dark' | 'no-link'; best: { start: number; end: number } }> = [];
  const dark = longestSpan(s, (i) => isDark(s.sunF[i]), (t) => isDark(s.probe(t).sunF));
  if (dark && m.longestDarkGapH > 0) spans.push({ kind: 'dark', best: dark });
  const noLink = longestSpan(s, (i) => s.earthVis[i] === 0, (t) => !s.probe(t).earthVis);
  if (noLink && m.longestLinkGapH > 0) spans.push({ kind: 'no-link', best: noLink });

  const blockers: SpanBlock[] = spans.map(({ kind, best }) => {
    const midMs = Math.round((best.start + best.end) / 2);
    const bodies = ephemAt(table, midMs);
    const body = kind === 'dark' ? bodies.sun : bodies.earth;
    const { az, el } = azElOfDirection(frame, directionFromSite(frame, body));
    const b = blockingTerrain({ latDeg, eLonDeg }, sky, az, el);
    return {
      kind,
      startUtc: new Date(best.start).toISOString(),
      endUtc: new Date(best.end).toISOString(),
      midUtc: new Date(midMs).toISOString(),
      hours: (best.end - best.start) / 3_600_000,
      bodyAzDeg: az,
      horizonDegAtMidAz: b.horizonDeg,
      bodyElDegAtMidAz: el,
      clearanceDeg: b.clearanceDeg,
      distanceKm: b.distanceKm,
      riseM: b.riseM,
      pointLat: b.point ? b.point.latDeg : null,
      pointELon: b.point ? b.point.eLonDeg : null,
    };
  });

  return {
    siteId: entry.siteId,
    grade: entry.grade,
    terrain: entry.terrain,
    heightM: entry.heightM,
    blockers,
  };
}

/** Every shipped skyline at one height, at one start date. Used by the script and by the tests. */
export function blockingForAll(
  index: { skylines: SkylineIndexEntry[] },
  sites: Array<{ id: string; lat: number; eLon: number }>,
  startMs: number,
  stayMs: number,
  heightM = DEFAULT_HEIGHT_M,
  onlySite?: string,
): SiteBlocking[] {
  const table = loadTable();
  const out: SiteBlocking[] = [];
  for (const site of sites) {
    if (onlySite && site.id !== onlySite) continue;
    const entry = index.skylines.find((e) => e.siteId === site.id && e.heightM === heightM);
    if (!entry) continue;
    out.push(blockingForSite(table, entry, site.lat, site.eLon, startMs, stayMs));
  }
  return out;
}

/** GeoJSON of the blocking points, for the map layer. Properties carry the distance and the span they explain. */
export function blockingGeoJson(rows: SiteBlocking[]): string {
  const features = rows.flatMap((row) =>
    row.blockers
      .filter((b) => b.pointLat !== null && b.pointELon !== null)
      .map((b) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [b.pointELon!, b.pointLat!] },
        properties: {
          siteId: row.siteId,
          kind: b.kind,
          midUtc: b.midUtc,
          distanceKm: b.distanceKm,
          horizonDeg: b.horizonDegAtMidAz,
          riseM: b.riseM,
          grade: row.grade,
        },
      })),
  );
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2) + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const preset = PRESETS[flag('--preset', 'sortie')];
  if (!preset) throw new Error('unknown preset; try sortie, lander or year');
  const startMs = Date.parse(`${flag('--start', '2027-03-01')}T00:00:00Z`);
  if (!Number.isFinite(startMs)) throw new Error('--start takes a UTC date, for example 2027-03-01');
  const stayMs = Math.round((preset.stayDays * DAY_MS) / MIN_MS) * MIN_MS;
  const heightM = Number(flag('--height', String(DEFAULT_HEIGHT_M)));
  const onlySite = argv.includes('--site') ? flag('--site', '') : undefined;

  const index = readSkylineIndex();
  if (!index) {
    console.log('No skyline index in app/public/data/skylines/. Run npm run build:skylines first.');
    return;
  }
  const sites = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;
  const rows = blockingForAll(index, sites, startMs, stayMs, heightM, onlySite);

  if (argv.includes('--json')) {
    process.stdout.write(blockingGeoJson(rows));
    return;
  }

  console.log(`What blocks each site: ${preset.name} (illustrative, not agency requirements), start ${new Date(startMs).toISOString()}, ${heightM} m observer`);
  console.log('Distance and point come from the stored skyline\'s blocking distance; a smooth-sphere record has none.\n');
  for (const row of rows) {
    console.log(`${row.siteId}  grade ${row.grade}  ${row.terrain}`);
    if (row.blockers.length === 0) {
      console.log('  no dark span and no closed-link span in the stay');
      continue;
    }
    for (const b of row.blockers) {
      const where = b.pointLat === null
        ? 'no ground point: this skyline records no terrain'
        : `${b.distanceKm!.toFixed(2)} km at ${b.pointLat.toFixed(4)} S/E ${b.pointELon!.toFixed(4)} (rise ${b.riseM!.toFixed(1)} m)`;
      console.log(`  ${b.kind} ${b.hours.toFixed(2)} h, mid ${b.midUtc}`);
      console.log(`    body azimuth ${b.bodyAzDeg.toFixed(2)}°, body elevation ${b.bodyElDegAtMidAz.toFixed(2)}°, horizon there ${b.horizonDegAtMidAz.toFixed(2)}°, clearance ${b.clearanceDeg.toFixed(2)}°`);
      console.log(`    terrain: ${where}`);
    }
  }
  const withPoints = rows.flatMap((r) => r.blockers).filter((b) => b.pointLat !== null).length;
  const without = rows.flatMap((r) => r.blockers).filter((b) => b.pointLat === null).length;
  console.log(`\n${withPoints} blocker(s) with a recorded ground point, ${without} with no recorded terrain.`);
  void DEG;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
