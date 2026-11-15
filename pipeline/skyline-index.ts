// Read the skyline index the app loads and the pipeline reports on: which site and height has a stored terrain
// skyline. The index is written by pipeline/build-skylines.ts and shipped in the app; nothing here rebuilds it.
//
// File contract, for whoever adds skylines later:
//   app/public/data/skylines/<siteId>-<heightM>m.bin   one file per site and height, 8,640 bytes
//   app/public/data/skylines/<siteId>-<heightM>m.json  the build record for that file
//   app/public/data/skylines/index.json                the list the app reads
// A height appears in the app as soon as index.json and the matching .bin files are present. No code change and
// no rebuild of the app are needed. `npm run build:skylines -- --heights 0,2,10,20` writes them all.
import { existsSync, readFileSync } from 'node:fs';
import { heightOptions, type HeightOption, type ShippedSkyline } from '../engine/heights.ts';
import { SKYLINE_DIR } from './skyline-files.ts';

/** One row of index.json, as the app reads it. */
export interface SkylineIndexEntry extends ShippedSkyline {
  grade: string;
  terrain: string;
  siteElevationM: number;
  file: string;
}

export interface SkylineIndex {
  generatedBy: string;
  skylines: SkylineIndexEntry[];
}

/** Parse the index, refusing a shape a wrong file could take. A bad index is an error, never an empty list. */
export function parseSkylineIndex(text: string): SkylineIndex {
  const raw = JSON.parse(text) as Partial<SkylineIndex>;
  if (!raw || !Array.isArray(raw.skylines)) throw new Error('skyline index has no skylines list');
  for (const s of raw.skylines) {
    const needs = ['siteId', 'heightM', 'grade', 'terrain', 'siteElevationM', 'file'] as const;
    for (const key of needs) {
      if (s[key as keyof SkylineIndexEntry] === undefined) throw new Error(`skyline index entry ${s.siteId ?? '(no site)'} has no ${key}`);
    }
    if (!Number.isFinite(s.heightM)) throw new Error(`skyline index entry ${s.siteId} has a non-finite height`);
  }
  return { generatedBy: raw.generatedBy ?? '', skylines: raw.skylines };
}

export function readSkylineIndex(dir: string = SKYLINE_DIR): SkylineIndex | null {
  const path = `${dir}/index.json`;
  if (!existsSync(path)) return null;
  return parseSkylineIndex(readFileSync(path, 'utf8'));
}

/** The heights the app will offer, from the index alone. One statement of the rule, used by app and pipeline. */
export const indexHeights = (index: SkylineIndex | null): HeightOption[] =>
  heightOptions(index?.skylines ?? []);

/** Files listed in the index that are not on disk. Empty is the only healthy answer. */
export function missingSkylineFiles(index: SkylineIndex, dir: string = SKYLINE_DIR): string[] {
  return index.skylines.map((s) => `${dir}/${s.file}`).filter((p) => !existsSync(p));
}
