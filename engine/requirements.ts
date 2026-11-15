import { HOUR_MS } from './constants.ts';
import { prepareRolling, type Metrics, type RollingSeries, type RuleSummary } from './metrics.ts';
import type { Series } from './series.ts';
import type { Grade } from './skyline.ts';

export const PRESET_LABEL = 'illustrative, not agency requirements';

export interface Preset {
  id: string;
  name: string;
  stayDays: number;
  /** null for the one-year stay: annual figures only, no verdict. */
  rules: null | { sunlitMinPct: number; darkGapMaxH: number; earthVisibleMinPct: number; linkGapMaxH: number };
  label: string;
}

export const PRESETS: Record<string, Preset> = {
  sortie: { id: 'sortie', name: '6.5-day sortie', stayDays: 6.5, label: PRESET_LABEL,
    rules: { sunlitMinPct: 95, darkGapMaxH: 6, earthVisibleMinPct: 90, linkGapMaxH: 6 } },
  lander: { id: 'lander', name: 'One-lunar-day lander (14 days)', stayDays: 14, label: PRESET_LABEL,
    rules: { sunlitMinPct: 80, darkGapMaxH: 24, earthVisibleMinPct: 50, linkGapMaxH: 48 } },
  year: { id: 'year', name: 'One-year stay', stayDays: 365, label: PRESET_LABEL, rules: null },
};

export const MARGINAL_SLIP_DAYS = 3;

export interface RuleCheck { rule: string; met: boolean; value: number; limit: number }

export function checkRules(m: Metrics | RuleSummary, p: Preset): RuleCheck[] {
  if (!p.rules) return [];
  const r = p.rules;
  const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
  return [
    { rule: `sunlit at least ${r.sunlitMinPct}% (got ${f1(m.sunlitPct)}%)`, met: m.sunlitPct >= r.sunlitMinPct, value: m.sunlitPct, limit: r.sunlitMinPct },
    { rule: `longest dark gap at most ${r.darkGapMaxH} h (got ${f1(m.longestDarkGapH)} h)`, met: m.longestDarkGapH <= r.darkGapMaxH, value: m.longestDarkGapH, limit: r.darkGapMaxH },
    { rule: `Earth visible at least ${r.earthVisibleMinPct}% (got ${f1(m.earthVisiblePct)}%)`, met: m.earthVisiblePct >= r.earthVisibleMinPct, value: m.earthVisiblePct, limit: r.earthVisibleMinPct },
    { rule: `longest link gap at most ${r.linkGapMaxH} h (got ${f1(m.longestLinkGapH)} h)`, met: m.longestLinkGapH <= r.linkGapMaxH, value: m.longestLinkGapH, limit: r.linkGapMaxH },
  ];
}

export interface Slip {
  viableAtChosen: boolean;
  /** Days the stay start can move later and stay viable; null if the chosen date is not viable. */
  lateDays: number | null;
  earlyDays: number | null;
  /** True when the run reaches the edge of the evaluated range, so the real tolerance is at least this long. */
  lateCensored: boolean;
  earlyCensored: boolean;
  /** When the chosen date is not viable: the next viable start and how long that window lasts. */
  nextWindow: null | { startMs: number; lengthDays: number; censored: boolean };
}

export const SLIP_STEP_MS = 6 * HOUR_MS;

/** Slip tolerance from viable(t), evaluated every 6 hours from startMs. The chosen date snaps down to the 6-hour grid. */
export function slip(viable: Uint8Array, firstStartMs: number, chosenMs: number, stepMs = SLIP_STEP_MS): Slip {
  const i = Math.floor((chosenMs - firstStartMs) / stepMs);
  if (i < 0 || i >= viable.length) throw new RangeError('chosen date is outside the evaluated range');
  const days = (steps: number) => (steps * stepMs) / 86_400_000;
  if (viable[i]) {
    let j = i;
    while (j + 1 < viable.length && viable[j + 1]) j++;
    let k = i;
    while (k - 1 >= 0 && viable[k - 1]) k--;
    return { viableAtChosen: true, lateDays: days(j - i), earlyDays: days(i - k),
      lateCensored: j === viable.length - 1, earlyCensored: k === 0, nextWindow: null };
  }
  let a = i + 1;
  while (a < viable.length && !viable[a]) a++;
  let nextWindow: Slip['nextWindow'] = null;
  if (a < viable.length) {
    let b = a;
    while (b + 1 < viable.length && viable[b + 1]) b++;
    nextWindow = { startMs: firstStartMs + a * stepMs, lengthDays: days(b - a + 1), censored: b === viable.length - 1 };
  }
  return { viableAtChosen: false, lateDays: null, earlyDays: null, lateCensored: false, earlyCensored: false, nextWindow };
}

