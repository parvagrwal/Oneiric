// Illumination check driver v2: build ONE long series per site+height, then report the
// sunlit fraction under several definitions for any number of windows inside it, using
// prefix sums so each window costs O(1) after a single pass.
//
//   npx tsx illumination-check.ts --site connecting-ridge --height 0 \
//       --series-start 2023-01-01 --series-days 6575 --step 30 \
//       --windows 2027-01-01:365,2023-01-01:6575
//
// Definitions (all from the same series):
//   meanDisc    mean visible fraction of the solar disc (the engine's sunlitPct)
//   anyDisc     % of steps with any part of the disc visible (sunF > 0)
//   halfDisc    % of steps with at least half the disc visible (sunF >= 0.5)
//   centreAbove % of steps with the Sun's CENTRE above the terrain horizon
//   fullDisc    % of steps with essentially the whole disc visible (sunF >= 0.99)
//   darkGapH    longest run with sunF < 0.01, step resolution (no 1-min refinement)
//   lightAnyH   longest run with any part of the disc visible (sunF > 0), step resolution
//   lightHalfH  longest run with at least half the disc visible (sunF >= 0.5), step resolution
//
// The driver only reads the copied tree; it writes nothing outside stdout.
import { readFileSync } from 'node:fs';
import { R_MOON_KM } from './engine/constants.ts';
import { siteFrame } from './engine/frame.ts';
import { series } from './engine/series.ts';
import { makeSkyline, skylineAt, type Grade } from './engine/skyline.ts';
import { decodeSkyline } from './engine/terrain.ts';
import { loadTable } from './pipeline/direction-check.ts';
import { SKYLINE_DIR } from './pipeline/skyline-files.ts';
import { readSkylineIndex } from './pipeline/skyline-index.ts';

const DAY_MS = 86_400_000;

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

const siteId = flag('--site', '');
const heightM = Number(flag('--height', '0'));
const stepMin = Number(flag('--step', '30'));
const seriesStartMs = Date.parse(`${flag('--series-start', '2023-01-01')}T00:00:00Z`);
const seriesDays = Number(flag('--series-days', '365'));
const windowsSpec = flag('--windows', `${flag('--series-start', '2023-01-01')}:${seriesDays}`);
if (!siteId) throw new Error('--site is required');
if (!Number.isFinite(seriesStartMs)) throw new Error('--series-start takes a UTC date');
if (!(seriesDays > 0) || !(stepMin > 0)) throw new Error('--series-days and --step must be positive');

const sites = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{
  id: string; name: string; lat: number; eLon: number;
}>;
const site = sites.find((s) => s.id === siteId);
if (!site) throw new Error(`unknown site ${siteId}`);

const index = readSkylineIndex();
if (!index) throw new Error('no skyline index');
const entry = index.skylines.find((e) => e.siteId === siteId && e.heightM === heightM);
if (!entry) throw new Error(`no stored skyline for ${siteId} at ${heightM} m`);

const bytes = readFileSync(`${SKYLINE_DIR}/${entry.file}`);
const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const { H, D } = decodeSkyline(copy as ArrayBuffer);
const sky = makeSkyline({ H, D, grade: entry.grade as Grade, terrain: entry.terrain, heightM: entry.heightM });
const frame = siteFrame(site.lat, site.eLon, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);

const t0 = Date.now();
const table = loadTable();
const s = series(table, { frame, sky, marginDeg: 0 }, seriesStartMs, seriesStartMs + seriesDays * DAY_MS, stepMin);
const buildMs = Date.now() - t0;

