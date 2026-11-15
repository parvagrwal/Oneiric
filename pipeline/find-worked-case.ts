// Search 2027–2029 for a 21-day shift that flips the verdict for one polar site and not another, and print
// what the tool sees: the two sites, the four outcomes, the deciding rules, and the terrain ridge that
// blocks the Sun on the worse date. The worked case in docs/ is written from this output, never before it.
// Every polar site with a shipped 2 m skyline is scanned (grade B or C); custom coordinates are not.
import { readFileSync } from 'node:fs';
import {
  R_MOON_KM,
  azElOfDirection,
  directionFromSite,
  ephemAt,
  isDark,
  metrics,
  prepareRolling,
  refine,
  series,
  skylineAt,
  SLIP_STEP_MS,
  PRESETS,
} from '../engine/index.ts';
import { slip, verdict, viableFromRolling } from '../engine/requirements.ts';
import { siteFrame } from '../engine/frame.ts';
import { makeSkyline, type Grade, type Skyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { loadTable } from './direction-check.ts';

const DAY_MS = 86_400_000;
const MIN_MS = 600_000;
const SKYLINE_DIR = 'app/public/data/skylines';
const SHIFT_DAYS = 21;

interface PolarSite {
  id: string;
  name: string;
  lat: number;
  eLon: number;
  grade: Grade;
  terrain: string;
  siteElevationM: number;
  file: string;
}

function loadPolarSites(): PolarSite[] {
  const index = JSON.parse(readFileSync(`${SKYLINE_DIR}/index.json`, 'utf8')) as {
    skylines: Array<{ siteId: string; file: string; grade: Grade; terrain: string; siteElevationM: number }>;
  };
  const library = (JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')) as {
    sites: Array<{ id: string; name: string; lat: number; eLon: number }>;
  }).sites;
  const byId = new Map(library.map((s) => [s.id, s]));
  const out: PolarSite[] = [];
  for (const entry of index.skylines) {
    const lib = byId.get(entry.siteId);
    if (!lib) { console.error(`skipping ${entry.siteId}: not in the site library`); continue; }
    out.push({
      id: entry.siteId, name: lib.name, lat: lib.lat, eLon: lib.eLon,
      grade: entry.grade, terrain: entry.terrain, siteElevationM: entry.siteElevationM, file: entry.file,
    });
  }
  return out;
}

function loadSkyline(site: PolarSite): Skyline {
  const buf = readFileSync(`${SKYLINE_DIR}/${site.file}`);
  const { H, D } = decodeSkyline(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return makeSkyline({ H, D, grade: site.grade, terrain: site.terrain, heightM: 2 });
}

function siteFrameFor(site: PolarSite) {
  return siteFrame(site.lat, site.eLon, R_MOON_KM * 1000 + site.siteElevationM + 2);
}

const fmtUtc = (t: number) => new Date(t).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const DEG = Math.PI / 180;

/** Destination point from (lat, lon), initial bearing azimuthDeg, angular distance deltaRad, on the sphere. */
function destinationPoint(latDeg: number, lonDeg: number, azDeg: number, deltaRad: number): { latDeg: number; eLonDeg: number } {
  const phi1 = latDeg * DEG, lam1 = lonDeg * DEG, brng = azDeg * DEG;
  const sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1);
  const sinPhi2 = sinPhi1 * Math.cos(deltaRad) + cosPhi1 * Math.sin(deltaRad) * Math.cos(brng);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(brng) * Math.sin(deltaRad) * cosPhi1;
  const x = Math.cos(deltaRad) - sinPhi1 * sinPhi2;
  const lam2 = lam1 + Math.atan2(y, x);
  const eLonDeg = (((lam2 / DEG) % 360) + 360) % 360;
  return { latDeg: phi2 / DEG, eLonDeg };
}

interface DayOutcome {
  tMs: number;
  verdict: string;
  rule: string;
  sunlitPct: number;
  earthVisiblePct: number;
  longestDarkGapH: number;
  longestLinkGapH: number;
  slipLateDays: number | null;
  slipEarlyDays: number | null;
}

interface SiteScan {
  site: PolarSite;
  days: Map<number, DayOutcome>;
}

