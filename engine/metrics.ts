import { AU_KM, DEG, HOUR_MS, MIN_MS, SOLAR_CONSTANT_W_M2 } from './constants.ts';
import { isDark, type Sample, type Series } from './series.ts';
import type { Grade } from './skyline.ts';

export interface Eclipse { startMs: number; endMs: number; maxObscuration: number }

export interface Metrics {
  windowStartMs: number;
  windowEndMs: number;
  hours: number;
  sunlitPct: number;
  longestDarkGapH: number;
  earthVisiblePct: number;
  longestLinkGapH: number;
  overlapPct: number;
  eclipses: Eclipse[];
  /** kWh/m2 over the window. */
  energyKWhM2: { sunTrackingVertical: number; fixedVertical: number; horizontalDeck: number };
  /** Facing azimuth (degrees from north through east) that gave the fixed vertical array its best energy, out of 8 compass facings. */
  fixedVerticalBestFacingDeg: number;
  grade: Grade;
  terrain: string;
  heightM: number;
}

/** Bisect to 1 minute: `lo` is a time where pred is false, `hi` where it is true. Returns the first true time found. */
export function refine(pred: (tMs: number) => boolean, loMs: number, hiMs: number): number {
  let lo = loMs;
  let hi = hiMs;
  while (hi - lo > MIN_MS) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

function indexAt(s: Series, tMs: number): number {
  const k = (tMs - s.t0Ms) / s.stepMs;
  const i = Math.round(k);
  if (Math.abs(k - i) * s.stepMs > 1) throw new RangeError('window does not line up with the series steps');
  if (i < 0 || i > s.n) throw new RangeError('window lies outside the series');
  return i;
}

/** Longest run (ms) of steps in [i0, i1) where flag(i) is true. Run edges inside the window are refined to 1 minute. */
function longestRun(s: Series, i0: number, i1: number, flag: (i: number) => boolean, probeFlag: (p: Sample) => boolean) {
  let best = 0;
  let i = i0;
  while (i < i1) {
    if (!flag(i)) { i++; continue; }
    let j = i;
    while (j < i1 && flag(j)) j++;
    // Run covers steps i .. j-1.
    let start = s.t0Ms + i * s.stepMs;
    let end = s.t0Ms + j * s.stepMs;
    if (i > i0) start = refine((t) => probeFlag(s.probe(t)), start - s.stepMs, start);
    if (j < i1) {
      // Last true sample is j-1 (state holds at its start); first false is at step j. Find first false time.
      end = refine((t) => !probeFlag(s.probe(t)), end - s.stepMs, end);
    }
    best = Math.max(best, end - start);
    i = j;
  }
  return best;
}

const FACINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/** Metrics over [startMs, endMs). Both ends must lie on the series steps. */
export function metrics(s: Series, startMs: number, endMs: number): Metrics {
  const i0 = indexAt(s, startMs);
  const i1 = indexAt(s, endMs);
  if (i1 <= i0) throw new RangeError('empty window');
  const n = i1 - i0;
  let sumF = 0, vis = 0, both = 0;
  const e = { track: 0, horiz: 0 };
  const fixed = new Float64Array(FACINGS.length);
  const stepH = s.stepMs / HOUR_MS;
  for (let i = i0; i < i1; i++) {
    const f = s.sunF[i];
    sumF += f;
    if (s.earthVis[i]) vis++;
    if (s.earthVis[i] && !isDark(f)) both++;
    const wm2 = SOLAR_CONSTANT_W_M2 * (AU_KM / s.sunDistKm[i]) ** 2 * f;
    const el = s.sunEl[i] * DEG;
    e.track += wm2 * Math.max(0, Math.cos(el)) * stepH / 1000;
    e.horiz += wm2 * Math.max(0, Math.sin(el)) * stepH / 1000;
    for (let k = 0; k < FACINGS.length; k++) {
      fixed[k] += wm2 * Math.max(0, Math.cos(el) * Math.cos((s.sunAz[i] - FACINGS[k]) * DEG)) * stepH / 1000;
    }
  }
  let bestK = 0;
  for (let k = 1; k < FACINGS.length; k++) if (fixed[k] > fixed[bestK]) bestK = k;

  const dark = longestRun(s, i0, i1, (i) => isDark(s.sunF[i]), (p) => isDark(p.sunF));
  const noLink = longestRun(s, i0, i1, (i) => !s.earthVis[i], (p) => !p.earthVis);

  // Eclipses by Earth: runs of steps with some cover. Edges are refined to 1 minute.
  const eclipses: Eclipse[] = [];
  let i = i0;
  while (i < i1) {
    if (s.earthCover[i] <= 0) { i++; continue; }
    let j = i, max = 0;
    while (j < i1 && s.earthCover[j] > 0) { max = Math.max(max, s.earthCover[j]); j++; }
    let start = s.t0Ms + i * s.stepMs;
    let end = s.t0Ms + j * s.stepMs;
    if (i > i0) start = refine((t) => s.probe(t).earthCover > 0, start - s.stepMs, start);
    if (j < i1) end = refine((t) => s.probe(t).earthCover <= 0, end - s.stepMs, end);
    eclipses.push({ startMs: start, endMs: end, maxObscuration: max });
    i = j;
  }

  return {
    windowStartMs: startMs, windowEndMs: endMs, hours: n * stepH,
    sunlitPct: (100 * sumF) / n,
    longestDarkGapH: dark / HOUR_MS,
    earthVisiblePct: (100 * vis) / n,
    longestLinkGapH: noLink / HOUR_MS,
    overlapPct: (100 * both) / n,
    eclipses,
    energyKWhM2: { sunTrackingVertical: e.track, fixedVertical: fixed[bestK], horizontalDeck: e.horiz },
    fixedVerticalBestFacingDeg: FACINGS[bestK],
    grade: s.grade, terrain: s.terrain, heightM: s.heightM,
  };
}

export type ClockKind = 'sunset' | 'earthset';
export interface Clock {
  /** 'already': the event has happened (the Sun is dark, or Earth is hidden) at fromMs. 'none': no event before the limit. */
  status: 'at' | 'already' | 'none';
  tMs?: number;
}

/** Next time the Sun's disc is gone (sunset) or Earth's centre drops below the skyline (earthset). Bisected to 1 minute. */
export function nextClock(s: Pick<Series, 'probe'>, kind: ClockKind, fromMs: number, limitMs: number, scanStepMs = 10 * MIN_MS): Clock {
  const hit = (t: number) => { const p = s.probe(t); return kind === 'sunset' ? isDark(p.sunF) : !p.earthVis; };
  if (hit(fromMs)) return { status: 'already' };
  let prev = fromMs;
  for (let t = fromMs + scanStepMs; t <= limitMs + scanStepMs; t += scanStepMs) {
    const tt = Math.min(t, limitMs);
    if (hit(tt)) return { status: 'at', tMs: refine(hit, prev, tt) };
    prev = tt;
    if (tt >= limitMs) break;
  }
  return { status: 'none' };
}
