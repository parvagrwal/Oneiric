// Hook number for the README and the submission page: the Sun's elevation and azimuth at the IM-2 Athena
// landing site at the recorded landing time (2025-03-06T17:28:00Z), from the same cached hourly table and
// shipped 2 m skyline the app uses. Not a prediction; a replay of a recorded instant.
import { readFileSync } from 'node:fs';
import { ephemAt } from '../engine/index.ts';
import { azElOfDirection, directionFromSite, siteFrame, smoothSiteFrame } from '../engine/frame.ts';
import { sunFraction } from '../engine/sunlight.ts';
import { makeSkyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { loadTable } from './direction-check.ts';

const T = Date.parse('2025-03-06T17:28:00Z');
const SITE_LAT = -84.7906;
const SITE_ELON = 29.1957;
const SITE_ELEVATION_M = 5321.905530307851; // as recorded in app/public/data/skylines/index.json for im-2-athena-2m.bin
const HEIGHT_M = 2;

const table = loadTable();
const bodies = ephemAt(table, T);

const buf = readFileSync('app/public/data/skylines/im-2-athena-2m.bin');
const { H, D } = decodeSkyline(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const skyline = makeSkyline({ H, D, grade: 'B', terrain: 'LOLA 20 m + LOLA 80 m + LOLA 240 m', heightM: HEIGHT_M });

const frame = siteFrame(SITE_LAT, SITE_ELON, 1_737_400 + SITE_ELEVATION_M + HEIGHT_M);
const sun = azElOfDirection(frame, directionFromSite(frame, bodies.sun));
const fraction = sunFraction(frame, bodies.sun, bodies.earth, skyline);

const smoothFrame = smoothSiteFrame(SITE_LAT, SITE_ELON, 0);
const smoothSun = azElOfDirection(smoothFrame, directionFromSite(smoothFrame, bodies.sun));

console.log('Instant: 2025-03-06T17:28:00Z');
console.log(`Site: IM-2 Athena, lat ${SITE_LAT}, eLon ${SITE_ELON}, ${HEIGHT_M} m above site datum (grade B, shipped skyline)`);
console.log(`Sun az/el (2 m above terrain): az ${sun.az.toFixed(4)} deg, el ${sun.el.toFixed(4)} deg`);
console.log(`Sun disc fraction lit above the shipped skyline: ${fraction.f.toFixed(4)} (Earth cover ${fraction.cover.toFixed(4)})`);
console.log(`Sun az/el (smooth sphere reference): az ${smoothSun.az.toFixed(4)} deg, el ${smoothSun.el.toFixed(4)} deg`);