function scanSite(
  table: ReturnType<typeof loadTable>,
  site: PolarSite,
  seriesStartMs: number,
  seriesEndMs: number,
  colStartMs: number,
  colEndMs: number,
): SiteScan {
  const sky = loadSkyline(site);
  const frame = siteFrameFor(site);
  const s = series(table, { frame, sky }, seriesStartMs, seriesEndMs, 10);
  const rolling = prepareRolling(s);
  const preset = PRESETS.sortie;
  const stayMs = Math.round((preset.stayDays * DAY_MS) / MIN_MS) * MIN_MS;
  const firstStartMs = Math.floor((colStartMs - 30 * DAY_MS) / SLIP_STEP_MS) * SLIP_STEP_MS;
  const maxViableStartMs = Math.floor((seriesEndMs - stayMs - firstStartMs) / SLIP_STEP_MS) * SLIP_STEP_MS + firstStartMs;
  const viableCount = Math.floor((maxViableStartMs - firstStartMs) / SLIP_STEP_MS) + 1;
  const viable = viableFromRolling(rolling, preset, firstStartMs, viableCount, SLIP_STEP_MS);
  const days = new Map<number, DayOutcome>();
  for (let t = colStartMs; t <= colEndMs; t += DAY_MS) {
    const summary = rolling.summary(t, t + stayMs);
    const sl = slip(viable, firstStartMs, t, SLIP_STEP_MS);
    const v = verdict(summary, preset, sl);
    days.set(t, {
      tMs: t,
      verdict: v.verdict,
      rule: v.rule,
      sunlitPct: summary.sunlitPct,
      earthVisiblePct: summary.earthVisiblePct,
      longestDarkGapH: summary.longestDarkGapH,
      longestLinkGapH: summary.longestLinkGapH,
      slipLateDays: sl.viableAtChosen ? sl.lateDays : null,
      slipEarlyDays: sl.viableAtChosen ? sl.earlyDays : null,
    });
  }
  return { site, days };
}

/** Longest dark gap inside the stay starting at windowStartMs, and the terrain at the Sun's azimuth at mid-gap. */
function blockingRidge(table: ReturnType<typeof loadTable>, site: PolarSite, windowStartMs: number) {
  const sky = loadSkyline(site);
  const frame = siteFrameFor(site);
  const stayMs = Math.round(PRESETS.sortie.stayDays * DAY_MS);
  const s = series(table, { frame, sky }, windowStartMs, windowStartMs + stayMs, 10);
  let best: { start: number; end: number } | null = null;
  let i = 0;
  while (i < s.n) {
    if (!isDark(s.sunF[i])) { i++; continue; }
    let j = i;
    while (j < s.n && isDark(s.sunF[j])) j++;
    let start = s.t0Ms + i * s.stepMs;
    let end = s.t0Ms + j * s.stepMs;
    if (i > 0) start = refine((t) => isDark(s.probe(t).sunF), start - s.stepMs, start);
    if (j < s.n) end = refine((t) => !isDark(s.probe(t).sunF), end - s.stepMs, end);
    if (!best || end - start > best.end - best.start) best = { start, end };
    i = j;
  }
  if (!best) return null;
  const midMs = (best.start + best.end) / 2;
  const azDeg = azElOfDirection(frame, directionFromSite(frame, ephemAt(table, midMs).sun)).az;
  const look = skylineAt(sky, azDeg);
  const distanceKm = look.D / 100;
  const ridge = distanceKm > 0 ? destinationPoint(site.lat, site.eLon, azDeg, distanceKm / R_MOON_KM) : null;
  const m = metrics(s, windowStartMs, windowStartMs + stayMs);
  return {
    darkStartUtc: fmtUtc(best.start),
    darkEndUtc: fmtUtc(best.end),
    darkGapH: (best.end - best.start) / 3_600_000,
    midUtc: fmtUtc(midMs),
    azDeg,
    horizonDegAtMidAz: look.H,
    blockingDistanceKm: distanceKm,
    ridgeLatDeg: ridge ? ridge.latDeg : null,
    ridgeELonDeg: ridge ? ridge.eLonDeg : null,
    sunlitPct: m.sunlitPct,
  };
}

