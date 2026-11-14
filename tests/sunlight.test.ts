import { describe, expect, it } from 'vitest';
import { AU_KM, earthVisible, makeSkyline, smoothSiteFrame, smoothSkyline, sunFraction, SKY_BINS } from '../engine/index.ts';
import { bodyAt } from './helpers.ts';

const frame = smoothSiteFrame(-89.45, 222.69, 2);
const flatAt = (deg: number) =>
  makeSkyline({ H: new Float32Array(SKY_BINS).fill(deg), D: new Uint16Array(SKY_BINS), grade: 'B', terrain: 'synthetic flat test terrain', heightM: 2 });
const farEarth = bodyAt(frame, { el: 40, az: 10 }, 384400);

describe('sunlit fraction of the solar disc', () => {
  it('is 1 with the Sun well above the skyline and 0 well below', () => {
    const sky = flatAt(0);
    expect(sunFraction(frame, bodyAt(frame, { el: 3, az: 100 }, AU_KM), farEarth, sky).f).toBe(1);
    expect(sunFraction(frame, bodyAt(frame, { el: -3, az: 100 }, AU_KM), farEarth, sky).f).toBe(0);
  });
  it('is about one half with the Sun centre on a flat skyline, and between 0 and 1 on either side', () => {
    const sky = flatAt(0);
    const half = sunFraction(frame, bodyAt(frame, { el: 0, az: 100 }, AU_KM), farEarth, sky, true).f;
    expect(Math.abs(half - 0.5)).toBeLessThan(0.05);
    const a = sunFraction(frame, bodyAt(frame, { el: 0.2, az: 100 }, AU_KM), farEarth, sky, true).f;
    const b = sunFraction(frame, bodyAt(frame, { el: -0.2, az: 100 }, AU_KM), farEarth, sky, true).f;
    expect(a).toBeGreaterThan(0.8); expect(a).toBeLessThan(1);
    expect(b).toBeGreaterThan(0); expect(b).toBeLessThan(0.2);
  });
  it('follows the true angular size of the Sun: the disc is clear once its centre is 0.28 degrees up', () => {
    const sky = flatAt(0);
    expect(sunFraction(frame, bodyAt(frame, { el: 0.28, az: 0 }, AU_KM), farEarth, sky, true).f).toBe(1);
    expect(sunFraction(frame, bodyAt(frame, { el: -0.28, az: 0 }, AU_KM), farEarth, sky, true).f).toBe(0);
  });
  it('Earth directly in front of the Sun hides it completely and reports full cover; terrain does not matter', () => {
    const sky = flatAt(-10);
    const sun = bodyAt(frame, { el: 5, az: 40 }, AU_KM);
    const earth = bodyAt(frame, { el: 5, az: 40 }, 384400);
    const r = sunFraction(frame, sun, earth, sky);
    expect(r.f).toBe(0);
    expect(r.cover).toBe(1);
  });
  it('Earth covering part of the disc gives partial cover and the matching reduction in f', () => {
    const sky = flatAt(-10);
    const sun = bodyAt(frame, { el: 5, az: 40 }, AU_KM);
    const earth = bodyAt(frame, { el: 5, az: 40.9 }, 384400); // Earth radius is about 0.95 degrees: its edge crosses the Sun
    const r = sunFraction(frame, sun, earth, sky);
    expect(r.cover).toBeGreaterThan(0);
    expect(r.cover).toBeLessThan(1);
    expect(r.f).toBeCloseTo(1 - r.cover, 10);
  });
  it('the fast path gives exactly the same answer as sampling the disc, over 3000 random cases', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let mismatches = 0;
    for (let c = 0; c < 3000; c++) {
      const H = new Float32Array(SKY_BINS);
      let h = rnd() * 2 - 0.5;
      for (let i = 0; i < SKY_BINS; i++) { h += (rnd() - 0.5) * 0.15; H[i] = h; }
      const sky = makeSkyline({ H, D: new Uint16Array(SKY_BINS), grade: 'B', terrain: 'synthetic rough test terrain', heightM: 2 });
      const sun = bodyAt(frame, { el: rnd() * 6 - 2, az: rnd() * 360 }, AU_KM);
      const earth = bodyAt(frame, { el: rnd() * 12 - 4, az: rnd() * 360 }, 384400);
      const a = sunFraction(frame, sun, earth, sky);
      const b = sunFraction(frame, sun, earth, sky, true);
      if (a.f !== b.f || a.cover !== b.cover) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('Earth visibility', () => {
  it('needs the centre at or above the skyline plus the margin', () => {
    const sky = flatAt(1);
    expect(earthVisible(frame, bodyAt(frame, { el: 1.5, az: 0 }, 384400), sky)).toBe(true);
    expect(earthVisible(frame, bodyAt(frame, { el: 0.5, az: 0 }, 384400), sky)).toBe(false);
    expect(earthVisible(frame, bodyAt(frame, { el: 1.5, az: 0 }, 384400), sky, 1)).toBe(false);
  });
  it('on the smooth sphere Earth is visible just below level but not below the dip', () => {
    const sky = smoothSkyline(2);
    expect(earthVisible(frame, bodyAt(frame, { el: -0.05, az: 0 }, 384400), sky)).toBe(true);
    expect(earthVisible(frame, bodyAt(frame, { el: -0.12, az: 0 }, 384400), sky)).toBe(false);
  });
});
