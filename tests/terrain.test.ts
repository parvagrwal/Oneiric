import { describe, expect, it } from 'vitest';
import {
  azEl, buildSkyline, decodeSkyline, demHeight, encodeSkyline, makeDemGrid, siteFrame, SKY_BINS, SKYLINE_BYTES,
  smoothHorizonDeg, southPolarXY, terrainGrade, TIER_LIMITS_M, type DemGrid, type Tier,
} from '../engine/index.ts';
import { groundPoint, pointFromSite, syntheticDem } from '../pipeline/synthetic-terrain.ts';
import { profileHorizonDeg } from '../pipeline/skyline-check.ts';

const R = 1_737_400;
const SITE = { lat: -85, lon: 30 };
const grid = (z: number[], width: number, extra: Partial<DemGrid> = {}) =>
  makeDemGrid({ name: 'test raster', pixelM: 20, xEdgeM: 0, yEdgeM: 0, width, height: z.length / width, z: Float32Array.from(z), ...extra });

describe('south polar stereographic projection', () => {
  it('puts 80 degrees south on the prime meridian at x = 0, y = +304.0 km', () => {
    const p = southPolarXY(-80, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y / 1000).toBeCloseTo(304.0, 1);
  });
  it('puts 90 degrees east on the +x axis and 180 degrees on the -y axis, and the pole at the origin', () => {
    expect(southPolarXY(-80, 90).x / 1000).toBeCloseTo(304.0, 1);
    expect(southPolarXY(-80, 90).y).toBeCloseTo(0, 6);
    expect(southPolarXY(-80, 180).y / 1000).toBeCloseTo(-304.0, 1);
    expect(Math.hypot(southPolarXY(-90, 77).x, southPolarXY(-90, 77).y)).toBeLessThan(1e-6);
  });
  it('agrees with the independently written inverse used to make the synthetic terrain', () => {
    for (const [lat, lon] of [[-85, 30], [-89.45, 222.69], [-69.37, 32.32], [-80.13, 1.44]]) {
      const { x, y } = southPolarXY(lat, lon);
      const q = groundPoint(x, y);
      const want = siteFrame(lat, lon, R).up;
      for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(want[i], 12);
    }
  });
});

