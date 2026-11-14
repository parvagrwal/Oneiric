// Fetch the hourly Moon-fixed table from JPL Horizons, one request per year, 2023 to 2040.
// Moon seen from the geocentre: sub-Earth point, sub-solar point, Sun range, Earth range.
// Raw responses are saved under fixtures/horizons/global/ and reused if present.
import { fetchCached } from './horizons.ts';

export const FIRST_YEAR = 2023;
export const LAST_YEAR = 2040;
export const globalFile = (year: number) => `fixtures/horizons/global/moon-${year}.txt`;

async function main() {
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const r = await fetchCached(
      {
        COMMAND: '301', OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER', CENTER: '500@399',
        START_TIME: `${year}-01-01`, STOP_TIME: `${year + 1}-01-01`, STEP_SIZE: '1 h',
        QUANTITIES: '14,15,19,20', ANG_FORMAT: 'DEG', RANGE_UNITS: 'KM', CSV_FORMAT: 'YES', EXTRA_PREC: 'YES',
      },
      globalFile(year),
    );
    console.log(`${year}: ${r.fromCache ? 'cached' : 'fetched'} ${r.text.length} bytes -> ${r.file}`);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
