import { describe, expect, it } from 'vitest';
import { makeSkyline, smoothHorizonDeg, smoothSkyline, skylineAt, skylineOrSmooth, provenanceFooter, SKY_BINS } from '../engine/index.ts';

describe('skyline, grades and the smooth sphere', () => {
  it('smooth horizon dips match the locked values', () => {
    expect(smoothHorizonDeg(2)).toBeCloseTo(-0.087, 3);
    expect(smoothHorizonDeg(10)).toBeCloseTo(-0.194, 3);
    expect(smoothHorizonDeg(0)).toBe(-0);
  });
  it('a smooth skyline is always grade D and says so', () => {
    const s = smoothSkyline(2);
    expect(s.grade).toBe('D');
    expect(s.terrain).toBe('none (smooth sphere)');
    expect(provenanceFooter(s.grade, s.terrain)).toBe('Ephemeris: JPL Horizons, MOON_ME · Terrain: none (smooth sphere) · Grade D');
  });
  it('refuses smooth-sphere data carrying a terrain grade', () => {
    const s = smoothSkyline(2);
    expect(() => makeSkyline({ H: s.H, D: s.D, grade: 'B', terrain: 'LOLA 20 m', heightM: 2 })).toThrow(/smooth/);
  });
  it('refuses a terrain grade with no terrain name, and grade D with a terrain name', () => {
    const H = new Float32Array(SKY_BINS).fill(1);
    expect(() => makeSkyline({ H, D: new Uint16Array(SKY_BINS), grade: 'B', terrain: 'none (smooth sphere)', heightM: 2 })).toThrow();
    expect(() => makeSkyline({ H, D: new Uint16Array(SKY_BINS), grade: 'D', terrain: 'LOLA 20 m', heightM: 2 })).toThrow();
  });
  it('missing terrain falls back to grade D, never keeps a terrain grade', () => {
    expect(skylineOrSmooth(undefined, 2).grade).toBe('D');
    expect(skylineOrSmooth(null, 10).heightM).toBe(10);
  });
  it('reads a hill east of the site at azimuth 90, interpolates between bins and wraps at 360', () => {
    const H = new Float32Array(SKY_BINS).fill(0);
    const D = new Uint16Array(SKY_BINS);
    for (let i = 355; i <= 365; i++) { H[i] = 2; D[i] = 500; } // 88.75 to 91.5 degrees
    H[0] = 4; H[SKY_BINS - 1] = 6;
    const s = makeSkyline({ H, D, grade: 'B', terrain: 'synthetic test terrain', heightM: 2 });
    expect(skylineAt(s, 90).H).toBeCloseTo(2, 5);
    expect(skylineAt(s, 90).D).toBe(500);
    expect(skylineAt(s, 270).H).toBeCloseTo(0, 5);
    // 360 / 0 boundary sits between bin 1439 (6) and bin 0 (4): halfway is 5.
    expect(skylineAt(s, 0).H).toBeCloseTo(5, 5);
    expect(skylineAt(s, 360).H).toBeCloseTo(5, 5);
    expect(skylineAt(s, 359.875).H).toBeCloseTo(6, 5); // centre of the last bin
    expect(skylineAt(s, -0.25).H).toBeCloseTo(3, 5); // halfway between bins 1438 (0) and 1439 (6)
  });
});
