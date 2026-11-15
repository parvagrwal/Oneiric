// Per-site cached Horizons check: for every library site, recompute the residual against the hourly
// table and write app/public/data/horizons-check.json. The app renders that file; it never recomputes
// the residual. Three sites have a 500-epoch cached site query (the same files the direction check
// uses); the other thirty have a 24-epoch query fetched by pipeline/fetch-cached-checks.ts, spread
// evenly across 2023-2040 with an odd step so the epochs fall between the hourly table nodes.
// Sites without any cached query are listed as not checked and get no number.
import { readFileSync, writeFileSync } from 'node:fs';
import { directionResiduals, loadTable, summarize } from './direction-check.ts';
import { loadSites as loadCheckSites, siteFile, type SiteDef } from './fetch-fixtures.ts';
import { checkFile } from './fetch-cached-checks.ts';

export const HORIZONS_CHECK_FILE = 'app/public/data/horizons-check.json';

export interface HorizonsCheckEntry {
  id: string;
  name: string;
  n: number;
  maxDeg: number;
  rmsDeg: number;
  perBody: { sun: { n: number; maxDeg: number; rmsDeg: number }; earth: { n: number; maxDeg: number; rmsDeg: number } };
  /** Date the cached response was generated, read from the response header (null if not parseable). */
  cachedDate: string | null;
  fixtureFiles: string[];
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Read the generation date from a cached Horizons response header, e.g. "Ephemeris / API_USER Sat Nov 14 10:57:06 2026 Pasadena, USA". */
export function cachedResponseDate(text: string): string | null {
  const m = /Ephemeris\s*\/\s*API_USER\s+\w+\s+(\w{3})\s+(\d{1,2})\s+\d{2}:\d{2}:\d{2}\s+(\d{4})/.exec(text);
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`;
}

interface LibrarySite { id: string; name: string; lat: number; eLon: number; source: string }

function main() {
  const library = (JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')) as { sites: LibrarySite[] }).sites;
  const libraryById = new Map(library.map((s) => [s.id, s]));
  const richIds = new Set(loadCheckSites().map((s) => s.id));
  const richSites = loadCheckSites().filter((s) => libraryById.has(s.id));
  const lightSites: SiteDef[] = library
    .filter((s) => !richIds.has(s.id))
    .map((s) => ({ id: s.id, label: s.name, lat: s.lat, eLon: s.eLon, source: s.source }));
  const covered = new Set([...richSites.map((s) => s.id), ...lightSites.map((s) => s.id)]);
  const notChecked = library.map((s) => s.id).filter((id) => !covered.has(id));

  const table = loadTable();
  const residuals = [
    ...(richSites.length > 0 ? directionResiduals(table, richSites) : []),
    ...(lightSites.length > 0 ? directionResiduals(table, lightSites, undefined, false, checkFile) : []),
  ];
  const sites: HorizonsCheckEntry[] = [];
  for (const s of [...richSites, ...lightSites]) {
    const own = residuals.filter((r) => r.site === s.id);
    const sun = summarize(own.filter((r) => r.body === 'sun'));
    const earth = summarize(own.filter((r) => r.body === 'earth'));
    const all = summarize(own);
    const files = richIds.has(s.id) ? [siteFile(s.id, 'sun'), siteFile(s.id, 'earth')] : [checkFile(s.id, 'sun'), checkFile(s.id, 'earth')];
    const dates = files
      .map((f) => cachedResponseDate(readFileSync(f, 'utf8')))
      .filter((d): d is string => d !== null)
      .sort();
    sites.push({
      id: s.id,
      name: libraryById.get(s.id)!.name,
      n: all.n,
      maxDeg: all.maxDeg,
      rmsDeg: all.rmsDeg,
      perBody: {
        sun: { n: sun.n, maxDeg: sun.maxDeg, rmsDeg: sun.rmsDeg },
        earth: { n: earth.n, maxDeg: earth.maxDeg, rmsDeg: earth.rmsDeg },
      },
      cachedDate: dates.length ? dates[0] : null,
      fixtureFiles: files,
    });
  }

  const payload = {
    generatedBy: 'pipeline/cached-check.ts',
    runAtUtc: new Date().toISOString(),
    note: 'Cached JPL Horizons site queries compared with the hourly table. Three sites use a 500-epoch query (the direction-check fixtures); the rest use a 24-epoch query spread across 2023-2040 (pipeline/fetch-cached-checks.ts). Sites without a cached query are listed in notChecked; no number is shown for them. Each card shows the maximum residual for its own site only.',
    sites,
    notChecked,
  };
  writeFileSync(HORIZONS_CHECK_FILE, JSON.stringify(payload, null, 2) + '\n');
  for (const s of sites) {
    console.log(`${s.id}: n = ${s.n}, max = ${s.maxDeg.toFixed(5)} deg, rms = ${s.rmsDeg.toFixed(5)} deg, cached ${s.cachedDate ?? 'unknown date'}`);
  }
  console.log(`not checked (${notChecked.length}): ${notChecked.join(', ')}`);
  console.log(`wrote ${HORIZONS_CHECK_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
