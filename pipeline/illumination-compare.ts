// Illumination comparison: this build's annual average illumination at a published point, against a published value.
//
//   npm run illumination-compare                  # every published value on file, at every stored height
//   npm run illumination-compare -- --height 10   # one height only
//
// The rule this script follows, in the order it matters:
//   1. A published value is a reference, not a result. Both figures are printed, with the difference.
//   2. A comparison needs a comparable quantity. The published observer height and the published averaging
//      definition both decide the answer at the pole, where the Sun never rises more than about 2 degrees, so an
//      unknown height makes the two figures incommensurable. When either is unknown the row reports
//      "not comparable", with the spread across heights that shows why. It does not report a pass or a fail.
//   3. Nothing is tuned to close a gap. The heights are all reported, including the ones that disagree.
//   4. A published value marked unverified in its own row is printed as unverified. Nothing here claims the paper
//      was read.
import { readFileSync } from 'node:fs';
import { MIN_MS, R_MOON_KM } from '../engine/constants.ts';
import { heightOptions } from '../engine/heights.ts';
import { metrics } from '../engine/metrics.ts';
import { siteFrame } from '../engine/frame.ts';
import { series } from '../engine/series.ts';
import { makeSkyline } from '../engine/skyline.ts';
import { decodeSkyline } from '../engine/terrain.ts';
import { loadTable } from './direction-check.ts';
import { SKYLINE_DIR } from './skyline-files.ts';
import { readSkylineIndex, type SkylineIndexEntry } from './skyline-index.ts';

const STEP_MIN = 10;
/** The comparison year: a full UTC year from one fixed start, so two runs of this script agree. */
const YEAR = 2030;
/** The tolerance the plan fixed for this comparison, used only when a comparison is possible at all. */
export const COMPARISON_TOLERANCE_POINTS = 5;

export interface PublishedValue {
  id: string;
  point: { latDeg: number; eLonDeg: number };
  valuePct: number;
  rasterPixelM: number;
  /** The paper's observer height above the surface, metres. Null when the paper's convention is not established. */
  observerHeightM: number | null;
  citation: string;
  definition: string;
  verified: boolean;
  verificationNote: string;
}

export interface HeightSample {
  heightM: number;
  siteId: string;
  builtPct: number;
  differencePoints: number;
}

export interface CompareRow {
  reference: PublishedValue;
  /** One entry per stored height at the point, so the spread is visible rather than hidden behind one choice. */
  samples: HeightSample[];
  /** The best comparison available: the sample at the published height, when that height is known and stored. */
  matched: HeightSample | null;
  /** 'comparable' only when the published height and definition are both established and a stored skyline matches. */
  status: 'comparable' | 'not-comparable';
  /** Whether the matched comparison is inside the tolerance. Null unless the status is 'comparable'. */
  withinTolerance: boolean | null;
  /** Named reasons, in the order a reader should weigh them. */
  explanation: string[];
}

/** This build's annual average sunlit share at one stored skyline and point. */
export function annualSunlitPct(
  table: ReturnType<typeof loadTable>,
  entry: SkylineIndexEntry,
  latDeg: number,
  eLonDeg: number,
): number {
  const bytes = readFileSync(`${SKYLINE_DIR}/${entry.file}`);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { H, D } = decodeSkyline(copy as ArrayBuffer);
  const sky = makeSkyline({ H, D, grade: entry.grade as 'A' | 'B' | 'C' | 'D', terrain: entry.terrain, heightM: entry.heightM });
  const frame = siteFrame(latDeg, eLonDeg, R_MOON_KM * 1000 + entry.siteElevationM + entry.heightM);
  const startMs = Date.UTC(YEAR, 0, 1);
  const endMs = Date.UTC(YEAR + 1, 0, 1);
  return metrics(series(table, { frame, sky, marginDeg: 0 }, startMs, endMs, STEP_MIN), startMs, endMs).sunlitPct;
}

