// The rule this file defends, end to end: a height that has files works the moment the files and the index exist,
// and a height that has none is reported as grade D rather than served another height's horizon.
//
// The test writes its own skylines into a temporary directory, in the shipped layout, and drives the same loader
// and scenario code the browser uses. Nothing in the app is aware of which heights exist, so this test is also
// the proof that adding a height needs no code change: only files and one index row.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { encodeSkyline, makeSkyline, SKYLINE_BYTES, smoothHorizonDeg, type Grade } from '../engine/index.ts';
import { heightOptions } from '../engine/heights.ts';
import { readSkylineIndex, missingSkylineFiles } from '../pipeline/skyline-index.ts';
import { SKYLINE_DIR, skylineFileName } from '../pipeline/skyline-files.ts';
import { loadTable } from '../pipeline/direction-check.ts';
import { calculateScenario, type TerrainPayload } from '../app/src/scenario.ts';

const SITE = { id: 'connecting-ridge', name: 'Connecting Ridge', label: 'Connecting Ridge reference point', lat: -89.45, eLon: 222.69, source: 'test', sourceUrl: 'test' };
const START_MS = Date.parse('2027-03-01T00:00:00Z');
const SHIFT_DEG = 0.5;

/** Copy the shipped 2 m skyline into the temp directory at `heightM`, raised by SHIFT_DEG so a reader can tell
 *  which file supplied the horizon. This is test furniture, not a LOLA product: it proves the plumbing only. */
function addHeight(dir: string, heightM: number, grade: Grade, shiftDeg: number) {
  const siteId = SITE.id;
  const src = readFileSync(`${SKYLINE_DIR}/${skylineFileName(siteId, 2)}`);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const H = new Float32Array(1440);
  const D = new Uint16Array(1440);
  for (let i = 0; i < 1440; i++) {
    H[i] = view.getFloat32(i * 4, true) + shiftDeg;
    D[i] = view.getUint16(1440 * 4 + i * 2, true);
  }
  const bytes = Buffer.from(encodeSkyline(H, D));
  expect(bytes.byteLength).toBe(SKYLINE_BYTES);
  const file = skylineFileName(siteId, heightM);
  writeFileSync(`${dir}/${file}`, bytes);
  writeFileSync(`${dir}/${file.replace(/\.bin$/, '.json')}`, JSON.stringify({ siteId, heightM, grade, terrain: 'test terrain', file }));
  return { siteId, heightM, grade, terrain: 'test terrain', siteElevationM: 100, file };
}

const payloadFrom = (dir: string, entry: { siteId: string; heightM: number; grade: Grade; terrain: string; siteElevationM: number; file: string }): TerrainPayload => {
  const b = readFileSync(`${dir}/${entry.file}`);
  return {
    buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    grade: entry.grade,
    terrain: entry.terrain,
    siteElevationM: entry.siteElevationM,
    heightM: entry.heightM,
  };
};

describe('adding a height needs files and one index row, not a code change', () => {
  const dir = mkdtempSync(`${tmpdir()}/oneiric-heights-`);
  const entries = [
    addHeight(dir, 2, 'B', 0),
    addHeight(dir, 10, 'B', SHIFT_DEG),
  ];
  writeFileSync(`${dir}/index.json`, JSON.stringify({ generatedBy: 'test', skylines: entries }));

  const index = readSkylineIndex(dir)!;
  const table = loadTable();

  it('lists 2 m and 10 m as available and 0 m and 20 m as not, purely from the index', () => {
    expect(heightOptions(index.skylines).filter((o) => o.available).map((o) => o.heightM)).toEqual([2, 10]);
    expect(missingSkylineFiles(index, dir)).toEqual([]);
  });

  it('computes terrain at 10 m from the 10 m file, and the horizon moves by exactly the file difference', () => {
    const at2 = calculateScenario(table, SITE, START_MS, 'sortie', 2, payloadFrom(dir, entries[0]));
    const at10 = calculateScenario(table, SITE, START_MS, 'sortie', 10, payloadFrom(dir, entries[1]));
    expect(at2.verdict.grade).toBe('B');
    expect(at10.verdict.grade).toBe('B');
    const a = at2.skyline.map((p) => p.elevation);
    const b = at10.skyline.map((p) => p.elevation);
    for (let i = 0; i < a.length; i++) expect(b[i] - a[i]).toBeCloseTo(SHIFT_DEG, 4);
  });

  it('runs the smooth sphere at grade D at a height with no file, rather than borrowing the 10 m horizon', () => {
    // This is what the app passes for a missing height: no terrain payload.
    const at20 = calculateScenario(table, SITE, START_MS, 'sortie', 20, null);
    expect(at20.verdict.grade).toBe('D');
    expect(at20.verdict.terrain).toBe('none (smooth sphere)');
    for (const point of at20.skyline) expect(point.elevation).toBeCloseTo(smoothHorizonDeg(20), 5);
  });

  it('refuses a payload built for a different height instead of using it silently', () => {
    expect(() => calculateScenario(table, SITE, START_MS, 'sortie', 20, payloadFrom(dir, entries[1]))).toThrow(/built for 10 m/);
  });

  it('refuses a 10 m "terrain" file whose horizon is just the smooth-sphere dip, instead of grading it B', () => {
    const flat = new Float32Array(1440).fill(Math.fround(smoothHorizonDeg(10)));
    expect(() => makeSkyline({ H: flat, D: new Uint16Array(1440), grade: 'B', terrain: 'test terrain', heightM: 10 }))
      .toThrow(/smooth-sphere data cannot carry a terrain grade/);
  });
});