// Single pass: prefix sums for every definition, plus the dark-run list.
const prefixF = new Float64Array(s.n + 1);
const prefixAny = new Int32Array(s.n + 1);
const prefixHalf = new Int32Array(s.n + 1);
const prefixCentre = new Int32Array(s.n + 1);
const prefixFull = new Int32Array(s.n + 1);
const darkRuns: Array<[number, number]> = [];
const lightAnyRuns: Array<[number, number]> = [];
const lightHalfRuns: Array<[number, number]> = [];
let runStart = -1;
let lightAnyStart = -1;
let lightHalfStart = -1;
for (let i = 0; i < s.n; i++) {
  const f = s.sunF[i];
  prefixF[i + 1] = prefixF[i] + f;
  prefixAny[i + 1] = prefixAny[i] + (f > 0 ? 1 : 0);
  prefixHalf[i + 1] = prefixHalf[i] + (f >= 0.5 ? 1 : 0);
  prefixCentre[i + 1] = prefixCentre[i] + (s.sunEl[i] >= skylineAt(sky, s.sunAz[i]).H ? 1 : 0);
  prefixFull[i + 1] = prefixFull[i] + (f >= 0.99 ? 1 : 0);
  if (f < 0.01) {
    if (runStart < 0) runStart = i;
  } else if (runStart >= 0) {
    darkRuns.push([runStart, i]);
    runStart = -1;
  }
  if (f > 0) {
    if (lightAnyStart < 0) lightAnyStart = i;
  } else if (lightAnyStart >= 0) {
    lightAnyRuns.push([lightAnyStart, i]);
    lightAnyStart = -1;
  }
  if (f >= 0.5) {
    if (lightHalfStart < 0) lightHalfStart = i;
  } else if (lightHalfStart >= 0) {
    lightHalfRuns.push([lightHalfStart, i]);
    lightHalfStart = -1;
  }
}
if (runStart >= 0) darkRuns.push([runStart, s.n]);
if (lightAnyStart >= 0) lightAnyRuns.push([lightAnyStart, s.n]);
if (lightHalfStart >= 0) lightHalfRuns.push([lightHalfStart, s.n]);

console.log(`site: ${site.id} (${site.name}) lat ${site.lat} eLon ${site.eLon}`);
console.log(`height: ${heightM} m  grade ${entry.grade}  terrain: ${entry.terrain}`);
console.log(`skyline file: ${entry.file}  site elevation: ${entry.siteElevationM.toFixed(2)} m`);
console.log(`series: ${new Date(seriesStartMs).toISOString().slice(0, 10)} + ${seriesDays} d, step ${stepMin} min, n=${s.n}, built in ${(buildMs / 1000).toFixed(1)} s`);

for (const spec of windowsSpec.split(',')) {
  const [startStr, daysStr] = spec.split(':');
  const wStart = Date.parse(`${startStr}T00:00:00Z`);
  const wDays = Number(daysStr);
  const wEnd = wStart + wDays * DAY_MS;
  if (!Number.isFinite(wStart) || !(wDays > 0)) throw new Error(`bad window ${spec}`);
  const i0 = Math.round((wStart - s.t0Ms) / s.stepMs);
  const i1 = Math.round((wEnd - s.t0Ms) / s.stepMs);
  if (i0 < 0 || i1 > s.n) throw new Error(`window ${spec} lies outside the series`);
  const n = i1 - i0;
  const pct = (c: number) => ((100 * c) / n).toFixed(2);
  let longestDark = 0;
  let longestLightAny = 0;
  let longestLightHalf = 0;
  const longestIn = (runs: Array<[number, number]>) => {
    let best = 0;
    for (const [a, b] of runs) {
      const lo = Math.max(a, i0);
      const hi = Math.min(b, i1);
      if (hi > lo) best = Math.max(best, hi - lo);
    }
    return best;
  };
  longestDark = longestIn(darkRuns);
  longestLightAny = longestIn(lightAnyRuns);
  longestLightHalf = longestIn(lightHalfRuns);
  console.log(
    `window ${startStr} + ${wDays} d (n=${n}): ` +
    `meanDisc ${pct(prefixF[i1] - prefixF[i0])}%  anyDisc ${pct(prefixAny[i1] - prefixAny[i0])}%  ` +
    `halfDisc ${pct(prefixHalf[i1] - prefixHalf[i0])}%  centreAbove ${pct(prefixCentre[i1] - prefixCentre[i0])}%  ` +
    `fullDisc ${pct(prefixFull[i1] - prefixFull[i0])}%  darkGap ${(longestDark * stepMin / 60).toFixed(2)} h  ` +
    `lightAny ${(longestLightAny * stepMin / 24 / 60).toFixed(2)} d  lightHalf ${(longestLightHalf * stepMin / 24 / 60).toFixed(2)} d`,
  );
}
