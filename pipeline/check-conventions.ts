// Check the longitude and azimuth conventions of Horizons site queries, with a site at 0, 0.
// Sunrise should show the Sun near azimuth 90 (north through east) and sunset near 270.
import { fetchCached, parseTable, column, parseHorizonsTime } from './horizons.ts';
import { loadTable } from './direction-check.ts';
import { azEl, ephemAt, smoothSiteFrame } from '../engine/index.ts';

async function main() {
  const r = await fetchCached({
    COMMAND: '10', OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER', CENTER: 'coord@301', COORD_TYPE: 'GEODETIC',
    SITE_COORD: '0,0,0', START_TIME: '2027-01-10', STOP_TIME: '2027-02-12', STEP_SIZE: '30 m', QUANTITIES: '4',
    APPARENT: 'AIRLESS', ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES', EXTRA_PREC: 'YES',
  }, 'fixtures/horizons/conventions/equator-lon-0-sun-halfhourly.txt');
  const t = parseTable(r.text);
  const cAz = column(t, 'Azimuth_(a-app)'), cEl = column(t, 'Elevation_(a-app)');
  const table = loadTable();
  const frame = smoothSiteFrame(0, 0, 0);
  console.log('Site 0 N, 0 E. Horizons header says:', r.text.split('\n').find((l) => l.startsWith('Center pole/equ'))?.trim());
  let found = 0;
  for (let i = 1; i < t.rows.length && found < 4; i++) {
    const e0 = +t.rows[i - 1][cEl], e1 = +t.rows[i][cEl];
    if ((e0 < 0) !== (e1 < 0)) {
      const kind = e1 > e0 ? 'sunrise' : 'sunset ';
      const tMs = parseHorizonsTime(t.rows[i][0]);
      const mine = azEl(frame, ephemAt(table, tMs).sun);
      console.log(`${kind} ${t.rows[i][0]} UTC  Horizons az ${(+t.rows[i][cAz]).toFixed(3)} el ${e1.toFixed(3)}   engine az ${mine.az.toFixed(3)} el ${mine.el.toFixed(3)}`);
      found++;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