function main() {
  const table = loadTable();
  const sites = loadPolarSites();
  const colStartMs = Date.parse('2027-01-01T00:00:00Z');
  const colEndMs = Date.parse('2030-01-21T00:00:00Z'); // covers 2029-12-31 + 21 days
  const lastFlipDayMs = Date.parse('2029-12-31T00:00:00Z');
  const seriesStartMs = Date.parse('2026-12-01T00:00:00Z');
  const seriesEndMs = Date.parse('2030-06-01T00:00:00Z');
  console.log(`scanning ${sites.length} polar sites, daily starts 2027-01-01 to 2029-12-31, ${SHIFT_DAYS}-day shift,`);
  console.log(`6.5-day sortie rules (illustrative, not agency requirements), 2 m, shipped 2 m skylines (grade B or C)`);
  const scans: SiteScan[] = [];
  for (const site of sites) {
    const t0 = Date.now();
    scans.push(scanSite(table, site, seriesStartMs, seriesEndMs, colStartMs, colEndMs));
    console.log(`  scanned ${site.id} (${site.grade}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  const shiftMs = SHIFT_DAYS * DAY_MS;
  const rank = (v: string) => (v === 'GO' ? 0 : v === 'MARGINAL' ? 1 : 2);
  interface Candidate {
    flip: SiteScan; hold: SiteScan; tMs: number;
    f0: DayOutcome; f1: DayOutcome; h0: DayOutcome; h1: DayOutcome;
    score: number;
  }
  const candidates: Candidate[] = [];
  for (let i = 0; i < scans.length; i++) {
    for (let j = i + 1; j < scans.length; j++) {
      const a = scans[i], b = scans[j];
      for (let t = colStartMs; t <= lastFlipDayMs; t += DAY_MS) {
        const a0 = a.days.get(t)!, a1 = a.days.get(t + shiftMs)!;
        const b0 = b.days.get(t)!, b1 = b.days.get(t + shiftMs)!;
        const flipA = a0.verdict !== a1.verdict;
        const flipB = b0.verdict !== b1.verdict;
        if (flipA === flipB) continue;
        const flip = flipA ? a : b;
        const hold = flipA ? b : a;
        const f0 = flipA ? a0 : b0, f1 = flipA ? a1 : b1;
        const h0 = flipA ? b0 : a0, h1 = flipA ? b1 : a1;
        let score = 10 * Math.abs(rank(f1.verdict) - rank(f0.verdict));
        if (h0.verdict === 'GO' && h1.verdict === 'GO') score += 4;
        if (flip.site.grade === 'B' && hold.site.grade === 'B') score += 2;
        if (f0.verdict === 'GO' && f1.verdict === 'NO-GO') score += 3;
        candidates.push({ flip, hold, tMs: t, f0, f1, h0, h1, score });
      }
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  console.log(`\n${candidates.length} (pair, date) candidates where exactly one site flips under a ${SHIFT_DAYS}-day shift`);
  for (const [idx, c] of candidates.slice(0, 15).entries()) {
    console.log(`\n#${idx + 1} score ${c.score}`);
    console.log(`  t = ${fmtDay(c.tMs)}  (shift to ${fmtDay(c.tMs + shiftMs)})`);
    console.log(`  flips:  ${c.flip.site.id} (${c.flip.site.grade})  ${c.f0.verdict} -> ${c.f1.verdict}`);
    console.log(`    at t:      sunlit ${c.f0.sunlitPct.toFixed(1)}%  dark gap ${c.f0.longestDarkGapH.toFixed(1)} h  Earth ${c.f0.earthVisiblePct.toFixed(1)}%  link gap ${c.f0.longestLinkGapH.toFixed(1)} h  slip late ${c.f0.slipLateDays ?? 'n/a'} d`);
    console.log(`    at t+${SHIFT_DAYS}d: sunlit ${c.f1.sunlitPct.toFixed(1)}%  dark gap ${c.f1.longestDarkGapH.toFixed(1)} h  Earth ${c.f1.earthVisiblePct.toFixed(1)}%  link gap ${c.f1.longestLinkGapH.toFixed(1)} h  slip late ${c.f1.slipLateDays ?? 'n/a'} d`);
    console.log(`    rule at t:     ${c.f0.rule}`);
    console.log(`    rule at t+${SHIFT_DAYS}: ${c.f1.rule}`);
    console.log(`  holds:  ${c.hold.site.id} (${c.hold.site.grade})  ${c.h0.verdict} -> ${c.h1.verdict}`);
    console.log(`    at t:      sunlit ${c.h0.sunlitPct.toFixed(1)}%  dark gap ${c.h0.longestDarkGapH.toFixed(1)} h  Earth ${c.h0.earthVisiblePct.toFixed(1)}%  link gap ${c.h0.longestLinkGapH.toFixed(1)} h  slip late ${c.h0.slipLateDays ?? 'n/a'} d`);
    console.log(`    at t+${SHIFT_DAYS}d: sunlit ${c.h1.sunlitPct.toFixed(1)}%  dark gap ${c.h1.longestDarkGapH.toFixed(1)} h  Earth ${c.h1.earthVisiblePct.toFixed(1)}%  link gap ${c.h1.longestLinkGapH.toFixed(1)} h  slip late ${c.h1.slipLateDays ?? 'n/a'} d`);
  }
  if (candidates.length === 0) {
    console.log('\nNO CANDIDATE FOUND in 2027–2029 for a 21-day shift; the worked case cannot be written from tool output.');
    return;
  }
  const c = candidates[0];
  const worse = rank(c.f1.verdict) >= rank(c.f0.verdict) ? { windowMs: c.tMs + shiftMs, label: `t+${SHIFT_DAYS}d` } : { windowMs: c.tMs, label: 't' };
  const ridge = blockingRidge(table, c.flip.site, worse.windowMs);
  console.log('\nBEST-CANDIDATE-JSON');
  console.log(JSON.stringify({
    shiftDays: SHIFT_DAYS,
    startUtc: fmtDay(c.tMs),
    flippingSite: {
      id: c.flip.site.id, name: c.flip.site.name, grade: c.flip.site.grade, terrain: c.flip.site.terrain,
      siteElevationM: c.flip.site.siteElevationM, lat: c.flip.site.lat, eLon: c.flip.site.eLon,
      before: c.f0, after: c.f1,
    },
    holdingSite: {
      id: c.hold.site.id, name: c.hold.site.name, grade: c.hold.site.grade, terrain: c.hold.site.terrain,
      siteElevationM: c.hold.site.siteElevationM, lat: c.hold.site.lat, eLon: c.hold.site.eLon,
      before: c.h0, after: c.h1,
    },
    worseWindow: { label: worse.label, startUtc: new Date(worse.windowMs).toISOString() },
    blockingRidge: ridge,
  }, null, 2));
}

main();
