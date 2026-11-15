// Why does the engine's Earth direction differ from Horizons' apparent Earth direction
// by up to 0.00606 deg, while the Sun matches to 0.0002 deg?
//
// The direction check compares the engine against Horizons APPARENT azimuth/elevation,
// which includes stellar aberration. The engine's table is built from Horizons sub-points:
// the sub-solar point carries the apparent correction, the sub-Earth point is geometric.
// So the Sun matches apparent and the Earth differs by the aberration amount.
//
// This script verifies that account with a frame-free test: the Sun-Earth angle is
// invariant under rotation, so it can be compared between the engine table (MOON_ME,
// body-fixed) and Horizons GEOMETRIC vectors (mean equator/node frame) without knowing
// the rotation between the two frames. If the table were purely geometric, the angles
// would match; they differ by 0.007-0.008 deg, the aberration magnitude. Light-time for
// Earth's motion contributes only ~0.0002 deg (relative speed ~1 km/s over 1.3 s at
// ~391,000 km), so it cannot explain the difference.
//
// Run: npx tsx pipeline/earth-error-cause.ts
// Output: the per-epoch angle comparison, and the VECTORS responses saved under
// fixtures/horizons/vectors/ (reused on later runs).
import { fetchCached, parseTable } from './horizons.ts';
import { loadTable } from './direction-check.ts';
import { ephemAt } from '../engine/ephemeris.ts';

// TDB-UTC = 32.184 s (TT-TAI) + 37 leap seconds; valid 2017-01-01 until the next leap second.
const TDB_MINUS_UTC_MS = 69184;
const JD_UNIX_EPOCH = 2440587.5;

const VECTORS = {
  sun: {
    params: {
      COMMAND: '10', CENTER: '500@301', MAKE_EPHEM: 'YES', TABLE_TYPE: 'VECTORS',
      START_TIME: '2027-01-01', STOP_TIME: '2027-01-02', STEP_SIZE: '6 h',
      REF_PLANE: 'BODY', VEC_LABELS: 'YES', CSV_FORMAT: 'YES',
    },
    file: 'fixtures/horizons/vectors/sun-2027-01-01.txt',
  },
  earth: {
    params: {
      COMMAND: '399', CENTER: '500@301', MAKE_EPHEM: 'YES', TABLE_TYPE: 'VECTORS',
      START_TIME: '2027-01-01', STOP_TIME: '2027-01-02', STEP_SIZE: '6 h',
      REF_PLANE: 'BODY', VEC_LABELS: 'YES', CSV_FORMAT: 'YES',
    },
    file: 'fixtures/horizons/vectors/earth-2027-01-01.txt',
  },
} as const;

interface VectorRow { tMs: number; v: [number, number, number] }

function parseVectors(text: string): VectorRow[] {
  const t = parseTable(text);
  const rows: VectorRow[] = [];
  for (const row of t.rows) {
    const jd = +row[0];
    const tMs = (jd - JD_UNIX_EPOCH) * 86400000 - TDB_MINUS_UTC_MS;
    rows.push({ tMs, v: [+row[2], +row[3], +row[4]] });
  }
  return rows;
}

const angleDeg = (a: number[], b: number[]) => {
  const na = Math.hypot(a[0], a[1], a[2]);
  const nb = Math.hypot(b[0], b[1], b[2]);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
};

async function main() {
  const table = loadTable();
  const sun = parseVectors((await fetchCached(VECTORS.sun.params, VECTORS.sun.file)).text);
  const earth = parseVectors((await fetchCached(VECTORS.earth.params, VECTORS.earth.file)).text);
  if (sun.length !== earth.length) throw new Error(`sun rows ${sun.length} != earth rows ${earth.length}`);
  console.log('Sun-Earth angle: engine table vs Horizons geometric VECTORS');
  let max = 0;
  for (let i = 0; i < sun.length; i++) {
    const e = ephemAt(table, sun[i].tMs);
    const engineAngle = angleDeg(e.sun, e.earth);
    const geometricAngle = angleDeg(sun[i].v, earth[i].v);
    const diff = engineAngle - geometricAngle;
    max = Math.max(max, Math.abs(diff));
    console.log(
      `  ${new Date(sun[i].tMs).toISOString()} engine ${engineAngle.toFixed(5)} geometric ${geometricAngle.toFixed(5)} diff ${diff.toFixed(5)} deg`,
    );
  }
  console.log(`max |diff| ${max.toFixed(5)} deg (stellar aberration is ~0.0057 deg; light-time for Earth's motion ~0.0002 deg)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
