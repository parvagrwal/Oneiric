// "What blocks it": the click on a dark or no-link span, and the words the card shows afterwards.
//
// The rule this file fixes: the ridge is read from the shipped skyline's recorded distance, at the body's azimuth
// at the middle of the span. A smooth-sphere result points at nothing and says so. The app computes no lookups of
// its own; the numbers here are the engine's, relabelled.
import { blockingTerrain, type BlockingTerrain, type LatLon, type Skyline } from '../../engine/index.ts';
import type { ScenarioResult, TrackPoint } from './scenario.ts';
import { formatUtc, formatUtcStamp } from './format.ts';
import { nearestTrackPoint } from './status.ts';

export type BlockedKind = 'sun' | 'earth';

export interface BlockedSpan {
  kind: BlockedKind;
  startMs: number;
  endMs: number;
  /** The point to quote as the middle of the span. */
  midMs: number;
  hours: number;
}

/** Dark spans (Sun) and below-horizon spans (Earth) inside the stay, read from the engine's own track. */
export function blockedSpans(result: ScenarioResult, kind: BlockedKind): BlockedSpan[] {
  const track = result.track;
  if (track.length === 0) return [];
  const blocked = (p: TrackPoint) => (kind === 'sun' ? p.sunF < 0.01 : !p.earthVis);
  const stepMs = track.length > 1 ? track[1].tMs - track[0].tMs : 3_600_000;
  const spans: BlockedSpan[] = [];
  let i = 0;
  while (i < track.length) {
    if (!blocked(track[i])) { i++; continue; }
    let j = i;
    while (j < track.length && blocked(track[j])) j++;
    const startMs = track[i].tMs;
    const endMs = j < track.length ? track[j].tMs : track[j - 1].tMs + stepMs;
    spans.push({ kind, startMs, endMs, midMs: Math.round((startMs + endMs) / 2), hours: (endMs - startMs) / 3_600_000 });
    i = j;
  }
  return spans;
}

export interface BlockedExplanation {
  kind: BlockedKind;
  span: BlockedSpan;
  /** Body azimuth and elevation at mid-span, from the engine's track. */
  bodyAzDeg: number;
  bodyElDeg: number;
  blocking: BlockingTerrain;
  /** One sentence a card prints. Names the distance when the skyline recorded one, and the absence when not. */
  sentence: string;
  /** The point to draw on the map, or null when the skyline records no terrain. */
  mapPoint: LatLon | null;
}

/** Build the explanation for a span. Pure: the caller supplies the skyline the card is using. */
export function explainBlocked(
  result: ScenarioResult,
  sky: Skyline,
  site: LatLon,
  kind: BlockedKind,
  span: BlockedSpan,
): BlockedExplanation {
  const mid: TrackPoint | undefined = nearestTrackPoint(result.track, span.midMs);
  const bodyAzDeg = kind === 'sun' ? mid?.sunAz ?? 0 : mid?.earthAz ?? 0;
  const bodyElDeg = kind === 'sun' ? mid?.sunEl ?? 0 : mid?.earthEl ?? 0;
  const blocking = blockingTerrain(site, sky, bodyAzDeg, bodyElDeg);
  const body = kind === 'sun' ? 'Sun' : 'Earth';
  const what = kind === 'sun' ? 'dark stretch' : 'closed-link stretch';
  const start = formatUtc(span.startMs);
  const end = formatUtc(span.endMs);
  let sentence: string;
  if (blocking.distanceKm === null) {
    sentence = `Across the ${what} from ${start} to ${end}, ${body} sits at ${bodyElDeg.toFixed(2)}° at azimuth ${bodyAzDeg.toFixed(1)}°, under a horizon of ${blocking.horizonDeg.toFixed(2)}°. ${sky.grade === 'D' ? 'This site runs the smooth sphere, so the skyline records no terrain and there is no ridge to name.' : 'This skyline records no blocking distance at that azimuth.'}`;
  } else {
    sentence = `Across the ${what} from ${start} to ${end}, ${body} sits at ${bodyElDeg.toFixed(2)}° at azimuth ${bodyAzDeg.toFixed(1)}°, while the terrain there rises to ${blocking.horizonDeg.toFixed(2)}° and stands ${blocking.distanceKm.toFixed(2)} km away (about ${Math.round((blocking.riseM ?? 0))} m above the site).`;
  }
  return { kind, span, bodyAzDeg, bodyElDeg, blocking, sentence, mapPoint: blocking.point };
}

/** Short line for the button that opens the explanation, for example "Sun 23.2 h · ridge 0.33 km". */
export function blockedSpanLabel(e: Pick<BlockedExplanation, 'kind' | 'span' | 'blocking'>): string {
  const body = e.kind === 'sun' ? 'Sun' : 'Earth';
  const hours = e.span.hours < 1 ? `${Math.round(e.span.hours * 60)} min` : `${e.span.hours.toFixed(1)} h`;
  const where = e.blocking.distanceKm === null ? 'no terrain recorded' : `terrain ${e.blocking.distanceKm.toFixed(2)} km`;
  return `${body} ${hours} · ${where}`;
}

/** Middle-of-span timestamp, for the drawer that lists every span. */
export const spanMidUtc = (span: BlockedSpan): string => formatUtcStamp(span.midMs);
