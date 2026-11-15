// The card's ranges row and its landing-error line: both are places where an unavailable number can be dressed up
// as a real one. The tests hold them to what the data supports.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEIGHT_ERROR_BY_PRODUCT,
  hasHeightErrorValue,
  heightErrorFor,
  horizonBand,
  landingCirclePoints,
  worstHorizonShiftDeg,
} from '../engine/index.ts';
import { decodeSkyline, makeSkyline } from '../engine/index.ts';

const side = JSON.parse(readFileSync('app/public/data/skylines/connecting-ridge-2m.json', 'utf8'));
const bytes = readFileSync('app/public/data/skylines/connecting-ridge-2m.bin');
const { H, D } = decodeSkyline(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const sky = makeSkyline({ H, D, grade: side.grade, terrain: side.terrain, heightM: side.heightM });

describe('a height error with no value produces no band', () => {
  it('every shipped product documents its error raster but carries no value yet', () => {
    // This is the honest state of the data in this checkout: the product pages name the error rasters, the rasters
    // themselves are not here, so sigmaZM is null for every entry.
    for (const [terrain, record] of Object.entries(HEIGHT_ERROR_BY_PRODUCT)) {
      expect(record.source).toMatch(/ERR\.TIF/);
      expect(record.sigmaZM).toBeNull();
      expect(hasHeightErrorValue(terrain)).toBe(false);
    }
  });

  it('a null sigma yields null bounds, never zero bounds', () => {
    const band = horizonBand(sky, 0, null);
    expect(band.sigmaDeg).toBeNull();
    expect(band.lowDeg).toBeNull();
    expect(band.highDeg).toBeNull();
    // Zero would read as "the horizon is known exactly", which is the opposite of what a missing error means.
    expect(band.lowDeg).not.toBe(0);
  });

  it('names the product for a shipped skyline, so the reader can tell what the error would belong to', () => {
    const error = heightErrorFor(sky.terrain);
    expect(error).not.toBeNull();
    expect(error!.product).toMatch(/LOLA \d+ m south-polar DEM/);
    expect(error!.retrievedUtc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('computes a band when a value is supplied, which is what a filled-in raster would enable', () => {
    const band = horizonBand(sky, 0, 1);
    expect(band.sigmaDeg).not.toBeNull();
    expect(band.lowDeg).toBeLessThan(band.horizonDeg);
    expect(band.highDeg).toBeGreaterThan(band.horizonDeg);
    const worst = worstHorizonShiftDeg(sky, 1);
    expect(worst).toBeGreaterThan(0);
    // The band is small for a 1 m error, which is the point: without the raster the reader cannot know this.
    expect(worst).toBeLessThan(10);
  });
});

describe('the 100 m circle', () => {
  const centre = { latDeg: -89.45, eLonDeg: 222.69 };

  it('gives eight points, distinct, each about 100 m from the centre', () => {
    const points = landingCirclePoints(centre);
    expect(points).toHaveLength(8);
    const keys = new Set(points.map((p) => `${p.latDeg.toFixed(6)},${p.eLonDeg.toFixed(6)}`));
    expect(keys.size).toBe(8);
    for (const p of points) expect(p.distanceM).toBeCloseTo(100, 0);
  });

  it('carries the azimuth convention the skyline ids use', () => {
    // A circle point's stored skyline, if one is built, is filed under `<centre>~circle-<az>`; the id must round the
    // same way on both sides or the app looks up a file that can never exist.
    const points = landingCirclePoints(centre);
    for (const p of points) {
      const id = `${'connecting-ridge'}~circle-${Number(p.azDeg.toFixed(2))}`;
      expect(id).toMatch(/~circle-\d+(\.\d+)?$/);
      expect(id).toBe(id.replace(/\.0+$/, ''));
    }
    expect(points.map((p) => p.azDeg)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it('has no stored skyline for any point in the shipped index, which is why none is computed', () => {
    const index = JSON.parse(readFileSync('app/public/data/skylines/index.json', 'utf8')) as {
      skylines: Array<{ siteId: string }>;
    };
    const points = landingCirclePoints(centre);
    for (const p of points) {
      const id = `connecting-ridge~circle-${Number(p.azDeg.toFixed(2))}`;
      expect(index.skylines.some((e) => e.siteId === id)).toBe(false);
    }
  });
});
