// Fetch Sun and Earth directions as seen from eight lunar surface points (Horizons "shape B"),
// about 500 epochs each. The odd 18937-minute step puts the epochs between the hourly table nodes,
// so the check also tests interpolation. Raw responses go to fixtures/horizons/sites/.
import { readFileSync } from 'node:fs';
import { fetchCached } from './horizons.ts';

export interface SiteDef { id: string; label: string; lat: number; eLon: number; source: string }
export const loadSites = (): SiteDef[] =>
  JSON.parse(readFileSync('fixtures/direction-check-sites.json', 'utf8')).sites;
export const siteFile = (id: string, body: 'sun' | 'earth') => `fixtures/horizons/sites/${id}-${body}.txt`;

export function siteParams(s: SiteDef, body: 'sun' | 'earth') {
  return {
    COMMAND: body === 'sun' ? '10' : '399', OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301', COORD_TYPE: 'GEODETIC', SITE_COORD: `${s.eLon},${s.lat},0`,
    START_TIME: '2023-01-01 00:07', STOP_TIME: '2040-12-31', STEP_SIZE: '18937 m',
    QUANTITIES: '4', APPARENT: 'AIRLESS', ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES', EXTRA_PREC: 'YES',
  };
}

async function main() {
  for (const s of loadSites()) {
    for (const body of ['sun', 'earth'] as const) {
      const r = await fetchCached(siteParams(s, body), siteFile(s.id, body));
      console.log(`${s.id} ${body}: ${r.fromCache ? 'cached' : 'fetched'} -> ${r.file}`);
    }
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
