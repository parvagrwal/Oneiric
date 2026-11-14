// Write, list and verify the skyline files shipped with the app: one 8,640-byte file per site and height,
// plus a JSON record of how it was built.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { R_MOON_KM, SKY_BINS, SKY_BIN_DEG } from '../engine/constants.ts';
import { GRADE_MEANING } from '../engine/provenance.ts';
import { makeSkyline, type Grade } from '../engine/skyline.ts';
import { buildSkyline, decodeSkyline, encodeSkyline, terrainGrade, type BuiltSkyline, type Tier } from '../engine/terrain.ts';

export const SKYLINE_DIR = 'app/public/data/skylines';
/** Each block is 10 degrees of azimuth. A changed height is traced to its block. */
export const BLOCK_BINS = 40;

export interface SkylineRecord {
  siteId: string; siteName: string; latDeg: number; eLonDeg: number; heightM: number;
  grade: Grade; gradeMeaning: string; terrain: string;
  products: Array<{ name: string; file?: string; url?: string; pixelM: number; samples: number }>;
  siteElevationM: number; distanceReachedKm: number; raysEndedAtRasterEdge: number; nearFieldComplete: boolean;
  stepPixels: number; subRays: number; bins: number; binWidthDeg: number;
  horizonDeg: { min: number; max: number };
  frame: string; referenceRadiusM: number;
  file: string; format: string; sha256: string; blockSha256: string[];
  engineCommit: string; builtAtUtc: string;
}

export interface GradedSkyline { built: BuiltSkyline; grade: Grade; tiers: Tier[] }

/**
 * Build with every raster that covers the site. If a 20 m raster does not supply the whole near field,
 * build again on the 240 m raster alone, so the grade always means what it says.
 */
export function buildGraded(available: Tier[], latDeg: number, lonDeg: number, heightM: number): GradedSkyline {
  if (available.length > 0 && available[0].dem.pixelM <= 20) {
    const built = buildSkyline(available, latDeg, lonDeg, heightM);
    if (built.nearFieldComplete) return { built, grade: terrainGrade(available, built), tiers: available };
  }
  const coarse = available.filter((t) => t.dem.pixelM === 240).map((t) => ({ dem: t.dem, maxDistM: Infinity }));
  if (coarse.length === 0) throw new Error(`no 20 m near field and no 240 m raster at ${latDeg}, ${lonDeg}: no terrain grade is possible`);
  const built = buildSkyline(coarse, latDeg, lonDeg, heightM);
  return { built, grade: terrainGrade(coarse, built), tiers: coarse };
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function blockHashes(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let b = 0; b < SKY_BINS / BLOCK_BINS; b++) {
    const h = createHash('sha256');
    h.update(bytes.subarray(b * BLOCK_BINS * 4, (b + 1) * BLOCK_BINS * 4));
    h.update(bytes.subarray(SKY_BINS * 4 + b * BLOCK_BINS * 2, SKY_BINS * 4 + (b + 1) * BLOCK_BINS * 2));
    out.push(h.digest('hex').slice(0, 16));
  }
  return out;
}

export const skylineFileName = (siteId: string, heightM: number) => `${siteId}-${heightM}m.bin`;

export interface SiteInfo { id: string; name: string; lat: number; eLon: number }

/** Write one skyline and its record. The terrain label is the list of rasters that supplied samples. */
export function writeSkyline(dir: string, site: SiteInfo, g: GradedSkyline, engineCommit: string, files: Record<string, { file: string; url: string }> = {}): SkylineRecord {
  const { built } = g;
  const terrain = built.products.join(' + ');
  const sky = makeSkyline({ H: built.H, D: built.D, grade: g.grade, terrain, heightM: built.heightM });
  const bytes = new Uint8Array(encodeSkyline(built.H, built.D));
  const file = skylineFileName(site.id, built.heightM);
  const record: SkylineRecord = {
    siteId: site.id, siteName: site.name, latDeg: site.lat, eLonDeg: site.eLon, heightM: built.heightM,
    grade: g.grade, gradeMeaning: GRADE_MEANING[g.grade], terrain,
    products: g.tiers.map((t, i) => ({ name: t.dem.name, ...files[t.dem.name], pixelM: t.dem.pixelM, samples: built.samplesPerTier[i] })).filter((p) => p.samples > 0),
    siteElevationM: built.siteElevationM, distanceReachedKm: built.distanceReachedM / 1000,
    raysEndedAtRasterEdge: built.raysEndedAtRasterEdge, nearFieldComplete: built.nearFieldComplete,
    stepPixels: built.stepPixels, subRays: built.subRays, bins: SKY_BINS, binWidthDeg: SKY_BIN_DEG,
    horizonDeg: { min: sky.hMin, max: sky.hMax },
    frame: 'MOON_ME, east-positive longitude', referenceRadiusM: R_MOON_KM * 1000,
    file, format: `${SKY_BINS} little-endian float32 horizon elevations in degrees, then ${SKY_BINS} little-endian uint16 distances in 10 m units`,
    sha256: sha(bytes), blockSha256: blockHashes(bytes),
    engineCommit, builtAtUtc: new Date().toISOString(),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${file}`, bytes);
  writeFileSync(`${dir}/${file.replace(/\.bin$/, '.json')}`, JSON.stringify(record, null, 2) + '\n');
  return record;
}

export const readRecords = (dir: string): SkylineRecord[] =>
  !existsSync(dir) ? [] : readdirSync(dir).filter((n) => n.endsWith('m.json')).sort().map((n) => JSON.parse(readFileSync(`${dir}/${n}`, 'utf8')) as SkylineRecord);

/** The list the app loads: which site and height has a terrain skyline, with its grade and terrain source. */
export function writeIndex(dir: string): number {
  const skylines = readRecords(dir).map((r) => ({ siteId: r.siteId, heightM: r.heightM, grade: r.grade, terrain: r.terrain, siteElevationM: r.siteElevationM, file: r.file }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.json`, JSON.stringify({ generatedBy: 'pipeline/build-skylines.ts', skylines }, null, 2) + '\n');
  return skylines.length;
}

/** Compare every shipped skyline with its record. Returns one line per problem, naming the file and the azimuth range. */
export function verifySkylineFiles(dir: string): { files: number; problems: string[] } {
  const problems: string[] = [];
  const records = readRecords(dir);
  for (const r of records) {
    const path = `${dir}/${r.file}`;
    if (!existsSync(path)) { problems.push(`${r.file}: file is missing`); continue; }
    const b = readFileSync(path);
    const bytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    try {
      const { H, D } = decodeSkyline(bytes.slice().buffer);
      makeSkyline({ H, D, grade: r.grade, terrain: r.terrain, heightM: r.heightM });
    } catch (e) { problems.push(`${r.file}: ${(e as Error).message}`); continue; }
    if (sha(bytes) !== r.sha256) {
      const now = blockHashes(bytes);
      const changed = now.flatMap((h, i) => (h === r.blockSha256[i] ? [] : [`${i * BLOCK_BINS * SKY_BIN_DEG} to ${(i + 1) * BLOCK_BINS * SKY_BIN_DEG} degrees`]));
      problems.push(`${r.file}: contents differ from the build record in azimuth ${changed.join(', ')}`);
    }
  }
  return { files: records.length, problems };
}
