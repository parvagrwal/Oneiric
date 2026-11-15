// Ranges on a horizon: the shift is the stated height error divided by the distance to the terrain, and a range is
// never shown without a stated error.
//
// The wrongness: a band invented from a round number, applied identically to a near ridge and a far one, or shown
// for a product whose error is not on file.
import { describe, expect, it } from 'vitest';
import {
  DEG,
  hasHeightErrorValue,
  heightErrorFor,
  horizonBand,
  horizonShiftDeg,
  makeSkyline,
  shiftedSkyline,
  SKY_BINS,
  smoothSkyline,
  worstHorizonShiftDeg,
} from '../engine/index.ts';

function constructed(horizonDeg: number, distanceKm: number) {
  return makeSkyline({
    H: new Float32Array(SKY_BINS).fill(horizonDeg),
    D: new Uint16Array(SKY_BINS).fill(Math.round((distanceKm * 1000) / 10)),
    grade: 'B',
    terrain: 'constructed terrain',
    heightM: 2,
  });
}

describe('the horizon shift is sigma / D', () => {
  it('a 1 m height error at 1 km subtends 0.0573 degrees', () => {
    expect(horizonShiftDeg(1, 1)).toBeCloseTo((1 / 1000) / DEG, 12);
    expect(horizonShiftDeg(1, 1)).toBeCloseTo(0.0573, 4);
  });

  it('the same error at 100 km subtends a hundredth as much', () => {
    expect(horizonShiftDeg(1, 100)).toBeCloseTo(horizonShiftDeg(1, 1) / 100, 14);
  });

  it('a smooth sphere records no distance, so the shift is zero and no terrain is implied', () => {
    const smooth = smoothSkyline(2);
    expect(worstHorizonShiftDeg(smooth, 5)).toBe(0);
    const band = horizonBand(smooth, 90, 5);
    expect(band.sigmaDeg).toBe(0);
    expect(band.lowDeg).toBe(band.highDeg);
  });

  it('refuses a negative height error instead of reading it as no uncertainty', () => {
    expect(() => horizonShiftDeg(-1, 10)).toThrow(RangeError);
  });
});

describe('a range needs a stated error', () => {
  it('an unknown error value gives an unknown band, not a zero band', () => {
    const band = horizonBand(constructed(5, 4), 90, null);
    expect(band.sigmaDeg).toBeNull();
    expect(band.lowDeg).toBeNull();
    expect(band.highDeg).toBeNull();
    expect(band.horizonDeg).toBeCloseTo(5, 6);
  });

  it('every shipped product today reports no value, because no error raster has been read', () => {
    // This is a state of the data, not of the code. When an error raster is read the flag flips with no code change,
    // and this test is updated with the measured value rather than a guessed one.
    for (const terrain of ['LOLA 20 m + LOLA 80 m + LOLA 240 m', 'LOLA 240 m']) {
      const e = heightErrorFor(terrain);
      expect(e).not.toBeNull();
      expect(e!.source).toMatch(/ERR\.TIF/);
      expect(hasHeightErrorValue(terrain)).toBe(false);
    }
  });

  it('a product with no error record at all is named as having none', () => {
    expect(heightErrorFor('none (smooth sphere)')).toBeNull();
  });

  it('the shifted skyline moves every bin outward by its own bin distance, and keeps its grade', () => {
    const H = new Float32Array(SKY_BINS);
    const D = new Uint16Array(SKY_BINS);
    for (let i = 0; i < SKY_BINS; i++) {
      H[i] = 1;
      D[i] = i < SKY_BINS / 2 ? 100 : 2000; // 1 km, then 20 km
    }
    const sky = makeSkyline({ H, D, grade: 'B', terrain: 'constructed terrain', heightM: 2 });
    const up = shiftedSkyline(sky, 2);
    expect(up.grade).toBe('B');
    expect(up.H[0]).toBeCloseTo(1 + horizonShiftDeg(2, 1), 5);
    expect(up.H[SKY_BINS - 1]).toBeCloseTo(1 + horizonShiftDeg(2, 20), 5);
    // The near half moves twenty times as far as the far half. D is stored in 10 m units, so the ratio carries
    // that quantisation: 1.000 km against 20.000 km, not 1.0000375.
    expect((up.H[0] - 1) / (up.H[SKY_BINS - 1] - 1)).toBeCloseTo(20, 2);
  });

  it('the pessimistic shift lowers the horizon and the optimistic one raises it', () => {
    const sky = constructed(1, 5);
    expect(shiftedSkyline(sky, 3).H[0]).toBeGreaterThan(sky.H[0]);
    expect(shiftedSkyline(sky, -0).H[0]).toBe(sky.H[0]);
  });
});
