// What an array or antenna mast buys at each site: the stay metrics recomputed from the stored terrain skyline
// at every observer height that has one. Reported values only, no threshold and no pass mark.
//
//   npm run height-report                     # every stored height, every site that has one
//   npm run height-report -- --preset lander --start 2027-03-01
//
// A height with no stored skyline is skipped and named in the output. It is never filled in from a neighbouring
// height: the horizon at 2 m and at 10 m differ by about a tenth of a degree on smooth ground, and that is a
// third of the Sun's disc. With one height present the report says exactly that and stops.
import { readFileSync } from 'node:fs';
import { DEG, MIN_MS, R_MOON_KM } from '../engine/constants.ts';
import { PRESETS } from '../engine/requirements.ts';
import { heightOptions, resolveSkylineAtHeight } from '../engine/heights.ts';
import type { Grade } from '../engine/skyline.ts';
import { siteFrame } from '../engine/frame.ts';
import { metrics } from '../engine/metrics.ts';
import { series } from '../engine/series.ts';
import { makeSkyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { loadTable } from './direction-check.ts';
import { SKYLINE_DIR } from './skyline-files.ts';
import { readSkylineIndex, type SkylineIndexEntry } from './skyline-index.ts';

const STEP_MIN = 10;
const DAY_MS = 86_400_000;

export interface HeightMetrics {
  siteId: string;
  heightM: number;
  grade: Grade;
  sunlitPct: number;
  longestDarkGapH: number;
  earthVisiblePct: number;
  longestLinkGapH: number;
}

export interface HeightComparison {
  siteId: string;
  fromHeightM: number;
  toHeightM: number;
  /** Percentage points gained going from the lower to the higher height. */
  sunlitPoints: number;
  darkGapHours: number;
  earthVisiblePoints: number;
  linkGapHours: number;
}

function metricsAt(
  table: ReturnType<typeof loadTable>,
  entry: SkylineIndexEntry,
  latDeg: number,
  eLonDeg: number,
  startMs: number,
  stayMs: number,
): HeightMetrics {
  const bytes = readFileSync(`${SKYLINE_DIR}/${entry.file}`);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { H, D } = decodeSkyline(copy as ArrayBuffer);
  const sky = makeSkyline({ H, D, grade: entry.grade as Grade, terrain: entry.terrain, heightM: entry.heightM });
  const frame = siteFrame(latDeg, eLonDeg, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
  const s = series(table, { frame, sky, marginDeg: 0 }, startMs, startMs + stayMs, STEP_MIN);
  const m = metrics(s, startMs, startMs + stayMs);
  return {
    siteId: entry.siteId,
    heightM: entry.heightM,
    grade: entry.grade as Grade,
    sunlitPct: m.sunlitPct,
    longestDarkGapH: m.longestDarkGapH,
    earthVisiblePct: m.earthVisiblePct,
    longestLinkGapH: m.longestLinkGapH,
  };
}

/** Pair each site's metrics between consecutive stored heights, low to high. One row per neighbouring pair. */
export function compareHeights(rows: HeightMetrics[]): HeightComparison[] {
  const bySite = new Map<string, HeightMetrics[]>();
  for (const r of rows) {
    const list = bySite.get(r.siteId) ?? [];
    list.push(r);
    bySite.set(r.siteId, list);
  }
  const out: HeightComparison[] = [];
  for (const [siteId, list] of bySite) {
    const sorted = [...list].sort((a, b) => a.heightM - b.heightM);
    for (let i = 1; i < sorted.length; i++) {
      const lo = sorted[i - 1];
      const hi = sorted[i];
      out.push({
        siteId,
        fromHeightM: lo.heightM,
        toHeightM: hi.heightM,
        sunlitPoints: hi.sunlitPct - lo.sunlitPct,
        darkGapHours: hi.longestDarkGapH - lo.longestDarkGapH,
        earthVisiblePoints: hi.earthVisiblePct - lo.earthVisiblePct,
        linkGapHours: hi.longestLinkGapH - lo.longestLinkGapH,
      });
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const presetId = flag('--preset', 'sortie');
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`unknown preset ${presetId}; try sortie, lander or year`);
  const stayMs = Math.round(preset.stayDays * DAY_MS / MIN_MS) * MIN_MS;
  const startMs = Date.parse(`${flag('--start', '2027-03-01')}T00:00:00Z`);
  if (!Number.isFinite(startMs)) throw new Error('--start takes a UTC date, for example 2027-03-01');

  const index = readSkylineIndex();
  if (!index) {
    console.log('No skyline index in app/public/data/skylines/. Run npm run build:skylines first.');
    return;
  }
  const options = heightOptions(index.skylines);
  console.log(`Heights with a stored skyline: ${options.filter((o) => o.available).map((o) => `${o.heightM} m`).join(', ') || 'none'}`);
  const missing = options.filter((o) => !o.available).map((o) => o.heightM);
  if (missing.length > 0) {
    console.log(`  No stored skyline at ${missing.map((h) => `${h} m`).join(', ')}. Build them with: npm run build:skylines -- --heights ${options.map((o) => o.heightM).join(',')}`);
  }

  const sites = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;
  const table = loadTable();
  const rows: HeightMetrics[] = [];
  for (const site of sites) {
    const mine = index.skylines.filter((e) => e.siteId === site.id);
    for (const entry of mine) {
      if (!resolveSkylineAtHeight(index.skylines, site.id, entry.heightM)) continue;
      rows.push(metricsAt(table, entry, site.lat, site.eLon, startMs, stayMs));
    }
  }

  if (rows.length === 0) {
    console.log('No site has a stored skyline, so there is no height to compare. Nothing is reported.');
    return;
  }
  console.log('');
  console.log('Sunlit %, longest dark gap, Earth-visible %, longest link gap. Reported values, no threshold.');
  for (const r of rows.sort((a, b) => a.siteId.localeCompare(b.siteId) || a.heightM - b.heightM)) {
    console.log(
      `  ${r.siteId.padEnd(34)} ${String(r.heightM).padStart(3)} m  grade ${r.grade}  ` +
      `sunlit ${r.sunlitPct.toFixed(2)}%  dark gap ${r.longestDarkGapH.toFixed(2)} h  ` +
      `earth ${r.earthVisiblePct.toFixed(2)}%  link gap ${r.longestLinkGapH.toFixed(2)} h`,
    );
  }

  const comparisons = compareHeights(rows);
  console.log('');
  if (comparisons.length === 0) {
    const heights = [...new Set(rows.map((r) => r.heightM))];
    console.log(
      `Only one observer height has a stored skyline (${heights.join(', ')} m), so there is nothing to compare and ` +
      'no mast effect is reported. Build another height to fill this in; nothing here is interpolated.',
    );
  } else {
    console.log('Change from the lower height to the higher one, same site and same stay:');
    for (const c of comparisons) {
      console.log(
        `  ${c.siteId.padEnd(34)} ${c.fromHeightM} m -> ${c.toHeightM} m  ` +
        `sunlit ${c.sunlitPoints >= 0 ? '+' : ''}${c.sunlitPoints.toFixed(2)} pts  ` +
        `dark gap ${c.darkGapHours >= 0 ? '+' : ''}${c.darkGapHours.toFixed(2)} h  ` +
        `earth ${c.earthVisiblePoints >= 0 ? '+' : ''}${c.earthVisiblePoints.toFixed(2)} pts  ` +
        `link gap ${c.linkGapHours >= 0 ? '+' : ''}${c.linkGapHours.toFixed(2)} h`,
      );
    }
  }
  console.log('');
  const dip = (h: number) => (-Math.acos(R_MOON_KM / (R_MOON_KM + h / 1000)) / DEG).toFixed(3);
  console.log(`Smooth-sphere horizon dip, for reference: ${dip(2)} deg at 2 m, ${dip(10)} deg at 10 m, ${dip(20)} deg at 20 m.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