/** Build the comparison rows from the published table and the shipped index. Pure, so it is tested without a table. */
export function compareRows(
  published: PublishedValue[],
  index: { skylines: SkylineIndexEntry[] },
  siteForPoint: (p: { latDeg: number; eLonDeg: number }) => string | null,
  compute: (siteId: string, entry: SkylineIndexEntry) => number,
  heights?: number[],
): CompareRow[] {
  const storedHeights = heights ?? heightOptions(index.skylines).filter((h) => h.available).map((h) => h.heightM);
  return published.map((ref) => {
    const siteId = siteForPoint(ref.point);
    const explanation: string[] = [];
    if (!siteId) {
      return {
        reference: ref,
        samples: [],
        matched: null,
        status: 'not-comparable' as const,
        withinTolerance: null,
        explanation: [`no library site sits at ${ref.point.latDeg} S, ${ref.point.eLonDeg} E, so no shipped skyline covers this point`],
      };
    }
    const samples: HeightSample[] = [];
    for (const h of storedHeights) {
      const entry = index.skylines.find((e) => e.siteId === siteId && e.heightM === h);
      if (!entry) continue;
      const builtPct = compute(siteId, entry);
      samples.push({ heightM: h, siteId, builtPct, differencePoints: builtPct - ref.valuePct });
    }
    if (samples.length === 0) {
      return {
        reference: ref,
        samples,
        matched: null,
        status: 'not-comparable' as const,
        withinTolerance: null,
        explanation: [`${siteId} has no stored skyline at any height, so no horizon exists to compare`],
      };
    }

    const matched = ref.observerHeightM === null ? null : samples.find((s) => s.heightM === ref.observerHeightM) ?? null;
    const spread = samples.map((s) => s.builtPct);

    explanation.push(
      `published ${ref.valuePct}% from a ${ref.rasterPixelM} m raster${ref.observerHeightM === null ? ', observer height not established' : ` at ${ref.observerHeightM} m`}`,
    );
    explanation.push(
      `this build over the same year gives ${samples.map((s) => `${s.builtPct.toFixed(2)}% at ${s.heightM} m`).join(', ')}`,
    );
    if (samples.length > 1) {
      explanation.push(
        `the spread across heights alone is ${(Math.max(...spread) - Math.min(...spread)).toFixed(2)} points, which is why the observer height decides whether the two figures agree`,
      );
    }

    let status: CompareRow['status'] = 'not-comparable';
    if (matched === null) {
      explanation.push(
        ref.observerHeightM === null
          ? 'the published observer height is not established, so no stored skyline can be matched to it and no pass or fail is claimed'
          : `no stored skyline at the published height of ${ref.observerHeightM} m, so another height is not substituted`,
      );
    } else if (!ref.verified) {
      explanation.push('the published value is unverified against the paper, so a difference cannot be attributed to either build');
    } else {
      status = 'comparable';
    }
    // Resolution is a real effect and is named either way, but it is not offered as an explanation for a gap larger
    // than the tolerance, because a coarser raster cannot move a yearly average by tens of points on its own.
    explanation.push(
      `resolution: this build uses ${samples[0].siteId} at ${samples[0].heightM} m from a ${index.skylines.find((e) => e.siteId === siteId && e.heightM === samples[0].heightM)!.terrain}; the published raster is ${ref.rasterPixelM} m`,
    );
    if (matched !== null && Math.abs(matched.differencePoints) > COMPARISON_TOLERANCE_POINTS) {
      explanation.push(
        `the difference of ${matched.differencePoints >= 0 ? '+' : ''}${matched.differencePoints.toFixed(2)} points exceeds the ${COMPARISON_TOLERANCE_POINTS}-point tolerance; resolution alone cannot account for a gap this large, so the height or the definition is the likelier cause`,
      );
    }
    return {
      reference: ref,
      samples,
      matched,
      status,
      withinTolerance: status === 'comparable' && matched !== null ? Math.abs(matched.differencePoints) <= COMPARISON_TOLERANCE_POINTS : null,
      explanation,
    };
  });
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const onlyHeight = argv.includes('--height') ? Number(flag('--height', '0')) : null;
  const published = JSON.parse(readFileSync('data/published-illumination.json', 'utf8')) as { values: PublishedValue[] };
  const index = readSkylineIndex();
  if (!index) {
    console.log('No skyline index in app/public/data/skylines/. Run npm run build:skylines first.');
    return;
  }
  const sites = JSON.parse(readFileSync('app/public/data/sites.json', 'utf8')).sites as Array<{ id: string; lat: number; eLon: number }>;
  const siteForPoint = (p: { latDeg: number; eLonDeg: number }): string | null =>
    sites.find((s) => Math.abs(s.lat - p.latDeg) < 1e-3 && Math.abs(s.eLon - p.eLonDeg) < 1e-3)?.id ?? null;
  const table = loadTable();
  const rows = compareRows(
    published.values,
    index,
    siteForPoint,
    (siteId, entry) => {
      const site = sites.find((s) => s.id === siteId)!;
      return annualSunlitPct(table, entry, site.lat, site.eLon);
    },
    onlyHeight === null ? undefined : [onlyHeight],
  );

  console.log(`Illumination comparison, UTC year ${YEAR}, 10-minute steps. A published value is a reference, not a result.`);
  console.log(`Tolerance used only where a comparison is possible at all: ${COMPARISON_TOLERANCE_POINTS} points.\n`);
  for (const row of rows) {
    console.log(`${row.reference.id}  ${row.reference.citation}`);
    console.log(`  published ${row.reference.valuePct}%${row.reference.verified ? '' : '  — UNVERIFIED against the paper'}`);
    console.log(`  status: ${row.status.toUpperCase()}${row.withinTolerance === null ? '' : row.withinTolerance ? ' (inside tolerance)' : ' (outside tolerance)'}`);
    for (const line of row.explanation) console.log(`  - ${line}`);
    console.log('');
  }
  const comparable = rows.filter((r) => r.status === 'comparable');
  console.log(`${comparable.length} of ${rows.length} published values comparable; ${rows.length - comparable.length} reported as not comparable with the reason.`);
  if (comparable.length === 0) {
    console.log('No pass or fail is claimed for a comparison that could not be made. The measured figure at each height is printed above.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
