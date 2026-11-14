// Run the checks and write validation.json. The app only renders that file; it never decides a pass.
import { writeFileSync, mkdirSync } from 'node:fs';
import { directionResiduals, loadTable, summarize } from './direction-check.ts';
import { engineVersion } from './engine-version.ts';
import { loadSites, siteFile } from './fetch-fixtures.ts';

export const VALIDATION_FILE = 'app/public/data/validation.json';
export const DIRECTION_THRESHOLD_DEG = 0.02;

export interface ValidationRow {
  id: string;
  name: string;
  n: number;
  maxDeg: number;
  rmsDeg: number;
  thresholdDeg: number;
  pass: boolean;
  fixtureFiles: string[];
  runAtUtc: string;
  engineCommit: string;
  detail: unknown;
  notes: string[];
}

export function runDirectionCheck(): ValidationRow {
  const sites = loadSites();
  const res = directionResiduals(loadTable(), sites);
  const all = summarize(res);
  const per = sites.flatMap((s) => (['sun', 'earth'] as const).map((body) => {
    const m = summarize(res.filter((x) => x.site === s.id && x.body === body));
    return { site: s.id, body, n: m.n, maxDeg: m.maxDeg, rmsDeg: m.rmsDeg };
  }));
  const sun = summarize(res.filter((x) => x.body === 'sun'));
  const earth = summarize(res.filter((x) => x.body === 'earth'));
  return {
    id: 'sun-earth-direction',
    name: 'Sun and Earth direction check against JPL Horizons',
    n: all.n,
    maxDeg: all.maxDeg,
    rmsDeg: all.rmsDeg,
    thresholdDeg: DIRECTION_THRESHOLD_DEG,
    pass: all.maxDeg <= DIRECTION_THRESHOLD_DEG,
    fixtureFiles: [
      ...sites.flatMap((s) => [siteFile(s.id, 'sun'), siteFile(s.id, 'earth')]),
      'fixtures/horizons/global/moon-<year>.txt, 2023 to 2040',
    ],
    runAtUtc: new Date().toISOString(),
    engineCommit: engineVersion(),
    detail: {
      sun: { n: sun.n, maxDeg: sun.maxDeg, rmsDeg: sun.rmsDeg },
      earth: { n: earth.n, maxDeg: earth.maxDeg, rmsDeg: earth.rmsDeg },
      perSite: per,
      worst: { site: all.worst.site, body: all.worst.body, utc: new Date(all.worst.tMs).toISOString(), deg: all.worst.deg },
      epochs: 'about 500 per site and body, every 18937 minutes from 2023-01-01 00:07 UTC, so most fall between hourly table rows',
    },
    notes: [
      'Angle is measured between unit vectors in the local frame, not as separate azimuth and elevation differences.',
      'Measured: the Earth direction carries almost all of the residual (up to about 0.006 degrees); the Sun direction differs by under 0.0003 degrees.',
      'Likely cause of the Earth residual, not yet verified: Horizons site queries use apparent (airless) positions, which include stellar aberration of up to about 0.006 degrees, and the hourly table does not.',
    ],
  };
}

function main() {
  const rows = [runDirectionCheck()];
  mkdirSync('app/public/data', { recursive: true });
  writeFileSync(VALIDATION_FILE, JSON.stringify({ generatedBy: 'pipeline/validate.ts', rows }, null, 2) + '\n');
  for (const r of rows) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
    console.log(`  n = ${r.n}, max = ${r.maxDeg.toFixed(5)} deg, rms = ${r.rmsDeg.toFixed(5)} deg, threshold = ${r.thresholdDeg} deg`);
  }
  console.log(`wrote ${VALIDATION_FILE}`);
  if (rows.some((r) => !r.pass)) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
