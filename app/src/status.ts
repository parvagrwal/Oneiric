// Plain-words status for one scenario: what the Sun and Earth are doing, read in one second.
// Every word here is a relabelling of figures the engine already computed; nothing is recalculated.
import { DARK_BELOW, MIN_MS } from '../../engine/index.ts';
import type { ScenarioResult, TrackPoint } from './scenario.ts';

export type StatusKey = 'sun' | 'power' | 'earth' | 'link';

export interface StatusItem {
  key: StatusKey;
  label: string;
  value: string;
  /** 'now' reads the scrubbed instant; 'stay' summarises the whole stay. */
  scope: 'now' | 'stay';
  /** false when the item is in its "off" state (dark, hidden, closed). The word carries the meaning, not the colour. */
  on: boolean;
  detail: string;
}

export function nearestTrackPoint(track: TrackPoint[], targetMs: number): TrackPoint | undefined {
  let nearest: TrackPoint | undefined;
  for (const point of track) {
    if (!nearest || Math.abs(point.tMs - targetMs) < Math.abs(nearest.tMs - targetMs)) nearest = point;
  }
  return nearest;
}

/** The engine's track point nearest the scrubbed instant. */
export function instantAt(result: ScenarioResult, scrubMinutes: number): TrackPoint | undefined {
  return nearestTrackPoint(result.track, result.startMs + scrubMinutes * MIN_MS);
}

/** A percentage as a short word that never rounds a partial figure up to 100% or down to 0%. */
export function percentWord(value: number): string {
  if (value >= 99.95) return '100%';
  if (value <= 0.05) return '0%';
  if (value > 99 || value < 1) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

export function sunWord(sunF: number): 'lit' | 'partly lit' | 'dark' {
  if (sunF < DARK_BELOW) return 'dark';
  return sunF >= 1 - 1e-9 ? 'lit' : 'partly lit';
}

export function statusLine(result: ScenarioResult, scrubMinutes: number): StatusItem[] {
  const now = instantAt(result, scrubMinutes);
  const m = result.metrics;
  const sunF = now?.sunF ?? result.sample.sunF;
  const earthVis = now?.earthVis ?? result.sample.earthVis;
  const sun = sunWord(sunF);
  const linkValue = m.earthVisiblePct >= 99.95 ? 'open' : m.earthVisiblePct <= 0.05 ? 'closed' : percentWord(m.earthVisiblePct);
  return [
    {
      key: 'sun',
      label: 'Sun',
      value: sun,
      scope: 'now',
      on: sun !== 'dark',
      detail: `At the scrubbed instant, ${(sunF * 100).toFixed(0)}% of the solar disc is above the horizon.`,
    },
    {
      key: 'power',
      label: 'Power',
      value: percentWord(m.sunlitPct),
      scope: 'stay',
      on: m.sunlitPct > 0.05,
      detail: `Sunlit share of the stay (time-average of the visible solar disc): ${m.sunlitPct.toFixed(1)}%.`,
    },
    {
      key: 'earth',
      label: 'Earth',
      value: earthVis ? 'visible' : 'hidden',
      scope: 'now',
      on: earthVis,
      detail: `At the scrubbed instant, Earth's centre is ${earthVis ? 'at or above' : 'below'} the horizon plus the margin.`,
    },
    {
      key: 'link',
      label: 'Link',
      value: linkValue,
      scope: 'stay',
      on: m.earthVisiblePct > 0.05,
      detail: `Earth is visible for ${m.earthVisiblePct.toFixed(1)}% of the stay; longest gap ${m.longestLinkGapH.toFixed(1)} h.`,
    },
  ];
}

/** "Sun: lit, Power: 82%, Earth: visible, Link: open" */
export function statusSentence(items: StatusItem[]): string {
  return items.map((item) => `${item.label}: ${item.value}`).join(', ');
}
