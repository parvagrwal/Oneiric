// The Horizons check chip and the live-check state machine, as words and transitions a test can drive.
//
// Two rules are fixed here, and they are the reason this module exists rather than living in the component:
//   1. A cached result is always labelled cached, with its date. It never reads like a live number.
//   2. A live result is labelled live, with the time it was fetched and the residual. When the live request fails
//      the chip says so and falls back to the cached figure, labelled cached. A failure is never silent and never
//      dressed as a live answer.
import type { SiteDefinition } from './scenario.ts';

export interface CachedCheck {
  maxDeg: number;
  rmsDeg: number;
  n: number;
  cachedDate: string | null;
}

export type LiveCheckState =
  | { kind: 'idle' }
  | { kind: 'loading'; startedMs: number }
  | {
      kind: 'live';
      /** Horizons az/el for the body at the queried instant. */
      sunAzDeg: number;
      sunElDeg: number;
      /** Angular separation between the live answer and the app's own direction, degrees. */
      residualDeg: number;
      fetchedMs: number;
      /** The URL that produced it, so a reader can open it. */
      url: string;
      cacheTtlS: number;
    }
  | { kind: 'failed'; failedMs: number; message: string; url: string };

export interface ChipInput {
  site: SiteDefinition;
  cached: CachedCheck | null;
  live: LiveCheckState;
  /** True when the app has not finished reading its cached check file. */
  loadingFile: boolean;
}

/** The chip text. Always names its source: live, cached, or neither. */
export function horizonsChipText(input: ChipInput): string {
  const { site, cached, live, loadingFile } = input;
  if (site.isCustom) return 'Horizons check: not cached for custom coordinates';
  if (live.kind === 'loading') return 'Horizons check: live query in flight…';
  if (loadingFile && live.kind === 'idle') return 'Horizons check: loading…';
  const cachedWords = cached
    ? `cached ${cached.cachedDate ?? 'date unknown'} · max ${cached.maxDeg.toFixed(4)}° · ${cached.n.toLocaleString()} epochs`
    : 'not cached for this site';
  if (live.kind === 'live') {
    const at = new Date(live.fetchedMs).toISOString().replace('T', ' ').slice(0, 19);
    return `Horizons check: live ${at} UTC · residual ${live.residualDeg.toFixed(4)}° · ${cachedWords}`;
  }
  if (live.kind === 'failed') {
    return `Horizons check: live query failed (${live.message}); showing the cached figure · ${cachedWords}`;
  }
  return `Horizons check: ${cachedWords} · this site only`;
}

export interface LiveCheckRequest {
  site: SiteDefinition;
  /** UTC instant of the scrub position. */
  atMs: number;
}

/** The allow-list the proxy enforces, restated here so the client cannot build a request the proxy would refuse. */
export const LIVE_CHECK_LIMITS = {
  bodies: ['10', '399'] as const,
  center: 'coord@301',
  quantity: '4',
  /** One epoch only. */
  ephemType: 'OBSERVER',
  maxCoordinateDigits: 6,
};

const coord = (value: number, maxDigits: number): string => {
  if (!Number.isFinite(value)) throw new RangeError('coordinate is not a number');
  const s = value.toFixed(maxDigits);
  if (s.replace('-', '').replace('.', '').length > maxDigits + 3) throw new RangeError('coordinate is out of range');
  return s;
};

/**
 * The query the live check sends to this deployment's own proxy, never to JPL directly. Numeric coordinates only,
 * one epoch, one body, so a caller cannot use the app as an open relay.
 */
export function liveCheckUrl(site: SiteDefinition, atMs: number, base = ''): string {
  if (!Number.isFinite(atMs)) throw new RangeError('instant is not a number');
  if (site.isCustom) throw new RangeError('a custom coordinate has no cached or live check');
  const params = new URLSearchParams({
    body: '10',
    lon: coord(site.eLon, LIVE_CHECK_LIMITS.maxCoordinateDigits),
    lat: coord(site.lat, LIVE_CHECK_LIMITS.maxCoordinateDigits),
    at: new Date(atMs).toISOString(),
  });
  return `${base}/api/horizons?${params.toString()}`;
}

export interface LiveCheckDirection {
  azDeg: number;
  elDeg: number;
  cacheTtlS: number;
}

/**
 * The direction out of a proxy reply. The proxy returns the azimuth and elevation at the top level of its JSON,
 * next to the provenance fields — there is no `result` wrapper. Returns null when the reply holds no direction,
 * so the caller can say the proxy answered without one instead of showing a zero.
 */
export function parseLiveCheckResponse(json: unknown): LiveCheckDirection | null {
  if (typeof json !== 'object' || json === null) return null;
  const { azDeg, elDeg, cacheTtlS } = json as { azDeg?: unknown; elDeg?: unknown; cacheTtlS?: unknown };
  if (typeof azDeg !== 'number' || typeof elDeg !== 'number') return null;
  if (!Number.isFinite(azDeg) || !Number.isFinite(elDeg)) return null;
  return { azDeg, elDeg, cacheTtlS: typeof cacheTtlS === 'number' && Number.isFinite(cacheTtlS) ? cacheTtlS : 86_400 };
}

/** The allowed parameter names, for the test that holds the client and the proxy to the same list. */
export const LIVE_CHECK_PARAMS = ['body', 'lon', 'lat', 'at'] as const;

/** The residual between the live answer's az/el and the app's own, on the sphere of directions, degrees. */
export function residualDeg(live: { azDeg: number; elDeg: number }, mine: { azDeg: number; elDeg: number }): number {
  const toVec = (x: { azDeg: number; elDeg: number }) => {
    const el = (x.elDeg * Math.PI) / 180;
    const az = (x.azDeg * Math.PI) / 180;
    return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
  };
  const a = toVec(live);
  const b = toVec(mine);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return (Math.atan2(Math.hypot(cx, cy, cz), dot) * 180) / Math.PI;
}

/** Honest label for a failed proxy: says what broke, and that the cached number is the one now shown. */
export function liveFailureMessage(status: number | null, detail: string | null): string {
  if (status === null) return `network error${detail ? `: ${detail}` : ''}`;
  if (status === 429) return 'rate limited by the proxy';
  if (status === 400) return 'request refused by the proxy allow-list';
  if (status >= 500) return `proxy error ${status}`;
  return `HTTP ${status}${detail ? `: ${detail}` : ''}`;
}
