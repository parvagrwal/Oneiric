// What these tests defend against: a terrain skyline used at a height it was not built for.
//
// On smooth ground the horizon sits at -0.087 degrees from 2 m and -0.194 degrees from 10 m. Handing a 10 m
// request the 2 m skyline therefore moves the horizon by about a tenth of a degree, a third of the Sun's
// disc, and changes a sunlit percentage with no label saying why. The resolver answers null instead, and the
// caller falls back to the smooth sphere, which is grade D.
import { describe, expect, it } from 'vitest';
import { hasTerrainAtHeight, heightOptions, resolveSkylineAtHeight, STANDARD_HEIGHTS_M } from '../engine/index.ts';

const shipped = [
  { siteId: 'connecting-ridge', heightM: 2, grade: 'B' },
  { siteId: 'connecting-ridge', heightM: 10, grade: 'B' },
  { siteId: 'im-1-odysseus', heightM: 2, grade: 'C' },
];

describe('which stored skyline a height request may use', () => {
  it('returns the skyline built at exactly that height', () => {
    expect(resolveSkylineAtHeight(shipped, 'connecting-ridge', 10)?.grade).toBe('B');
    expect(resolveSkylineAtHeight(shipped, 'im-1-odysseus', 2)?.grade).toBe('C');
  });

  it('never substitutes a nearby height: 20 m and 0 m resolve to null when only 2 and 10 m exist', () => {
    expect(resolveSkylineAtHeight(shipped, 'connecting-ridge', 20)).toBeNull();
    expect(resolveSkylineAtHeight(shipped, 'connecting-ridge', 0)).toBeNull();
    expect(hasTerrainAtHeight(shipped, 'connecting-ridge', 20)).toBe(false);
  });

  it('never lends one site skyline to another, and says nothing about a site with no skyline', () => {
    expect(resolveSkylineAtHeight(shipped, 'shackleton-rim', 2)).toBeNull();
    expect(hasTerrainAtHeight(shipped, 'shackleton-rim', 2)).toBe(false);
  });

  it('refuses a height that is not a number instead of guessing', () => {
    expect(() => resolveSkylineAtHeight(shipped, 'connecting-ridge', Number.NaN)).toThrow(/finite/);
  });

  it('refuses two records for the same site and height instead of letting file order decide', () => {
    const twice = [...shipped, { siteId: 'connecting-ridge', heightM: 2, grade: 'A' }];
    expect(() => resolveSkylineAtHeight(twice, 'connecting-ridge', 2)).toThrow(/ambiguous/);
  });

  it('treats a height stored with a floating point slip as a different height', () => {
    // 2.0000001 is a corrupted record, not a 2 m skyline.
    expect(resolveSkylineAtHeight([{ siteId: 'x', heightM: 2.0000001 }], 'x', 2)).toBeNull();
  });
});

describe('the heights offered in the selector', () => {
  it('offers the four standard heights and marks which have a stored skyline', () => {
    const options = heightOptions(shipped);
    expect(options.map((o) => o.heightM)).toEqual([0, 2, 10, 20]);
    expect(options.filter((o) => o.available).map((o) => o.heightM)).toEqual([2, 10]);
    expect(options.find((o) => o.heightM === 2)).toEqual({ heightM: 2, available: true, skylineCount: 2 });
    expect(options.find((o) => o.heightM === 0)).toEqual({ heightM: 0, available: false, skylineCount: 0 });
  });

  it('offers a height that has files even when it is not a standard one, so a new build shows up unchanged', () => {
    const options = heightOptions([...shipped, { siteId: 'a', heightM: 5, grade: 'B' }]);
    expect(options.map((o) => o.heightM)).toEqual([0, 2, 5, 10, 20]);
    expect(options.find((o) => o.heightM === 5)?.available).toBe(true);
  });

  it('keeps a requested height in the list even with no skyline, so a shared link shows what it is doing', () => {
    const options = heightOptions(shipped, 33);
    expect(options.find((o) => o.heightM === 33)).toEqual({ heightM: 33, available: false, skylineCount: 0 });
    expect(options.at(-1)?.heightM).toBe(33);
  });

  it('lists the standard heights even with no skyline at all, and marks all of them unavailable', () => {
    const options = heightOptions([]);
    expect(options.map((o) => o.heightM)).toEqual([...STANDARD_HEIGHTS_M]);
    expect(options.every((o) => !o.available)).toBe(true);
  });

  it('marks every height unavailable when nothing at all is stored, so no height promises terrain it lacks', () => {
    // The selector's `available` flag is what stops the app offering a height it cannot compute. A mutant that
    // forces it true leaves the flat-list assertion above passing and only shows up here, on every entry at once.
    const options = heightOptions([]);
    expect(options.map((o) => o.available)).toEqual([false, false, false, false]);
    expect(options.every((o) => o.skylineCount === 0)).toBe(true);
  });

  it('counts a height once per site, and refuses a stored record with no usable height', () => {
    expect(heightOptions([...shipped, ...shipped]).find((o) => o.heightM === 2)?.skylineCount).toBe(4);
    expect(() => heightOptions([{ siteId: 'x', heightM: Number.POSITIVE_INFINITY }])).toThrow(/finite/);
  });

  it('refuses a requested height that is not a number, instead of quietly listing it', () => {
    expect(() => heightOptions(shipped, Number.NaN)).toThrow(/not a number/);
    expect(() => heightOptions(shipped, Number.POSITIVE_INFINITY)).toThrow(/not a number/);
  });

  it('sorts numerically, not as text, so 10 m comes after 2 m', () => {
    expect(heightOptions([{ siteId: 'a', heightM: 10 }]).map((o) => o.heightM)).toEqual([0, 2, 10, 20]);
  });
});
