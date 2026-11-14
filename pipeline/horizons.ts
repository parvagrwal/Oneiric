// Sequential, cached access to the JPL Horizons API.
// Rules: one request at a time, a 1-second pause between requests,
// every raw response saved to disk and reused on later runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const PAUSE_MS = 1000;
let lastRequestAt = 0;

export type Params = Record<string, string>;

/** Build the request URL. Values are single-quoted as Horizons expects, then URL-encoded. */
export function horizonsUrl(params: Params): string {
  const parts = ['format=text'];
  for (const [k, v] of Object.entries(params)) {
    parts.push(`${k}=${encodeURIComponent(`'${v}'`)}`);
  }
  return `${API}?${parts.join('&')}`;
}

export interface Fetched {
  url: string;
  text: string;
  fromCache: boolean;
  file: string;
}

/** Fetch one Horizons response, or read it from `file` if it was saved before. */
export async function fetchCached(params: Params, file: string): Promise<Fetched> {
  const url = horizonsUrl(params);
  if (existsSync(file)) {
    return { url, text: readFileSync(file, 'utf8'), fromCache: true, file };
  }
  const wait = lastRequestAt + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let text = '';
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      lastRequestAt = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
      if (!text.includes('$$SOE')) throw new Error(`no ephemeris rows in response: ${text.slice(0, 300)}`);
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (lastError) throw new Error(`Horizons request failed after retries: ${String(lastError)}\n${url}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  writeFileSync(file.replace(/\.txt$/, '.url.txt'), url + '\n');
  return { url, text, fromCache: false, file };
}

export interface Table {
  header: string[];
  rows: string[][];
  poleLine: string | undefined;
}

/** Parse the rows between $$SOE and $$EOE, using the CSV header line that sits just before them. */
export function parseTable(text: string): Table {
  const lines = text.split('\n');
  const soe = lines.findIndex((l) => l.startsWith('$$SOE'));
  const eoe = lines.findIndex((l) => l.startsWith('$$EOE'));
  if (soe < 0 || eoe < 0 || eoe < soe) throw new Error('response has no $$SOE/$$EOE block');
  // The header is the nearest line before $$SOE that contains a comma and is not a star rule.
  let h = soe - 1;
  while (h >= 0 && (lines[h].startsWith('*') || lines[h].trim() === '')) h--;
  if (h < 0) throw new Error('response has no header line above $$SOE');
  const header = lines[h].split(',').map((s) => s.trim());
  const rows = lines.slice(soe + 1, eoe).filter((l) => l.trim() !== '').map((l) => l.split(',').map((s) => s.trim()));
  const poleLine = lines.find((l) => l.startsWith('Target pole/equ'));
  return { header, rows, poleLine };
}

export function column(t: Table, name: string): number {
  const i = t.header.findIndex((h) => h === name);
  if (i < 0) throw new Error(`column ${name} not in header: ${t.header.join('|')}`);
  return i;
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Parse "2027-Jan-01 00:00" (UT) to milliseconds since 1970-01-01T00:00Z. */
export function parseHorizonsTime(s: string): number {
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(s.trim());
  if (!m) throw new Error(`cannot parse Horizons time: ${s}`);
  return Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0);
}


