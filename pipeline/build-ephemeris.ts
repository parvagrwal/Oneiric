// Turn the raw Horizons yearly responses into compact binary tables, one file per year.
// Row layout (Float32): [ux, uy, uz, sunRangeKm, ex, ey, ez, earthRangeKm], one row per hour,
// first row Jan 1 00:00 UTC, last row the next Jan 1 00:00 UTC (so interpolation never crosses a file edge).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROW } from '../engine/ephemeris.ts';
import { column, parseHorizonsTime, parseTable } from './horizons.ts';
import { FIRST_YEAR, LAST_YEAR, globalFile } from './fetch-ephemeris.ts';

export const OUT_DIR = 'app/public/data/ephem';
const D2R = Math.PI / 180;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

const unitFromLonLat = (lonDeg: number, latDeg: number): [number, number, number] => [
  Math.cos(latDeg * D2R) * Math.cos(lonDeg * D2R),
  Math.cos(latDeg * D2R) * Math.sin(lonDeg * D2R),
  Math.sin(latDeg * D2R),
];

export function parseYear(year: number): Float32Array {
  const text = readFileSync(globalFile(year), 'utf8');
  const t = parseTable(text);
  if (!t.poleLine || !/MOON_ME/.test(t.poleLine) || !/East-longitude positive/.test(t.poleLine)) {
    throw new Error(`${year}: frame header is not MOON_ME east-positive: ${t.poleLine}`);
  }
  const c = {
    time: 0,
    oLon: column(t, 'ObsSub-LON'), oLat: column(t, 'ObsSub-LAT'),
    sLon: column(t, 'SunSub-LON'), sLat: column(t, 'SunSub-LAT'),
    r: column(t, 'r'), delta: column(t, 'delta'),
  };
  const start = Date.UTC(year, 0, 1);
  const hours = (Date.UTC(year + 1, 0, 1) - start) / 3_600_000;
  if (t.rows.length !== hours + 1) throw new Error(`${year}: expected ${hours + 1} rows, got ${t.rows.length}`);
  const out = new Float32Array(t.rows.length * ROW);
  let sunLonDrift = 0;
  let prevSunLon = NaN;
  t.rows.forEach((row, i) => {
    const tMs = parseHorizonsTime(row[c.time]);
    if (tMs !== start + i * 3_600_000) throw new Error(`${year}: row ${i} has time ${row[c.time]}, expected hourly steps`);
    const oLon = +row[c.oLon], oLat = +row[c.oLat], sLon = +row[c.sLon], sLat = +row[c.sLat];
    const rSun = +row[c.r], rEarth = +row[c.delta];
    for (const v of [oLon, oLat, sLon, sLat, rSun, rEarth]) if (!Number.isFinite(v)) throw new Error(`${year}: row ${i} has a non-numeric value`);
    // Sanity asserts (plan: sub-Earth lat within +-7, lon within +-8.2; sub-solar lat within +-1.6).
    if (Math.abs(oLat) > 7) throw new Error(`${year} row ${i}: sub-Earth latitude ${oLat} outside +-7`);
    if (Math.abs(wrap180(oLon)) > 8.2) throw new Error(`${year} row ${i}: sub-Earth longitude ${oLon} outside +-8.2`);
    if (Math.abs(sLat) > 1.6) throw new Error(`${year} row ${i}: sub-solar latitude ${sLat} outside +-1.6`);
    if (!(rSun > 1.4e8 && rSun < 1.55e8)) throw new Error(`${year} row ${i}: Sun range ${rSun} km is not in km`);
    if (!(rEarth > 3.5e5 && rEarth < 4.1e5)) throw new Error(`${year} row ${i}: Earth range ${rEarth} km is not in km`);
    // The Sun must move west (decreasing east longitude) as the Moon turns east.
    if (!Number.isNaN(prevSunLon)) sunLonDrift += wrap180(sLon - prevSunLon);
    prevSunLon = sLon;
    const u = unitFromLonLat(sLon, sLat);
    const e = unitFromLonLat(oLon, oLat);
    out.set([u[0], u[1], u[2], rSun, e[0], e[1], e[2], rEarth], i * ROW);
  });
  if (!(sunLonDrift < 0)) throw new Error(`${year}: sub-solar longitude does not decrease with time (convention check failed)`);
  return out;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0;
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    const data = parseYear(y);
    writeFileSync(`${OUT_DIR}/${y}.bin`, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    bytes += data.byteLength;
    console.log(`${y}: ${data.length / ROW} rows, ${data.byteLength} bytes`);
  }
  writeFileSync(`${OUT_DIR}/index.json`, JSON.stringify({
    firstYear: FIRST_YEAR, lastYear: LAST_YEAR, valuesPerRow: ROW, type: 'float32-le',
    layout: ['sunUx', 'sunUy', 'sunUz', 'sunRangeKm', 'earthUx', 'earthUy', 'earthUz', 'earthRangeKm'],
    frame: 'MOON_ME (DE441), east-positive longitude, origin at the Moon centre',
    source: 'JPL Horizons, target 301 from 500@399, quantities 14, 15, 19, 20, hourly UTC',
    rowsNote: 'each file runs from Jan 1 00:00 UTC to the next Jan 1 00:00 UTC inclusive',
  }, null, 2) + '\n');
  console.log(`total ${bytes} bytes`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
