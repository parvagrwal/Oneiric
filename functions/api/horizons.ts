/**
 * Live Horizons check proxy, as a Cloudflare Pages Function.
 *
 * Cloudflare Pages serves every file under `functions/` at the matching route, so this file answers
 * `/api/horizons`. It exists because the JPL Horizons API sends no CORS header: a browser cannot call it
 * directly, and a proxy that forwards arbitrary parameters would turn this site into an open relay to JPL.
 *
 * What it will and will not do:
 *   - Accepts exactly four query parameters: `body` (10 or 399), `lon` and `lat` (numeric degrees), and `at`
 *     (an ISO 8601 UTC instant). Anything else is a 400.
 *   - Builds the Horizons query here, from those numbers, with a parameter set this file owns. No caller-supplied
 *     string reaches Horizons.
 *   - Returns one epoch for one body from one surface point.
 *   - Caches the upstream response for 24 hours at the edge, and sends a 24-hour `Cache-Control`, so repeated demo
 *     views of the same instant do not hit JPL more than once.
 *   - Never returns a number it did not receive: an upstream failure is a 502 with a message, and the app then
 *     shows its cached figure, labelled cached.
 *
 * The app never computes a verdict from this response. It shows the residual against its own cached table.
 */

interface Env {
  HORIZONS_ORIGIN?: string;
}

const UPSTREAM = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const ALLOWED_BODIES = new Set(['10', '399']);
const ALLOWED_PARAMS = new Set(['body', 'lon', 'lat', 'at']);
const CACHE_SECONDS = 86_400;
const MAX_COORD_DIGITS = 6;

interface HorizonsRow {
  azDeg: number;
  elDeg: number;
  /** The UTC instant Horizons reported for the row. */
  utc: string;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...headers },
  });

/**
 * Parse the single data row between $$SOE and $$EOE. Columns are date, solar/lunar presence flag, azimuth, elevation.
 * `lastIndexOf` for the start marker on purpose: Horizons echoes parameter values in its header, and an echoed
 * marker must not be mistaken for the start of the data block.
 */
export function parseHorizonsRow(text: string): HorizonsRow | null {
  const start = text.lastIndexOf('$$SOE');
  if (start < 0) return null;
  const end = text.indexOf('$$EOE', start + 5);
  if (end < 0 || end <= start) return null;
  // The start marker is five characters ($$SOE); the end marker four ($$EOE).
  const body = text.slice(start + 5, end).trim();
  if (!body) return null;
  const first = body.split('\n')[0].trim();
  const cols = first.split(',').map((c) => c.trim());
  // QUANTITIES='4' returns exactly: date, solar presence, lunar presence, azimuth, elevation — and a trailing
  // comma after the elevation, so the last field is empty. Read the fixed azimuth and elevation columns, never
  // the last two: the empty field parses as Number('') === 0, which reads as a real elevation of zero.
  if (cols.length < 5) return null;
  const azDeg = Number(cols[3]);
  const elDeg = Number(cols[4]);
  if (!Number.isFinite(azDeg) || !Number.isFinite(elDeg)) return null;
  return { azDeg, elDeg, utc: cols[0] };
}

function horizonsUtc(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 16).replace('T', ' ');
}

/** The upstream URL, built only from validated numbers. Exported for the test that pins the parameter set. */
export function buildUpstreamUrl(body: string, lonDeg: number, latDeg: number, atIso: string): string {
  if (!ALLOWED_BODIES.has(body)) throw new RangeError(`body must be one of ${[...ALLOWED_BODIES].join(', ')}`);
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) throw new RangeError('at must be an ISO 8601 instant');
  // Horizons takes a lunar surface observer as CENTER='coord@301' with SITE_COORD='E-lon,lat,km', one epoch.
  const params: Record<string, string> = {
    format: 'text',
    COMMAND: body,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `${lonDeg.toFixed(MAX_COORD_DIGITS)},${latDeg.toFixed(MAX_COORD_DIGITS)},0`,
    TLIST: horizonsUtc(atMs),
    QUANTITIES: '4',
    APPARENT: 'AIRLESS',
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    EXTRA_PREC: 'YES',
  };
  const parts = ['format=text'];
  for (const [k, v] of Object.entries(params)) {
    if (k === 'format') continue;
    parts.push(`${k}=${encodeURIComponent(`'${v}'`)}`);
  }
  return `${UPSTREAM}?${parts.join('&')}`;
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });

export const onRequestGet = async (context: { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void }): Promise<Response> => {
  const url = new URL(context.request.url);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return json({ error: `parameter not allowed: ${key}` }, 400);
  }
  const body = url.searchParams.get('body') ?? '10';
  const lonRaw = url.searchParams.get('lon');
  const latRaw = url.searchParams.get('lat');
  const at = url.searchParams.get('at');
  if (lonRaw === null || latRaw === null || at === null) return json({ error: 'lon, lat and at are required' }, 400);

  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lon) || lon < 0 || lon >= 360) return json({ error: 'lon must be an east-positive longitude 0..360' }, 400);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return json({ error: 'lat must be a latitude -90..90' }, 400);
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return json({ error: 'at must be an ISO 8601 instant' }, 400);

  let upstreamUrl: string;
  try {
    upstreamUrl = buildUpstreamUrl(body, lon, lat, at);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'bad request' }, 400);
  }

  let upstream: Response;
  try {
    // `cf` is a Cloudflare-specific field that the DOM RequestInit type does not know about.
    const init = {
      headers: { 'user-agent': 'Oneiric lunar site comparison (live check, one epoch)' },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    } as unknown as RequestInit;
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    return json({ error: `upstream unreachable: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    return json({ error: `upstream error ${upstream.status}`, detail: text.slice(0, 400) }, 502);
  }
  const row = parseHorizonsRow(text);
  if (!row) return json({ error: 'upstream reply held no data row', detail: text.slice(0, 400) }, 502);

  return json(
    {
      body,
      requestedUtc: new Date(atMs).toISOString(),
      reportedUtc: row.utc,
      azDeg: row.azDeg,
      elDeg: row.elDeg,
      source: 'JPL Horizons, CENTER=coord@301, APPARENT=AIRLESS, QUANTITIES=4, one epoch',
      upstream: upstreamUrl,
      cacheTtlS: CACHE_SECONDS,
      note: 'Live geometry for the instant asked for. The app shows the residual against its cached hourly table; no verdict is computed from this response.',
    },
    200,
    { 'cache-control': `public, max-age=${CACHE_SECONDS}` },
  );
};
