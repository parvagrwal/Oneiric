// Fetch the per-site cached Horizons check: shape B (Sun and Earth az/el as seen from a surface
// point) at 24 epochs for every library site that does not already have a cached site query.
// The three library sites with a 500-epoch query from the direction check keep that richer data
// and are skipped here. Epochs are spread evenly across the 2023-2040 table with an odd step, so
// they fall between the hourly table nodes and the check also tests interpolation.
// Raw responses go to fixtures/horizons/cached-checks/ and are reused on later runs.
import { readFileSync } from 'node:fs';
import { fetchCached } from './horizons.ts';
import { loadSites as loadCheckSites } from './fetch-fixtures.ts';

export const CHECK_EPOCHS = 24;
export const checkFile = (id: string, body: 'sun' | 'earth') => `fixtures/horizons/cached-checks/${id}-${body}.txt`;

/** 24 epochs from 2023-01-01 00:07 to 2040-12-31: 23 steps of 411,589 minutes (285.8 days). */
export const CHECK_STEP_MIN = 411_589;

interface LibrarySite { id: string; name: string; lat: number; eLon: number }

export function checkParams(s: LibrarySite, body: 'sun' | 'earth') {
  return {
    COMMAND: body === 'sun' ? '10' : '399', OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301', COORD_TYPE: 'GEODETIC', SITE_COORD: `${s.eLon},${s.lat},0`,
    START_TIME: '2023-01-01 00:07', STOP_TIME: '2040-12-31', STEP_SIZE: `${CHECK_STEP_MIN} m`,
    QUANTITIES: '4', APPARENT: 'AIRLESS', ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES', EXTRA_PREC: 'YES',
  };
}

/** Count the ephemeris rows in a cached Horizons response (between $$SOE and $$EOE). */
export function countRows(text: string): number {
  const start = text.indexOf('$$SOE');
  const end = text.indexOf('$$EOE');
  if (start < 0 || end < 0 || end <= start) return -1;
  return text.slice(start + 5, end).split('\n').filter((line) => line.trim().length > 0).length;
}

async function main() {
  const library = (JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')) as { sites: LibrarySite[] }).sites;
  const rich = new Set(loadCheckSites().map((s) => s.id));
  const todo = library.filter((s) => !rich.has(s.id));
  console.log(`${library.length} library sites, ${library.length - todo.length} already have a 500-epoch query, fetching ${todo.length} sites x 2 bodies at ${CHECK_EPOCHS} epochs`);
  for (const s of todo) {
    for (const body of ['sun', 'earth'] as const) {
      const r = await fetchCached(checkParams(s, body), checkFile(s.id, body));
      const n = countRows(r.text);
      if (n !== CHECK_EPOCHS) throw new Error(`${s.id} ${body}: expected ${CHECK_EPOCHS} epochs, got ${n} in ${r.file}`);
      console.log(`${s.id} ${body}: ${r.fromCache ? 'cached' : 'fetched'} (${n} epochs) -> ${r.file}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