describe('elevation raster lookup', () => {
  // 3 x 3 raster of 20 m pixels: row 0 is the largest y, column 0 the smallest x. Pixel centres at x = 10, 30, 50 and y = -10, -30, -50.
  const g = grid([1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
  it('returns the stored value at a pixel centre and interpolates between centres', () => {
    expect(demHeight(g, 10, -10)).toBe(1);
    expect(demHeight(g, 50, -10)).toBe(3);
    expect(demHeight(g, 10, -50)).toBe(7);
    expect(demHeight(g, 20, -10)).toBeCloseTo(1.5, 12);
    expect(demHeight(g, 30, -20)).toBeCloseTo(3.5, 12);
  });
  it('gives no height outside the pixel centres or next to a pixel with no data', () => {
    expect(demHeight(g, 5, -10)).toBeNaN();
    expect(demHeight(g, 30, -55)).toBeNaN();
    expect(demHeight(grid([1, NaN, 3, 4, 5, 6, 7, 8, 9], 3), 20, -20)).toBeNaN();
  });
  it('refuses a raster whose size does not match, or whose heights cannot be metres', () => {
    expect(() => grid([1, 2, 3], 2)).toThrow(/does not match/);
    expect(() => grid([0, 0, 0, 25_000], 2)).toThrow(/not metres/);
    expect(() => grid([NaN, NaN, NaN, NaN], 2)).toThrow(/no valid height/);
  });
});

describe('skyline builder', () => {
  const flatNear = syntheticDem('flat 20 m', 20, 6_000, SITE.lat, SITE.lon);
  const near = (dem: DemGrid): Tier[] => [{ dem, maxDistM: TIER_LIMITS_M[0] }];

  it('returns the smooth-sphere dip on flat ground, and records no blocking terrain beyond the horizon distance', () => {
    const b = buildSkyline(near(flatNear), SITE.lat, SITE.lon, 2);
    expect(b.H).toHaveLength(SKY_BINS);
    for (const v of b.H) expect(Math.abs(v - smoothHorizonDeg(2))).toBeLessThan(0.01);
    // The tangent point from 2 m up is about 2.6 km away.
    expect(b.D[0] * 10).toBeGreaterThan(2_300);
    expect(b.D[0] * 10).toBeLessThan(3_000);
    expect(b.siteElevationM).toBe(0);
  });

  it('adds the terrain height at the site to the observer radius', () => {
    const plateau = syntheticDem('plateau', 20, 6_000, SITE.lat, SITE.lon, (rel) => (rel.distM < 1_000 ? 150 : 0));
    const b = buildSkyline(near(plateau), SITE.lat, SITE.lon, 2);
    expect(b.siteElevationM).toBeCloseTo(150, 3);
    // From 152 m above the plain the far horizon dips 0.76 degrees; the plateau edge 1 km away hides part of it.
    expect(b.H[100]).toBeLessThan(smoothHorizonDeg(2) - 0.01);
    expect(b.H[100]).toBeGreaterThan(smoothHorizonDeg(152) - 0.01);
  });

  it('gives the same elevation for a ridge crest as the site-frame geometry used for the Sun and Earth', () => {
    const profile = (s: number) => 400 * Math.exp(-(((s - 5_000) / 500) ** 2));
    const ridge = syntheticDem('ridge', 20, 7_000, SITE.lat, SITE.lon, (rel) => profile(rel.distM));
    const b = buildSkyline(near(ridge), SITE.lat, SITE.lon, 2);
    const frame = siteFrame(SITE.lat, SITE.lon, R + 2);
    // Independent route: place points along azimuth 123 degrees as 3-D positions and take their elevation with azEl.
    let best = -90;
    for (let s = 4_000; s <= 5_500; s += 1) {
      const q = pointFromSite(SITE.lat, SITE.lon, s, 123);
      const r = (R + profile(s)) / 1000;
      best = Math.max(best, azEl(frame, [q[0] * r, q[1] * r, q[2] * r]).el);
    }
    expect(Math.abs(b.H[Math.floor(123 / 0.25)] - best)).toBeLessThan(0.01);
    expect(Math.abs(profileHorizonDeg(profile, 2, 3_000, 5_500) - best)).toBeLessThan(0.001);
    expect(b.D[492] * 10).toBeGreaterThan(4_900);
    expect(b.D[492] * 10).toBeLessThan(5_050);
  });

  it('a step of seven pixels, as in a 1 percent of distance rule at 15 km, steps over part of a ridge; half a pixel does not', () => {
    const profile = (s: number) => 400 * Math.exp(-(((s - 5_000) / 500) ** 2));
    const ridge = syntheticDem('ridge', 20, 7_000, SITE.lat, SITE.lon, (rel) => profile(rel.distM));
    const want = profileHorizonDeg(profile, 2, 3_000, 5_500);
    const worst = (H: Float32Array) => Math.max(...Array.from(H, (v) => Math.abs(v - want)));
    expect(worst(buildSkyline(near(ridge), SITE.lat, SITE.lon, 2).H)).toBeLessThan(0.01);
    expect(worst(buildSkyline(near(ridge), SITE.lat, SITE.lon, 2, { stepPixels: 7 }).H)).toBeGreaterThan(0.01);
  });

  it('falls through to a coarser raster outside the fine one, and says the near field is incomplete', () => {
    const small = syntheticDem('small 20 m', 20, 3_000, SITE.lat, SITE.lon);
    const coarse = syntheticDem('wide 240 m', 240, 30_000, SITE.lat, SITE.lon, (rel) => 2_000 * Math.exp(-(((rel.distM - 20_000) / 3_000) ** 2)));
    const tiers: Tier[] = [{ dem: small, maxDistM: TIER_LIMITS_M[0] }, { dem: coarse, maxDistM: Infinity }];
    const b = buildSkyline(tiers, SITE.lat, SITE.lon, 2);
    expect(b.nearFieldComplete).toBe(false);
    expect(b.samplesPerTier[1]).toBeGreaterThan(0);
    expect(b.products).toEqual(['small 20 m', 'wide 240 m']);
    expect(b.H[0]).toBeGreaterThan(3); // the 2 km ridge on the coarse raster is seen
    expect(() => terrainGrade(tiers, b)).toThrow(/no fidelity grade/);
  });

  it('beyond its 15 km limit the fine raster gives way to the coarser one, even where the fine raster still has data', () => {
    const wideFine = syntheticDem('wide flat 20 m', 20, 20_000, SITE.lat, SITE.lon);
    const coarse = syntheticDem('80 m with a ridge', 80, 22_000, SITE.lat, SITE.lon, (rel) => 1_500 * Math.exp(-(((rel.distM - 18_000) / 1_000) ** 2)));
    const b = buildSkyline([{ dem: wideFine, maxDistM: TIER_LIMITS_M[0] }, { dem: coarse, maxDistM: TIER_LIMITS_M[1] }], SITE.lat, SITE.lon, 2);
    expect(b.nearFieldComplete).toBe(true);
    expect(b.H[700]).toBeGreaterThan(4); // the ridge exists only on the coarser raster
    expect(b.D[700] * 10).toBeGreaterThan(17_000);
  });

  it('grades a complete 20 m near field B and the 240 m raster alone C', () => {
    const b = buildSkyline(near(flatNear), SITE.lat, SITE.lon, 2, { maxRangeM: 5_000 });
    expect(b.nearFieldComplete).toBe(true);
    expect(terrainGrade(near(flatNear), b)).toBe('B');
    const coarse: Tier[] = [{ dem: syntheticDem('wide 240 m', 240, 30_000, SITE.lat, SITE.lon), maxDistM: Infinity }];
    expect(terrainGrade(coarse, buildSkyline(coarse, SITE.lat, SITE.lon, 2))).toBe('C');
    const mid: Tier[] = [{ dem: syntheticDem('wide 80 m', 80, 30_000, SITE.lat, SITE.lon), maxDistM: Infinity }];
    expect(() => terrainGrade(mid, buildSkyline(mid, SITE.lat, SITE.lon, 2))).toThrow(/no fidelity grade/);
  });

  it('counts rays that run off the raster instead of treating the edge as open sky silently', () => {
    const b = buildSkyline(near(syntheticDem('tiny', 20, 1_000, SITE.lat, SITE.lon)), SITE.lat, SITE.lon, 2);
    expect(b.raysEndedAtRasterEdge).toBe(SKY_BINS * 4);
    expect(b.nearFieldComplete).toBe(false);
    expect(b.distanceReachedM).toBeLessThan(1_500);
  });

  it('refuses a site outside every raster, rasters in the wrong order, and bad options', () => {
    expect(() => buildSkyline(near(flatNear), -70, 30, 2)).toThrow(/outside every elevation raster/);
    expect(() => buildSkyline([], SITE.lat, SITE.lon, 2)).toThrow(/at least one/);
    const coarse = syntheticDem('wide 240 m', 240, 30_000, SITE.lat, SITE.lon);
    expect(() => buildSkyline([{ dem: coarse, maxDistM: 15_000 }, { dem: flatNear, maxDistM: Infinity }], SITE.lat, SITE.lon, 2)).toThrow(/fine and near/);
    expect(() => buildSkyline(near(flatNear), SITE.lat, SITE.lon, 2, { stepPixels: 0 })).toThrow(/options/);
    expect(() => buildSkyline(near(flatNear), SITE.lat, SITE.lon, -1)).toThrow(/zero or more/);
  });
});

describe('stored skyline format', () => {
  it('is 8,640 bytes: 1,440 little-endian floats then 1,440 little-endian 16-bit distances, and round-trips', () => {
    const H = Float32Array.from({ length: SKY_BINS }, (_, i) => Math.sin(i) * 3);
    const D = Uint16Array.from({ length: SKY_BINS }, (_, i) => (i * 37) % 65536);
    const buf = encodeSkyline(H, D);
    expect(buf.byteLength).toBe(8640);
    expect(SKYLINE_BYTES).toBe(8640);
    const view = new DataView(buf);
    expect(view.getFloat32(4 * 7, true)).toBe(H[7]);
    expect(view.getUint16(4 * SKY_BINS + 2 * 7, true)).toBe(D[7]);
    const back = decodeSkyline(buf);
    expect(Array.from(back.H)).toEqual(Array.from(H));
    expect(Array.from(back.D)).toEqual(Array.from(D));
  });
  it('refuses a file of the wrong length', () => {
    expect(() => decodeSkyline(new ArrayBuffer(8639))).toThrow(/8640 bytes/);
    expect(() => encodeSkyline(new Float32Array(10), new Uint16Array(10))).toThrow();
  });
});
