// What these tests defend against: an index that quietly turns a shipped skyline into a missing one, or promises
// terrain the app does not have. A malformed index must stop the loader loudly, not degrade to an empty list that
// looks exactly like "no terrain built yet".
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { indexHeights, missingSkylineFiles, parseSkylineIndex, readSkylineIndex } from '../pipeline/skyline-index.ts';

const entry = (siteId: string, heightM: number, file = `${siteId}-${heightM}m.bin`) => ({
  siteId, heightM, grade: 'B', terrain: 'LOLA 20 m + LOLA 80 m + LOLA 240 m', siteElevationM: 12, file,
});

const indexOf = (...skylines: ReturnType<typeof entry>[]) => JSON.stringify({ generatedBy: 'test', skylines });

describe('reading the skyline index', () => {
  it('reads every height in the index, not just the one the app opens with', () => {
    const index = parseSkylineIndex(indexOf(entry('a', 2), entry('a', 10), entry('a', 20)));
    expect(index.skylines.map((s) => s.heightM)).toEqual([2, 10, 20]);
    expect(indexHeights(index).filter((h) => h.available).map((h) => h.heightM)).toEqual([2, 10, 20]);
  });

  it('refuses an index that is not a list, rather than reporting no terrain at all', () => {
    expect(() => parseSkylineIndex('{}')).toThrow(/no skylines list/);
    expect(() => parseSkylineIndex('{"skylines":{}}')).toThrow(/no skylines list/);
  });

  it('refuses an entry with no file, no height, or no grade, instead of loading a half record', () => {
    expect(() => parseSkylineIndex(indexOf({ ...entry('a', 2), file: undefined } as never))).toThrow(/has no file/);
    expect(() => parseSkylineIndex(indexOf({ ...entry('a', 2), heightM: undefined } as never))).toThrow(/has no heightM/);
    expect(() => parseSkylineIndex(indexOf({ ...entry('a', 2), grade: undefined } as never))).toThrow(/has no grade/);
  });

  it('returns null when there is no index at all, which is the only case treated as no terrain', () => {
    const dir = mkdtempSync(`${tmpdir()}/oneiric-index-`);
    expect(readSkylineIndex(dir)).toBeNull();
  });

  it('names every file the index lists but the disk does not hold', () => {
    const dir = mkdtempSync(`${tmpdir()}/oneiric-index-`);
    writeFileSync(`${dir}/a-2m.bin`, 'not really a skyline, only the presence matters here');
    const index = parseSkylineIndex(indexOf(entry('a', 2), entry('b', 10)));
    expect(missingSkylineFiles(index, dir)).toEqual([`${dir}/b-10m.bin`]);
  });

  it('lists the standard heights as unavailable when the index holds only one height', () => {
    const options = indexHeights(parseSkylineIndex(indexOf(entry('a', 2))));
    expect(options.map((o) => o.heightM)).toEqual([0, 2, 10, 20]);
    expect(options.filter((o) => o.available).map((o) => o.heightM)).toEqual([2]);
  });
});

describe('the height coverage check', () => {
  it('passes when one height is stored and every listed file is present, without demanding a second height', async () => {
    const { runHeightCoverageCheck } = await import('../pipeline/validate.ts');
    const dir = mkdtempSync(`${tmpdir()}/oneiric-cov-`);
    writeFileSync(`${dir}/a-2m.bin`, 'payload presence is all this check looks at');
    writeFileSync(`${dir}/index.json`, indexOf(entry('a', 2)));
    const row = runHeightCoverageCheck(dir)!;
    expect(row.pass).toBe(true);
    expect(row.id).toBe('observer-heights');
    expect((row.detail as { availableHeightsM: number[] }).availableHeightsM).toEqual([2]);
    expect((row.detail as { note: string }).note).toMatch(/smooth sphere at grade D/);
  });

  it('fails and names the file when the index lists a skyline the disk does not hold', async () => {
    const { runHeightCoverageCheck } = await import('../pipeline/validate.ts');
    const dir = mkdtempSync(`${tmpdir()}/oneiric-cov-`);
    writeFileSync(`${dir}/a-2m.bin`, 'x');
    writeFileSync(`${dir}/index.json`, indexOf(entry('a', 2), entry('b', 10)));
    const row = runHeightCoverageCheck(dir)!;
    expect(row.pass).toBe(false);
    expect((row.detail as { missingFiles: string[] }).missingFiles).toEqual([`${dir}/b-10m.bin`]);
  });

  it('reports both heights once files for a second height exist', async () => {
    const { runHeightCoverageCheck } = await import('../pipeline/validate.ts');
    const dir = mkdtempSync(`${tmpdir()}/oneiric-cov-`);
    writeFileSync(`${dir}/a-2m.bin`, 'x');
    writeFileSync(`${dir}/a-10m.bin`, 'x');
    writeFileSync(`${dir}/index.json`, indexOf(entry('a', 2), entry('a', 10)));
    const row = runHeightCoverageCheck(dir)!;
    expect(row.pass).toBe(true);
    expect((row.detail as { note: string }).note).toMatch(/mast comparison/);
  });

  it('returns null when no index exists, rather than claiming a pass', async () => {
    const { runHeightCoverageCheck } = await import('../pipeline/validate.ts');
    expect(runHeightCoverageCheck(mkdtempSync(`${tmpdir()}/oneiric-cov-`))).toBeNull();
  });
});
