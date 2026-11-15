// The mast report compares a site with itself at two heights. These tests fix what it may and may not say:
// one row per neighbouring pair, low to high, signs carrying the direction, and nothing at all when only one
// height exists. A report that invented the second height would be the exact failure the feature exists to avoid.
import { describe, expect, it } from 'vitest';
import { compareHeights, type HeightMetrics } from '../pipeline/height-report.ts';

const row = (siteId: string, heightM: number, sunlitPct: number, darkGap = 0, earth = 0, linkGap = 0): HeightMetrics => ({
  siteId, heightM, grade: 'B', sunlitPct, longestDarkGapH: darkGap, earthVisiblePct: earth, longestLinkGapH: linkGap,
});

describe('mast height comparison', () => {
  it('pairs consecutive stored heights, low to high, whatever order they were measured in', () => {
    const out = compareHeights([
      row('ridge', 20, 70), row('ridge', 2, 60), row('ridge', 10, 66),
    ]);
    expect(out.map((c) => [c.fromHeightM, c.toHeightM])).toEqual([[2, 10], [10, 20]]);
  });

  it('reports the gain as a signed difference, so a mast that loses sun says so', () => {
    const out = compareHeights([row('ridge', 2, 60, 12, 40, 9), row('ridge', 10, 66, 5, 40, 3)]);
    expect(out[0]).toMatchObject({
      sunlitPoints: 6, darkGapHours: -7, earthVisiblePoints: 0, linkGapHours: -6,
    });
    const worse = compareHeights([row('ridge', 2, 66), row('ridge', 10, 60)]);
    expect(worse[0].sunlitPoints).toBe(-6);
  });

  it('never compares one site with another, and never invents a height', () => {
    expect(compareHeights([row('a', 2, 90), row('b', 10, 20)])).toEqual([]);
    expect(compareHeights([row('a', 2, 90)])).toEqual([]);
    expect(compareHeights([])).toEqual([]);
  });

  it('handles a site that has three heights and another with one, without mixing them up', () => {
    const out = compareHeights([
      row('a', 0, 10), row('a', 2, 20), row('a', 20, 50),
      row('b', 2, 80),
    ]);
    expect(out.map((c) => `${c.siteId} ${c.fromHeightM}->${c.toHeightM}`)).toEqual(['a 0->2', 'a 2->20']);
  });
});
