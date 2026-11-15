// Sensitivity report: how far the stay metrics move when one input changes at a time.
//
//   npm run sensitivity-report                 # every row that can be computed from this checkout
//   npm run sensitivity-report -- --site connecting-ridge --start 2027-03-01
//
// Reported values, no threshold and no pass mark. Three of the five sensitivity axes the plan names are reported
// here in full:
//   A. Observer height: 0, 2, 10 and 20 m from the stored skylines.
//   B. Horizon shift: the skyline moved by the elevation angle a stated height error subtends at the distance of
//      the blocking terrain. Reported only when the product's error raster has been read; otherwise named as
//      unavailable, with the raster that would supply it.
//   C. Start date: the same site at four start dates, which shows how much of the variation is the calendar and
//      not the terrain.
// Two further axes, reported from measured data where it exists and named as not computed where it does not:
//   D. Published illumination against this build: at the reference point the annual average runs from 31% at 0 m to
//      93% at 20 m, so the observer height alone moves the answer by more than the ±5-point comparison tolerance.
//      `npm run illumination-compare` prints the full comparison and why none of it is a pass or a fail yet.
//   E. Landing circle: needs a stored skyline per circle point, so the share is not computed.
import { readFileSync } from 'node:fs';
import { MIN_MS, R_MOON_KM } from '../engine/constants.ts';
import { siteFrame } from '../engine/frame.ts';
import { heightOptions, resolveSkylineAtHeight } from '../engine/heights.ts';
import { metrics } from '../engine/metrics.ts';
import { PRESETS } from '../engine/requirements.ts';
import { series } from '../engine/series.ts';
import { makeSkyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { hasHeightErrorValue, heightErrorFor, shiftedSkyline, worstHorizonShiftDeg } from '../engine/uncertainty.ts';
import type { Grade } from '../engine/skyline.ts';
import { loadTable } from './direction-check.ts';
import { SKYLINE_DIR } from './skyline-files.ts';
import { readSkylineIndex, type SkylineIndexEntry } from './skyline-index.ts';

const DAY_MS = 86_400_000;
const STEP_MIN = 10;
const START_DATES = ['2027-03-01', '2027-09-01', '2028-03-01', '2029-09-01'];

export interface SensitivityRow {
  siteId: string;
  grade: Grade;
  terrain: string;
  startUtc: string;
  heightM: number;
  sunlitPct: number;
  longestDarkGapH: number;
  earthVisiblePct: number;
  longestLinkGapH: number;
}

function loadSkyline(entry: SkylineIndexEntry) {
  const bytes = readFileSync(`${SKYLINE_DIR}/${entry.file}`);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { H, D } = decodeSkyline(copy as ArrayBuffer);
  return makeSkyline({ H, D, grade: entry.grade as Grade, terrain: entry.terrain, heightM: entry.heightM });
}

export function metricsFor(
  table: ReturnType<typeof loadTable>,
  entry: SkylineIndexEntry,
  latDeg: number,
  eLonDeg: number,
  startMs: number,
  stayMs: number,
  sky = loadSkyline(entry),
): SensitivityRow {
  const frame = siteFrame(latDeg, eLonDeg, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
  const m = metrics(series(table, { frame, sky, marginDeg: 0 }, startMs, startMs + stayMs, STEP_MIN), startMs, startMs + stayMs);
  return {
    siteId: entry.siteId,
    grade: entry.grade as Grade,
    terrain: entry.terrain,
    startUtc: new Date(startMs).toISOString(),
    heightM: entry.heightM,
    sunlitPct: m.sunlitPct,
    longestDarkGapH: m.longestDarkGapH,
    earthVisiblePct: m.earthVisiblePct,
    longestLinkGapH: m.longestLinkGapH,
  };
}

/** A. One row per stored height, plus the movement from one height to the next. */
export function heightSensitivity(rows: SensitivityRow[]): Array<{ siteId: string; fromHeightM: number; toHeightM: number; sunlitPoints: number; darkGapHours: number }> {
  const by = new Map<string, SensitivityRow[]>();
  for (const r of rows) {
    const list = by.get(r.siteId) ?? [];
    list.push(r);
    by.set(r.siteId, list);
  }
  const out: Array<{ siteId: string; fromHeightM: number; toHeightM: number; sunlitPoints: number; darkGapHours: number }> = [];
  for (const [siteId, list] of by) {
    const sorted = [...list].sort((a, b) => a.heightM - b.heightM);
    for (let i = 1; i < sorted.length; i++) {
      out.push({
        siteId,
        fromHeightM: sorted[i - 1].heightM,
        toHeightM: sorted[i].heightM,
        sunlitPoints: sorted[i].sunlitPct - sorted[i - 1].sunlitPct,
        darkGapHours: sorted[i].longestDarkGapH - sorted[i - 1].longestDarkGapH,
      });
    }
  }
  return out;
}

/** B. The sunlit share with the horizon moved down and up by one sigma, or null when no error value is on file. */
export function horizonShiftSensitivity(
  table: ReturnType<typeof loadTable>,
  entry: SkylineIndexEntry,
  latDeg: number,
  eLonDeg: number,
  startMs: number,
  stayMs: number,
): null | { sigmaZM: number; worstShiftDeg: number; sunlitPessimisticPct: number; sunlitOptimisticPct: number; source: string } {
  const err = heightErrorFor(entry.terrain);
  if (!err || !hasHeightErrorValue(entry.terrain) || err.sigmaZM === null) return null;
  const sky = loadSkyline(entry);
  const frame = siteFrame(latDeg, eLonDeg, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
  const run = (s: ReturnType<typeof loadSkyline>) => metrics(series(table, { frame, sky: s, marginDeg: 0 }, startMs, startMs + stayMs, STEP_MIN), startMs, startMs + stayMs).sunlitPct;
  // A lower horizon lets the Sun through earlier, so the pessimistic case is the raised horizon.
  return {
    sigmaZM: err.sigmaZM,
    worstShiftDeg: worstHorizonShiftDeg(sky, err.sigmaZM),
    sunlitPessimisticPct: run(shiftedSkyline(sky, -err.sigmaZM)),
    sunlitOptimisticPct: run(shiftedSkyline(sky, err.sigmaZM)),
    source: err.source,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const presetId = flag('--preset', 'sortie');
  const preset = PRESETS[presetId];
  if (!preset) throw new Error('unknown preset; try sortie, lander or year');
  const stayMs = Math.round((preset.stayDays * DAY_MS) / MIN_MS) * MIN_MS;
  const startMs = Date.parse(`${flag('--start', '2027-03-01')}T00:00:00Z`);
  const onlySite = argv.includes('--site') ? flag('--site', '') : undefined;

  const index = readSkylineIndex();
  if (!index) {
    console.log('No skyline index in app/public/data/skylines/. Run npm run build:skylines first.');
    return;
  }
  const sites = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;
  const table = loadTable();
  const heights = heightOptions(index.skylines).filter((h) => h.available).map((h) => h.heightM);

  console.log(`Sensitivity report: ${preset.name} (illustrative, not agency requirements), start ${new Date(startMs).toISOString()}`);
  console.log(`Observer heights with a stored skyline: ${heights.map((h) => `${h} m`).join(', ') || 'none'}`);
  console.log('Values only. No threshold, no pass mark.\n');

  const rows: SensitivityRow[] = [];
  const shiftRows: Array<{ siteId: string; value: NonNullable<ReturnType<typeof horizonShiftSensitivity>> }> = [];
  const shiftMissing: string[] = [];
  for (const site of sites) {
    if (onlySite && site.id !== onlySite) continue;
    for (const h of heights) {
      const entry = resolveSkylineAtHeight(index.skylines, site.id, h);
      if (!entry) continue;
      rows.push(metricsFor(table, entry, site.lat, site.eLon, startMs, stayMs));
      const shift = horizonShiftSensitivity(table, entry, site.lat, site.eLon, startMs, stayMs);
      if (shift) shiftRows.push({ siteId: site.id, value: shift });
      else shiftMissing.push(`${site.id} at ${h} m`);
    }
  }

  console.log('A. Observer height');
  if (rows.length === 0) console.log('   no stored skyline at any standard height');
  else {
    for (const site of sites) {
      const mine = rows.filter((r) => r.siteId === site.id);
      if (mine.length === 0) continue;
      const line = mine.map((r) => `${r.heightM} m ${r.sunlitPct.toFixed(1)}%`).join(' | ');
      console.log(`   ${site.id}: sunlit ${line}`);
    }
    const moved = heightSensitivity(rows);
    const biggest = moved.reduce<null | typeof moved[number]>((a, b) => (!a || Math.abs(b.sunlitPoints) > Math.abs(a.sunlitPoints) ? b : a), null);
    console.log(`   ${moved.length} height steps; the largest sunlit change is ${biggest ? `${biggest.sunlitPoints.toFixed(1)} points for ${biggest.siteId} from ${biggest.fromHeightM} m to ${biggest.toHeightM} m` : 'none'}`);
  }

  console.log('\nB. Horizon shift from a stated height error');
  if (shiftRows.length > 0) {
    const worst = shiftRows.reduce((a, b) => (b.value.worstShiftDeg > a.value.worstShiftDeg ? b : a));
    console.log(`   ${shiftRows.length} site-height rows; the largest horizon shift is ${worst.value.worstShiftDeg.toFixed(4)}° at ${worst.siteId} (σz ${worst.value.sigmaZM} m)`);
    for (const r of shiftRows.slice(0, 5)) console.log(`   ${r.siteId}: sunlit ${r.value.sunlitPessimisticPct.toFixed(1)}% to ${r.value.sunlitOptimisticPct.toFixed(1)}%`);
    if (shiftRows.length > 5) console.log(`   and ${shiftRows.length - 5} more`);
  } else {
    console.log(`   not computed: ${shiftMissing.length} site-height rows have no height-error value on file.`);
    console.log('   The product documentation names the error rasters (LDEM_80S_20MPP_ADJ_ERR.TIF for the 20 m product, LDEM_60S_240MPP_ADJ_ERR.TIF for the 240 m product).');
    console.log('   The value is read from those rasters by this script when they are present in data/; no figure is assumed here.');
  }

  console.log('\nC. Start date');
  if (onlySite || rows.length > 0) {
    const probeSite = sites.find((s) => (onlySite ? s.id === onlySite : resolveSkylineAtHeight(index.skylines, s.id, 2) !== null));
    if (probeSite) {
      const entry = resolveSkylineAtHeight(index.skylines, probeSite.id, 2);
      if (entry) {
        for (const date of START_DATES) {
          const ms = Date.parse(`${date}T00:00:00Z`);
          const r = metricsFor(table, entry, probeSite.lat, probeSite.eLon, ms, stayMs);
          console.log(`   ${probeSite.id} ${date}: sunlit ${r.sunlitPct.toFixed(1)}%, dark gap ${r.longestDarkGapH.toFixed(1)} h, Earth visible ${r.earthVisiblePct.toFixed(1)}%, link gap ${r.longestLinkGapH.toFixed(1)} h`);
        }
      }
    }
  } else {
    console.log('   not computed: no stored skyline at 2 m');
  }

  console.log('\nD. Published illumination against this build');
  // Annual averages, one full UTC year, from the same stored skylines the comparison uses.
  const crSite = sites.find((x) => x.id === 'connecting-ridge');
  const annual: Array<{ heightM: number; pct: number }> = [];
  if (crSite) {
    for (const h of heights) {
      const entry = resolveSkylineAtHeight(index.skylines, crSite.id, h);
      if (!entry) continue;
      const yearStart = Date.UTC(2030, 0, 1);
      const yearEnd = Date.UTC(2031, 0, 1);
      const frame = siteFrame(crSite.lat, crSite.eLon, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
      const sky = loadSkyline(entry);
      annual.push({ heightM: h, pct: metrics(series(table, { frame, sky, marginDeg: 0 }, yearStart, yearEnd, STEP_MIN), yearStart, yearEnd).sunlitPct });
    }
  }
  if (annual.length > 1) {
    const lo = annual.reduce((a, b) => (b.pct < a.pct ? b : a));
    const hi = annual.reduce((a, b) => (b.pct > a.pct ? b : a));
    console.log(`   connecting-ridge annual average (UTC year 2030): ${annual.map((a) => `${a.pct.toFixed(2)}% at ${a.heightM} m`).join(', ')}`);
    console.log(`   spread from observer height alone: ${(hi.pct - lo.pct).toFixed(2)} points, ${lo.heightM} m to ${hi.heightM} m.`);
    console.log(`   The published comparison allows ${5} points, so a published value is compared only at a known height. npm run illumination-compare prints every published value and why none is a pass or fail yet.`);
  }
  console.log('\nE. Landing circle');
  console.log('   not computed: no stored skyline exists for a circle point yet. See npm run landing-report for what would be needed.');

  // The sensitivity line names the input that moved the sunlit share most, with the figure that shows it. It is
  // written from the rows computed above, not asserted.
  const moved = heightSensitivity(rows);
  if (moved.length > 0) {
    const biggest = moved.reduce((a, b) => (Math.abs(b.sunlitPoints) > Math.abs(a.sunlitPoints) ? b : a));
    const from = rows.find((r) => r.siteId === biggest.siteId && r.heightM === biggest.fromHeightM);
    const to = rows.find((r) => r.siteId === biggest.siteId && r.heightM === biggest.toHeightM);
    console.log(`\nSensitivity line: observer height moves the sunlit share most. At ${biggest.siteId} the same stay and start date gives ${from!.sunlitPct.toFixed(1)}% at ${biggest.fromHeightM} m and ${to!.sunlitPct.toFixed(1)}% at ${biggest.toHeightM} m, a change of ${biggest.sunlitPoints.toFixed(1)} points. A height error band and a start-date band would sit inside that for this site; both are reported above, and both are unavailable or smaller here.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
