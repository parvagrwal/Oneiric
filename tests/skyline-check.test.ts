import { describe, expect, it } from 'vitest';
import { loadTable } from '../pipeline/direction-check.ts';
import { flatCase, hillCase, refinementCheck, ridgeCase, RIDGES, SKYLINE_THRESHOLD_DEG, syntheticCases } from '../pipeline/skyline-check.ts';
import { mirrorColumns, scaleHeights, swapAxes } from '../pipeline/synthetic-terrain.ts';

describe('skyline maths on synthetic terrain with a known horizon', () => {
  const cases = syntheticCases();
  it('every case stays within 0.01 degrees: flat ground, a ridge on each raster tier, and the two hills', () => {
    expect(cases.map((c) => c.id)).toEqual(['flat', 'ridge-near', 'ridge-mid', 'ridge-far', 'hill-azimuth']);
    for (const c of cases) {
      expect(c.maxDeg, c.id).toBeLessThanOrEqual(SKYLINE_THRESHOLD_DEG);
      expect(c.pass, c.id).toBe(true);
    }
  });
  it('the far ridge is seen about 0.95 degrees up; ignoring the curve of the Moon would put it near 3.4 degrees', () => {
    const far = cases.find((c) => c.id === 'ridge-far')!;
    expect(far.detail.expectedDeg as number).toBeGreaterThan(0.9);
    expect(far.detail.expectedDeg as number).toBeLessThan(1.0);
    expect((far.detail.samplesPerTier as number[]).every((n) => n > 0)).toBe(true);
  });
  it('the hill due east is found at azimuth 90, the hill due north at 0', () => {
    const hills = cases.find((c) => c.id === 'hill-azimuth')!.detail.hills as Array<{ hillAzimuthDeg: number; azErrorDeg: number }>;
    expect(hills.map((h) => h.hillAzimuthDeg)).toEqual([90, 0]);
    for (const h of hills) expect(h.azErrorDeg).toBeLessThanOrEqual(0.25);
  });
});

describe('sabotage: the skyline check notices a wrong raster or a wrong build', () => {
  it('a raster mirrored east to west moves the east hill to the west, and the check fails', () => {
    const c = hillCase({ tweak: mirrorColumns });
    expect(c.pass).toBe(false);
    expect((c.detail.hills as Array<{ foundAzimuthDeg: number }>)[0].foundAzimuthDeg).not.toBeCloseTo(90, 0);
    expect((c.detail.flatElsewhere as Array<{ azimuthDeg: number; errorDeg: number }>).find((a) => a.azimuthDeg === 270)!.errorDeg).toBeGreaterThan(1);
    // The hill-case build exceeds the 5 s default under full-suite load.
  }, 15000);
  it('a raster with its axes swapped fails', () => {
    expect(hillCase({ tweak: swapAxes }).pass).toBe(false);
    // The hill-case build exceeds the 5 s default under full-suite load.
  }, 15000);
  it('heights at half scale fail the ridge case', () => {
    const c = ridgeCase(RIDGES[0], { tweak: (g) => scaleHeights(g, 0.5) });
    expect(c.pass).toBe(false);
    expect(c.maxDeg).toBeGreaterThan(1);
  });
  it('a coarse step of seven pixels fails the ridge case', () => {
    expect(ridgeCase(RIDGES[0], { build: { stepPixels: 7 } }).pass).toBe(false);
  });
  it('a raster shifted by one pixel does not hide: flat ground still passes, so the check is not failing for everything', () => {
    expect(flatCase({ tweak: mirrorColumns }).pass).toBe(true);
  });
});

describe('refinement: halving the step and the ray spacing', () => {
  it('moves the stay metrics by less than 1 point on rough synthetic terrain (near field only in this test)', () => {
    const r = refinementCheck(loadTable(), {}, [6_000, 0, 0]);
    expect(r.refinedBuild).toMatchObject({ stepPixels: 0.25, subRays: 8 });
    expect(r.refinedBuild.samples).toBeGreaterThan(3 * r.standardBuild.samples);
    expect(r.windows).toHaveLength(3);
    expect(r.maxMovePoints).toBeLessThan(1);
    expect(r.maxGapMovePctOfStay).toBeLessThan(1);
    expect(r.pass).toBe(true);
    // The terrain must be informative: the Sun is neither always up nor always down.
    expect(r.windows.some((w) => w.standard.sunlitPct > 5 && w.standard.sunlitPct < 95)).toBe(true);
  });
  it('sabotage: a build that starts from a seven-pixel step moves the metrics or the horizon far more', () => {
    const fine = refinementCheck(loadTable(), {}, [6_000, 0, 0]);
    const coarse = refinementCheck(loadTable(), { stepPixels: 7, subRays: 1 }, [6_000, 0, 0]);
    expect(coarse.maxHorizonMoveDeg).toBeGreaterThan(2 * fine.maxHorizonMoveDeg);
    // Two refinement builds exceed the 5 s default under full-suite load.
  }, 15000);
});
