// Which observer heights have a terrain skyline, and which stored skyline a request may use.
//
// The rule this file exists to enforce: a terrain skyline is used only at the exact height it was built for.
// Any other height runs on the smooth sphere, which is always grade D. A 2 m skyline must never stand in for a
// 10 m mast, because on smooth ground the horizon sits at -0.087 degrees at 2 m and -0.19 degrees at 10 m, and
// a tenth of a degree is a third of the Sun's disc. Substituting the nearest stored height would move a sunlit
// percentage without any label saying so.

/** Heights the app offers whether or not a skyline exists for them yet. The set the sensitivity report uses. */
export const STANDARD_HEIGHTS_M: readonly number[] = [0, 2, 10, 20];

/** The least a skyline record must say for the height resolver to place it. */
export interface ShippedSkyline {
  siteId: string;
  heightM: number;
}

export interface HeightOption {
  heightM: number;
  /** True when at least one stored skyline was built at this height. */
  available: boolean;
  /** Number of sites with a stored skyline at this height. */
  skylineCount: number;
}

/**
 * The heights to offer in the selector: the standard heights, every height that has a stored skyline,
 * and the height currently requested (so a shared link to an unusual height still shows what it is doing).
 * Sorted ascending. A height with no skyline is listed with `available: false` rather than hidden, so the
 * gap is visible instead of looking like a height that does not exist.
 */
export function heightOptions(shipped: readonly ShippedSkyline[], requested?: number): HeightOption[] {
  const counts = new Map<number, number>();
  for (const s of shipped) {
    if (!Number.isFinite(s.heightM)) throw new RangeError(`stored skyline for ${s.siteId} has no finite height`);
    counts.set(s.heightM, (counts.get(s.heightM) ?? 0) + 1);
  }
  const heights = new Set<number>(STANDARD_HEIGHTS_M);
  for (const h of counts.keys()) heights.add(h);
  if (requested !== undefined) {
    if (!Number.isFinite(requested)) throw new RangeError(`requested observer height is not a number: ${requested}`);
    heights.add(requested);
  }
  return [...heights].sort((a, b) => a - b).map((heightM) => {
    const skylineCount = counts.get(heightM) ?? 0;
    return { heightM, available: skylineCount > 0, skylineCount };
  });
}

/**
 * The stored skyline for this site at exactly this height, or null. Null means the caller must use the smooth
 * sphere at grade D. There is no nearest-match path on purpose: an approximate height is a wrong number with a
 * plausible face. Two records for the same site and height are refused, because which one is used would be
 * decided by file order.
 */
export function resolveSkylineAtHeight<T extends ShippedSkyline>(
  shipped: readonly T[],
  siteId: string,
  heightM: number,
): T | null {
  if (!Number.isFinite(heightM)) throw new RangeError(`observer height must be a finite number, got ${heightM}`);
  let found: T | null = null;
  for (const s of shipped) {
    if (s.siteId !== siteId || s.heightM !== heightM) continue;
    if (found) throw new Error(`two stored skylines for ${siteId} at ${heightM} m: the file list is ambiguous`);
    found = s;
  }
  return found;
}

/** True when this site has terrain at this height, so the caller can label the card honestly. */
export const hasTerrainAtHeight = (shipped: readonly ShippedSkyline[], siteId: string, heightM: number): boolean =>
  resolveSkylineAtHeight(shipped, siteId, heightM) !== null;
