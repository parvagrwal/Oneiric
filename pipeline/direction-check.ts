// Compare the engine's Sun and Earth directions with JPL Horizons site queries.
// The metric is the angle between unit vectors, not azimuth and elevation separately.
import { readFileSync } from 'node:fs';
import { ephemAt, ROW, type EphemTable } from '../engine/ephemeris.ts';
import { directionFromSite, smoothSiteFrame } from '../engine/frame.ts';
import { DEG } from '../engine/constants.ts';
import { dot, cross, norm, type Vec3 } from '../engine/vec.ts';
import { column, parseHorizonsTime, parseTable } from './horizons.ts';
import { loadSites, siteFile, type SiteDef } from './fetch-fixtures.ts';

export function loadTable(dir = 'app/public/data/ephem', first = 2023, last = 2040): EphemTable {
  const years = new Map<number, Float32Array>();
  for (let y = first; y <= last; y++) {
    const b = readFileSync(`${dir}/${y}.bin`);
    const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    years.set(y, new Float32Array(copy));
    if (years.get(y)!.length % ROW !== 0) throw new Error(`${y}.bin has a partial row`);
  }
  return { years };
}

export interface Residual { site: string; body: 'sun' | 'earth'; tMs: number; deg: number }

/** Horizons az/el (degrees) as a unit vector in the local east-north-up frame. */
const enu = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
];

export function directionResiduals(table: EphemTable, sites: SiteDef[], tweak?: (s: SiteDef) => SiteDef, observerAtMoonCentre = false, fileFor: (id: string, body: 'sun' | 'earth') => string = siteFile): Residual[] {
  const out: Residual[] = [];
  for (const site of sites) {
    // `tweak` exists only so the sabotage test can move one element of the real state.
    const used = tweak ? tweak(site) : site;
    const site0 = smoothSiteFrame(used.lat, used.eLon, 0);
    // `observerAtMoonCentre` exists only so a test can show that the check notices the wrong observer position.
    const frame = observerAtMoonCentre ? { ...site0, r0: [0, 0, 0] as Vec3 } : site0;
    for (const body of ['sun', 'earth'] as const) {
      const t = parseTable(readFileSync(fileFor(site.id, body), 'utf8'));
      const cT = 0, cAz = column(t, 'Azimuth_(a-app)'), cEl = column(t, 'Elevation_(a-app)');
      for (const row of t.rows) {
        const tMs = parseHorizonsTime(row[cT]);
        const b = ephemAt(table, tMs);
        const d = directionFromSite(frame, body === 'sun' ? b.sun : b.earth);
        const mine: Vec3 = [dot(d, frame.east), dot(d, frame.north), dot(d, frame.up)];
        const ref = enu(+row[cAz], +row[cEl]);
        const deg = (Math.atan2(norm(cross(mine, ref)), dot(mine, ref)) * 180) / Math.PI;
        out.push({ site: site.id, body, tMs, deg });
      }
    }
  }
  return out;
}

export function summarize(r: Residual[]) {
  const n = r.length;
  let max = 0, sq = 0, argmax: Residual = r[0];
  for (const x of r) { if (x.deg > max) { max = x.deg; argmax = x; } sq += x.deg * x.deg; }
  return { n, maxDeg: max, rmsDeg: Math.sqrt(sq / n), worst: argmax };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = directionResiduals(loadTable(), loadSites());
  console.log('all', summarize(res));
  for (const body of ['sun', 'earth'] as const) console.log(body, summarize(res.filter((x) => x.body === body)));
  for (const s of loadSites()) {
    for (const body of ['sun', 'earth'] as const) {
      const m = summarize(res.filter((x) => x.site === s.id && x.body === body));
      console.log(s.id.padEnd(20), body.padEnd(6), 'n', m.n, 'max', m.maxDeg.toFixed(5), 'rms', m.rmsDeg.toFixed(5));
    }
  }
}
