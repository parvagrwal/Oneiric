// Mission hindcasts: replay recorded mission events with the same engine the app uses.
// Tolerances were fixed on 2026-11-15, before the first run (see evidence/mission-hindcasts/). They are
// not adjusted after the run; a missed tolerance stays on the validation page with its explanation.
// Grade D means a smooth sphere (no terrain); grade C means the 240 m LOLA raster only.
import { readFileSync } from 'node:fs';
import { MIN_MS } from '../engine/constants.ts';
import { ephemAt, type EphemTable } from '../engine/ephemeris.ts';
import { azElOfDirection, directionFromSite, siteFrame, smoothSiteFrame, type SiteFrame } from '../engine/frame.ts';
import { nextClock, refine } from '../engine/metrics.ts';
import { series } from '../engine/series.ts';
import { makeSkyline, smoothHorizonDeg, smoothSkyline, type Grade, type Skyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { sunFraction } from '../engine/sunlight.ts';
import { dot, norm } from '../engine/vec.ts';
import { loadTable } from './direction-check.ts';
import { engineVersion } from './engine-version.ts';
import type { ValidationRow } from './validate.ts';

const HOUR = 3_600_000;

/** Reference times and tolerances, all UTC. Fixed on 2026-11-15, before the first run. */
export const REFS = {
  // NASA's catalogue gives the greatest eclipse at 2025-03-14T06:58:47Z, for the Moon's centre.
  eclipseCentreMs: Date.parse('2025-03-14T06:58:47Z'),
  eclipseCentreToleranceMin: 5,
  // Firefly's mission-log imagery: the Sun is fully hidden about 07:30 UTC; the diamond ring (Sun reappearing) about 08:30 UTC.
  hiddenAtMs: Date.parse('2025-03-14T07:30:00Z'),
  reappearsEarliestMs: Date.parse('2025-03-14T08:10:00Z'),
  reappearsLatestMs: Date.parse('2025-03-14T08:50:00Z'),
  // Firefly: last contact 2025-03-16 23:25 UTC, about 5 hours after sunset.
  blueGhostSunsetMs: Date.parse('2025-03-16T18:25:00Z'),
  blueGhostSunsetToleranceH: 3,
  // ISRO: Pragyan was parked and set to sleep on 2023-09-02; Vikram on 2023-09-04. Both ahead of the local sunset.
  // Fixed reference: the tool's sunset must fall after the later sleep date.
  sleepReferenceMs: Date.parse('2023-09-04T00:00:00Z'),
  // SLIM landed 2024-01-19T15:20Z with its cells facing west; power returned on 2024-01-28.
  slimLandedMs: Date.parse('2024-01-19T15:20:00Z'),
  slimReturnedMs: Date.parse('2024-01-28T15:20:00Z'),
} as const;

const BLUE_GHOST = { lat: 18.5623, eLon: 61.8103 };
const CHANDRAYAAN_3 = { lat: -69.3741, eLon: 32.32 };
const SLIM = { lat: -13.3, eLon: 25.2 };
const CHANG_E_6 = { lat: -41.6384, eLon: 206.0146 };
const HEIGHT_M = 2;

export interface SubCheck {
  id: string;
  name: string;
  pass: boolean;
  grade: Grade | 'n/a';
  /** What the reference says, with the tolerance fixed before the run. */
  reference: string;
  /** What the tool measured. */
  measured: string;
  note?: string;
}

const fmtUtc = (t: number) => new Date(t).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

/** Angular separation of Sun and Earth as seen from the Moon's centre, degrees. */
export function separationAtMoonCentreDeg(table: EphemTable, tMs: number): number {
  const { sun, earth } = ephemAt(table, tMs);
  const cos = dot(sun, earth) / (norm(sun) * norm(earth));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Epoch of the minimum Sun–Earth separation on 2025-03-14, refined to 1 minute. */
export function eclipseCentreEpochMs(table: EphemTable): { tMs: number; separationDeg: number } {
  const dayStart = Date.parse('2025-03-14T00:00:00Z');
  let bestT = dayStart;
  let bestV = Infinity;
  for (let t = dayStart; t < dayStart + 24 * HOUR; t += 10 * MIN_MS) {
    const v = separationAtMoonCentreDeg(table, t);
    if (v < bestV) { bestV = v; bestT = t; }
  }
  let fineT = bestT;
  let fineV = bestV;
  for (let t = Math.max(dayStart, bestT - 12 * MIN_MS); t <= Math.min(dayStart + 24 * HOUR, bestT + 12 * MIN_MS); t += MIN_MS) {
    const v = separationAtMoonCentreDeg(table, t);
    if (v < fineV) { fineV = v; fineT = t; }
  }
  return { tMs: fineT, separationDeg: fineV };
}

/** First time after `fromMs` at which the solar disc fraction reaches `fMin`, bisected to 1 minute. Null when it does not happen by `limitMs`. */
export function firstTimeSunAtLeast(
  table: EphemTable,
  site: { frame: SiteFrame; sky: Skyline },
  fromMs: number,
  limitMs: number,
  fMin: number,
): number | null {
  const probe = (t: number) => sunFraction(site.frame, ephemAt(table, t).sun, ephemAt(table, t).earth, site.sky).f;
  if (probe(fromMs) >= fMin) return fromMs;
  for (let t = fromMs + 10 * MIN_MS; t <= limitMs; t += 10 * MIN_MS) {
    if (probe(t) >= fMin) return refine((tt) => probe(tt) >= fMin, t - 10 * MIN_MS, t);
  }
  return null;
}

export function runHindcastChecks(table: EphemTable = loadTable()): ValidationRow {
  const checks: SubCheck[] = [];

  // 1. Greatest eclipse at the Moon's centre.
  const centre = eclipseCentreEpochMs(table);
  const centreErrMin = (centre.tMs - REFS.eclipseCentreMs) / 60_000;
  checks.push({
    id: 'eclipse-centre',
    name: 'Eclipse mid-time at the Moon centre, 14 Mar 2025',
    pass: Math.abs(centreErrMin) <= REFS.eclipseCentreToleranceMin,
    grade: 'n/a',
    reference: `NASA catalogue greatest eclipse 2025-03-14T06:58:47Z; limit ±${REFS.eclipseCentreToleranceMin} min`,
    measured: `greatest eclipse ${fmtUtc(centre.tMs)} (Sun–Earth separation ${centre.separationDeg.toFixed(3)}°), ${centreErrMin >= 0 ? '+' : ''}${centreErrMin.toFixed(1)} min from the catalogue`,
  });

  // 2. Blue Ghost: the Sun fully hidden at 07:30 UTC; reappearing (end of totality) within 08:30 ± 20 min.
  const ghostFrame = smoothSiteFrame(BLUE_GHOST.lat, BLUE_GHOST.eLon, HEIGHT_M);
  const ghostSky = smoothSkyline(HEIGHT_M);
  const f0730 = sunFraction(ghostFrame, ephemAt(table, REFS.hiddenAtMs).sun, ephemAt(table, REFS.hiddenAtMs).earth, ghostSky).f;
  const totalityEnd = firstTimeSunAtLeast(table, { frame: ghostFrame, sky: ghostSky }, REFS.hiddenAtMs, Date.parse('2025-03-14T13:00:00Z'), 0.01);
  const hiddenOk = f0730 < 0.01;
  const endOk = totalityEnd !== null && totalityEnd >= REFS.reappearsEarliestMs && totalityEnd <= REFS.reappearsLatestMs;
  checks.push({
    id: 'eclipse-site',
    name: 'Blue Ghost totality, 14 Mar 2025',
    pass: hiddenOk && endOk,
    grade: 'D',
    reference: 'Sun fully hidden at 2025-03-14T07:30Z, reappearing at 08:30Z ± 20 min (Firefly mission-log imagery); smooth sphere, 2 m',
    measured: `sunlit fraction at 07:30Z = ${f0730.toFixed(4)} (${hiddenOk ? 'hidden' : 'NOT hidden'}); Sun reappears ${totalityEnd === null ? 'not before 13:00Z' : fmtUtc(totalityEnd)}`,
    note: 'End of totality is the first time the solar disc fraction reaches 0.01 after 07:30Z, bisected to 1 minute. The end of the partial eclipse (Earth clear of the Sun) is later and is not this check.',
  });

  // 3. Blue Ghost sunset on 16 Mar 2025.
  const ghostDay = series(table, { frame: ghostFrame, sky: ghostSky }, Date.parse('2025-03-15T00:00:00Z'), Date.parse('2025-03-18T00:00:00Z'), 10);
  const sunset = nextClock(ghostDay, 'sunset', Date.parse('2025-03-16T00:00:00Z'), Date.parse('2025-03-17T00:00:00Z'));
  const sunsetMs = sunset.status === 'at' ? sunset.tMs! : NaN;
  const sunsetErrH = Number.isFinite(sunsetMs) ? (sunsetMs - REFS.blueGhostSunsetMs) / 3_600_000 : NaN;
  checks.push({
    id: 'blue-ghost-sunset',
    name: 'Blue Ghost sunset, 16 Mar 2025',
    pass: Number.isFinite(sunsetMs) && Math.abs(sunsetErrH) <= REFS.blueGhostSunsetToleranceH,
    grade: 'D',
    reference: `Last contact 2025-03-16T23:25Z, about 5 h after sunset; tool sunset within ±${REFS.blueGhostSunsetToleranceH} h of 2025-03-16T18:25Z; smooth sphere, 2 m`,
    measured: sunset.status === 'at'
      ? `sunset ${fmtUtc(sunsetMs)}, ${sunsetErrH >= 0 ? '+' : ''}${sunsetErrH.toFixed(2)} h from 18:25Z`
      : `sunset not found on 2025-03-16 (clock status: ${sunset.status})`,
  });

  // 4. Chandrayaan-3: the tool's sunset falls after the sleep date. Uses the shipped 2 m LOLA 240 m skyline (grade C).
  const index = JSON.parse(readFileSync('app/public/data/skylines/index.json', 'utf8')) as {
    skylines: Array<{ siteId: string; file: string; grade: Grade; terrain: string; siteElevationM: number }>;
  };
  const entry = index.skylines.find((s) => s.siteId === 'chandrayaan-3');
  if (!entry) throw new Error('no shipped skyline for chandrayaan-3');
  const binBytes = readFileSync(`app/public/data/skylines/${entry.file}`);
  const decoded = decodeSkyline(binBytes.buffer.slice(binBytes.byteOffset, binBytes.byteOffset + binBytes.byteLength));
  const cFrame = siteFrame(CHANDRAYAAN_3.lat, CHANDRAYAAN_3.eLon, 1_737_400 + entry.siteElevationM + HEIGHT_M);
  const cSky = makeSkyline({ H: decoded.H, D: decoded.D, grade: entry.grade, terrain: entry.terrain, heightM: HEIGHT_M });
  const cyDay = series(table, { frame: cFrame, sky: cSky }, Date.parse('2023-08-23T00:00:00Z'), Date.parse('2023-10-15T00:00:00Z'), 10);
  const cySunset = nextClock(cyDay, 'sunset', Date.parse('2023-08-23T00:00:00Z'), Date.parse('2023-10-01T00:00:00Z'));
  const cyMs = cySunset.status === 'at' ? cySunset.tMs! : NaN;
  const cyOk = Number.isFinite(cyMs) && cyMs > REFS.sleepReferenceMs;
  checks.push({
    id: 'chandrayaan-3-sunset',
    name: 'Chandrayaan-3 sunset after the sleep date',
    pass: cyOk,
    grade: entry.grade,
    reference: 'ISRO: Pragyan parked and set to sleep 2023-09-02, Vikram 2023-09-04, both ahead of sunset; tool sunset must fall after 2023-09-04T00:00Z (reference fixed 2026-11-15)',
    measured: cySunset.status === 'at'
      ? `first sunset after landing ${fmtUtc(cyMs)}, ${((cyMs - REFS.sleepReferenceMs) / 86_400_000).toFixed(2)} days after the sleep reference (grade ${entry.grade}, ${entry.terrain})`
      : `sunset not found before 2023-10-01 (clock status: ${cySunset.status})`,
    note: 'Grade C: no 20 m near field covers this site; the horizon is the 240 m LOLA raster only.',
  });

  // 5. SLIM: Sun in the east at landing, in the west by 28 January.
  const slimFrame = smoothSiteFrame(SLIM.lat, SLIM.eLon, HEIGHT_M);
  const slimAz = (t: number) => azElOfDirection(slimFrame, directionFromSite(slimFrame, ephemAt(table, t).sun)).az;
  const slimLand = slimAz(REFS.slimLandedMs);
  const slimReturn = slimAz(REFS.slimReturnedMs);
  const slimOk = slimLand > 0 && slimLand < 180 && slimReturn > 180 && slimReturn < 360;
  checks.push({
    id: 'slim-azimuth',
    name: 'SLIM Sun azimuth, east at landing and west by 28 Jan 2024',
    pass: slimOk,
    grade: 'D',
    reference: 'Landed 2024-01-19T15:20Z with cells facing west; power returned on 2024-01-28; Sun azimuth east (0–180°) at landing, west (180–360°) by 2024-01-28T15:20Z; azimuth from north through east',
    measured: `azimuth ${slimLand.toFixed(1)}° at landing, ${slimReturn.toFixed(1)}° on 2024-01-28T15:20Z`,
  });

  // 6. Chang'e-6: Earth is below the smooth-sphere horizon at every hourly epoch in the table.
  const ceFrame = smoothSiteFrame(CHANG_E_6.lat, CHANG_E_6.eLon, HEIGHT_M);
  const horizonDeg = smoothHorizonDeg(HEIGHT_M);
  let ceMax = -Infinity;
  let ceMaxT = 0;
  let ceN = 0;
  const spanStart = Date.parse('2023-01-01T00:00:00Z');
  const spanEnd = Date.parse('2040-12-31T00:00:00Z');
  for (let t = spanStart; t <= spanEnd; t += HOUR) {
    const el = azElOfDirection(ceFrame, directionFromSite(ceFrame, ephemAt(table, t).earth)).el;
    if (el > ceMax) { ceMax = el; ceMaxT = t; }
    ceN++;
  }
  checks.push({
    id: 'chang-e-6-earth',
    name: 'Chang’e-6 Earth visibility, 2023–2040',
    pass: ceMax < horizonDeg,
    grade: 'D',
    reference: `Far side; Earth must stay below the ${HEIGHT_M} m smooth-sphere horizon (${horizonDeg.toFixed(3)}°) at every hourly epoch in the table`,
    measured: `highest Earth elevation ${ceMax.toFixed(3)}° at ${fmtUtc(ceMaxT)} across ${ceN.toLocaleString()} hourly epochs`,
  });

  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  return {
    id: 'mission-hindcasts',
    name: 'Mission hindcasts against recorded mission events',
    n: checks.length, maxDeg: null, rmsDeg: null, thresholdDeg: null,
    pass: failed.length === 0,
    fixtureFiles: [
      'fixtures/horizons/global/moon-<year>.txt, 2023 to 2040 (Moon-centred Sun and Earth vectors)',
      'app/public/data/skylines/chandrayaan-3-2m.bin and .json (Chandrayaan-3 sunset only)',
      'site coordinates from app/public/data/sites.json; Blue Ghost (18.5623°N, 61.8103°E) from NASA LEAG 2025 slides',
    ],
    runAtUtc: new Date().toISOString(),
    engineCommit: engineVersion(),
    detail: { failed, subChecks: checks },
    notes: [
      'Tolerances fixed on 2026-11-15 before the first run; they were not adjusted after the run.',
      'Grade D hindcasts (Blue Ghost, SLIM, Chang’e-6) use a smooth sphere with no terrain; the Chandrayaan-3 sunset uses the shipped 2 m LOLA 240 m skyline (grade C). No grade-D result is presented as terrain.',
      'References: NASA eclipse catalogue (greatest eclipse at the Moon centre) and Firefly Aerospace mission-log imagery for 14 Mar 2025; ISRO statements for the Chandrayaan-3 sleep dates (Pragyan 2023-09-02, Vikram 2023-09-04); landing and power-return dates for SLIM (2024-01-19, 2024-01-28) as recorded in the site library.',
      'This run replays recorded events; it does not validate future predictions.',
    ],
  };
}