/** viable[k] is 1 when a stay of p.stayDays starting at firstStartMs + k * stepMs meets every rule, using prefix sums. */
export function viableFromRolling(
  rolling: RollingSeries,
  p: Preset,
  firstStartMs: number,
  count: number,
  stepMs = SLIP_STEP_MS,
): Uint8Array {
  if (!p.rules) throw new Error('the one-year stay has no verdict, so no viable windows');
  const s = rolling.series;
  const out = new Uint8Array(count);
  const stayMs = Math.round((p.stayDays * 86_400_000) / s.stepMs) * s.stepMs;
  const seriesEndMs = s.t0Ms + s.n * s.stepMs;
  for (let k = 0; k < count; k++) {
    const a = firstStartMs + k * stepMs;
    const b = a + stayMs;
    if (b > seriesEndMs) throw new RangeError('series is too short for this stay');
    out[k] = checkRules(rolling.summary(a, b), p).every((c) => c.met) ? 1 : 0;
  }
  return out;
}

/** viable[k] is 1 when a stay of p.stayDays starting at firstStartMs + k * 6 h meets every rule. */
export function viableSeries(s: Series, p: Preset, firstStartMs: number, count: number, stepMs = SLIP_STEP_MS): Uint8Array {
  return viableFromRolling(prepareRolling(s), p, firstStartMs, count, stepMs);
}

export type VerdictName = 'GO' | 'MARGINAL' | 'NO-GO' | 'NONE';
export interface Verdict {
  verdict: VerdictName;
  /** The rule that decided it, in one sentence. */
  rule: string;
  failed: string[];
  grade: Grade;
  terrain: string;
  presetLabel: string;
}

/** GO: every rule is met. MARGINAL: rules met but days-late slip tolerance is under 3 days. NO-GO: a rule fails.
 *  A failed rule beats a passed rule. The slip argument is required so a GO is never given without it. */
export function verdict(m: Metrics | RuleSummary, p: Preset, sl: Slip): Verdict {
  if (!m.grade || !m.terrain) throw new Error('a verdict needs its fidelity grade and terrain source');
  const base = { grade: m.grade, terrain: m.terrain, presetLabel: p.label };
  if (!p.rules) return { ...base, verdict: 'NONE', rule: 'The one-year stay has annual figures and the longest night only, no verdict.', failed: [] };
  const checks = checkRules(m, p);
  const failed = checks.filter((c) => !c.met).map((c) => c.rule);
  if (failed.length) return { ...base, verdict: 'NO-GO', rule: `Fails: ${failed[0]}.`, failed };
  const late = sl.viableAtChosen ? sl.lateDays! : 0;
  if (late < MARGINAL_SLIP_DAYS) {
    return { ...base, verdict: 'MARGINAL', rule: `Every rule is met, but the start can slip only ${late} days later (under ${MARGINAL_SLIP_DAYS} days).`, failed: [] };
  }
  return { ...base, verdict: 'GO', rule: `Every rule is met, and the start can slip ${sl.lateCensored ? 'at least ' : ''}${late} days later.`, failed: [] };
}

const EMPTY_SLIP: Slip = {
  viableAtChosen: false,
  lateDays: null,
  earlyDays: null,
  lateCensored: false,
  earlyCensored: false,
  nextWindow: null,
};

/** Verdicts for an array of landing start times (such as a row of the Window Finder), evaluated on one rolling series. */
export function verdictSeries(
  rolling: RollingSeries,
  p: Preset,
  firstStartMs: number,
  colStartsMs: ArrayLike<number>,
  viableStepMs = SLIP_STEP_MS,
): Verdict[] {
  const s = rolling.series;
  const stayMs = Math.round((p.stayDays * 86_400_000) / s.stepMs) * s.stepMs;
  const nCols = colStartsMs.length;
  if (nCols === 0) return [];
  if (!p.rules) {
    const out: Verdict[] = [];
    for (let c = 0; c < nCols; c++) {
      const a = colStartsMs[c];
      out.push(verdict(rolling.summary(a, a + stayMs), p, EMPTY_SLIP));
    }
    return out;
  }
  const seriesEndMs = s.t0Ms + s.n * s.stepMs;
  const maxViableStartMs = Math.floor((seriesEndMs - stayMs - firstStartMs) / viableStepMs) * viableStepMs + firstStartMs;
  let maxColMs = colStartsMs[0];
  for (let c = 1; c < nCols; c++) if (colStartsMs[c] > maxColMs) maxColMs = colStartsMs[c];
  if (maxColMs > maxViableStartMs) throw new RangeError('series is too short for this stay');
  const viableCount = Math.floor((maxViableStartMs - firstStartMs) / viableStepMs) + 1;
  const viable = viableFromRolling(rolling, p, firstStartMs, viableCount, viableStepMs);
  const out: Verdict[] = [];
  for (let c = 0; c < nCols; c++) {
    const a = colStartsMs[c];
    out.push(verdict(rolling.summary(a, a + stayMs), p, slip(viable, firstStartMs, a, viableStepMs)));
  }
  return out;
}
