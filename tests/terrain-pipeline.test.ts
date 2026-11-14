import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeArrayBuffer } from 'geotiff';
import { describe, expect, it } from 'vitest';
import { buildSkyline, demHeight, siteFrame, southPolarXY, TIER_LIMITS_M, type DemGrid, type Tier } from '../engine/index.ts';
import { R_MOON_KM } from '../engine/constants.ts';
import { checkHeader, openRasterAt, pixelWindow, PRODUCTS, siteWindow } from '../pipeline/dem.ts';
import { CRATERS, orientationCheck, type HeightAt } from '../pipeline/raster-orientation.ts';
import { buildGraded, readRecords, verifySkylineFiles, writeIndex, writeSkyline } from '../pipeline/skyline-files.ts';
import { surfaceDistM, syntheticDem } from '../pipeline/synthetic-terrain.ts';
import { runSkylineFileCheck } from '../pipeline/validate.ts';

const SITE = { id: 'test-site', name: 'Test site', lat: -85, eLon: 30 };
const NO_DATA = -32768;
const hillEast = syntheticDem('LOLA 20 m', 20, 7_000, SITE.lat, SITE.eLon, (rel) => 600 * Math.exp(-((Math.hypot(rel.eastM - 5_000, rel.northM) / 500) ** 2)));

function writeTiff(g: DemGrid, path: string, noDataAt: number[] = []) {
  const z = Float32Array.from(g.z);
  for (const k of noDataAt) z[k] = NO_DATA;
  const buf = writeArrayBuffer(z, {
    width: g.width, height: g.height,
    ModelPixelScale: [g.pixelM, g.pixelM, 0], ModelTiepoint: [0, 0, 0, g.xEdgeM, g.yEdgeM, 0], GDAL_NODATA: String(NO_DATA),
    GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32767, // projected, user-defined: stops the writer substituting a whole-globe default
  });
  writeFileSync(path, Buffer.from(buf));
}

describe('reading an elevation raster file', () => {
  const dir = mkdtempSync(`${tmpdir()}/oneiric-raster-`);
  writeTiff(hillEast, `${dir}/hill.tif`, [5, 6]);

  it('takes origin, pixel size and the no-data value from the file, and a hill east of the site ends up at azimuth 90', async () => {
    const r = await openRasterAt(PRODUCTS[0], `${dir}/hill.tif`);
    expect(r.header).toMatchObject({ width: hillEast.width, height: hillEast.height, pixelM: 20, xEdgeM: hillEast.xEdgeM, yEdgeM: hillEast.yEdgeM, noData: NO_DATA });
    const g = (await siteWindow(r, SITE.lat, SITE.eLon, `${dir}/cache`))!;
    expect(g.width).toBe(hillEast.width);
    expect(Number.isNaN(g.z[5]) && Number.isNaN(g.z[6])).toBe(true);
    const { x, y } = southPolarXY(SITE.lat, SITE.eLon);
    expect(demHeight(g, x + 1234, y - 987)).toBeCloseTo(demHeight(hillEast, x + 1234, y - 987), 4);
    const built = buildSkyline([{ dem: g, maxDistM: TIER_LIMITS_M[0] }], SITE.lat, SITE.eLon, 2);
    const top = built.H.indexOf(Math.max(...built.H));
    expect(Math.abs((top + 0.5) * 0.25 - 90)).toBeLessThanOrEqual(0.25);
    // Second read comes from the cached window and is identical.
    const again = (await siteWindow(r, SITE.lat, SITE.eLon, `${dir}/cache`))!;
    expect(Array.from(again.z.subarray(1000, 1100))).toEqual(Array.from(g.z.subarray(1000, 1100)));
  });

  it('gives no window for a site that is not on the raster', async () => {
    const r = await openRasterAt(PRODUCTS[0], `${dir}/hill.tif`);
    expect(await siteWindow(r, -69.37, 32.32, null)).toBeNull();
  });

  it('sizes the window for ground distance, not map distance: at 84 degrees south a 15 km ground distance maps past 15 km', () => {
    // South polar stereographic scale grows away from the pole, so the map distance of a ground point 15 km from
    // the site is longer than 15 km. The window must still contain it with room to interpolate, or the near field
    // looks incomplete and the skyline is wrongly downgraded. At Nobile Rim 2 a 14,999 m ground point north of
    // the site maps to 15,041 m; a window reaching only 15,020 m loses it.
    const header = { width: 30400, height: 30400, pixelM: 20, xEdgeM: -304000, yEdgeM: 304000, noData: null, geoKeys: {}, source: 'test' };
    const lat = -84.20156, lon = 60.69989;
    const { x, y } = southPolarXY(lat, lon);
    const win = pixelWindow(header, x, y, 15_000)!;
    const { up, north } = siteFrame(lat, lon, R_MOON_KM * 1000);
    const theta = 14_999 / (R_MOON_KM * 1000), cosT = Math.cos(theta), sinT = Math.sin(theta);
    const px = up[0] * cosT + north[0] * sinT, py = up[1] * cosT + north[1] * sinT, pz = up[2] * cosT + north[2] * sinT;
    const k = (2 * R_MOON_KM * 1000) / (1 - pz);
    const [left, top, right, bottom] = win;
    const col = ((k * py) - header.xEdgeM) / 20, row = (header.yEdgeM - (k * px)) / 20;
    expect(col).toBeGreaterThan(left + 1);
    expect(col).toBeLessThan(right - 1);
    expect(row).toBeGreaterThan(top + 1);
    expect(row).toBeLessThan(bottom - 1);
  });

  const fake = (res: [number, number], keys: Record<string, unknown> = {}) => ({
    getWidth: () => 10, getHeight: () => 10, getOrigin: () => [0, 0, 0], getResolution: () => [res[0], res[1], 0], getGDALNoData: () => null, getGeoKeys: () => keys,
  }) as unknown as Parameters<typeof checkHeader>[0];
  it('refuses a wrong pixel size, a file stored south-up, and a projection on another radius or pole', () => {
    expect(() => checkHeader(fake([40, -40]), 20, 'x')).toThrow(/pixel size is 40/);
    expect(() => checkHeader(fake([20, 20]), 20, 'x')).toThrow(/row 0 at the largest y/);
    expect(() => checkHeader(fake([20, -20], { GeogSemiMajorAxisGeoKey: 1_738_000 }), 20, 'x')).toThrow(/GeogSemiMajorAxisGeoKey/);
    expect(() => checkHeader(fake([20, -20], { ProjNatOriginLatGeoKey: 90 }), 20, 'x')).toThrow(/ProjNatOriginLatGeoKey/);
    expect(checkHeader(fake([20, -20], { GeogSemiMajorAxisGeoKey: 1_737_400, ProjNatOriginLatGeoKey: -90 }), 20, 'x').pixelM).toBe(20);
  });
});

describe('grades and shipped skyline files', () => {
  const coarse = syntheticDem('LOLA 240 m', 240, 40_000, SITE.lat, SITE.eLon, (rel) => 1_500 * Math.exp(-(((rel.distM - 20_000) / 3_000) ** 2)));
  const tiers: Tier[] = [{ dem: hillEast, maxDistM: TIER_LIMITS_M[0] }, { dem: coarse, maxDistM: Infinity }];

  it('is grade B when the 20 m raster covers the near field, with every raster used named as the terrain source', () => {
    const wide = syntheticDem('LOLA 20 m', 20, 15_500, SITE.lat, SITE.eLon);
    const g = buildGraded([{ dem: wide, maxDistM: TIER_LIMITS_M[0] }, { dem: coarse, maxDistM: Infinity }], SITE.lat, SITE.eLon, 2);
    expect(g.grade).toBe('B');
    expect(g.built.products).toEqual(['LOLA 20 m', 'LOLA 240 m']);
  });
  it('drops to grade C on the 240 m raster alone when the 20 m near field is incomplete, never B', () => {
    const g = buildGraded(tiers, SITE.lat, SITE.eLon, 2); // hillEast reaches only 7 km
    expect(g.grade).toBe('C');
    expect(g.built.products).toEqual(['LOLA 240 m']);
  });
  it('refuses to grade a site with neither a 20 m near field nor the 240 m raster', () => {
    expect(() => buildGraded([{ dem: syntheticDem('LOLA 80 m', 80, 30_000, SITE.lat, SITE.eLon), maxDistM: Infinity }], SITE.lat, SITE.eLon, 2)).toThrow(/no terrain grade/);
  });

  it('sabotage: changing one horizon height in one shipped file fails the check and names the file and the azimuth block', () => {
    const dir = mkdtempSync(`${tmpdir()}/oneiric-skylines-`);
    const rec = writeSkyline(dir, SITE, buildGraded(tiers, SITE.lat, SITE.eLon, 2), 'test-commit');
    expect(readFileSync(`${dir}/${rec.file}`).byteLength).toBe(8640);
    expect(rec).toMatchObject({ grade: 'C', terrain: 'LOLA 240 m', heightM: 2, bins: 1440, file: 'test-site-2m.bin' });
    expect(writeIndex(dir)).toBe(1);
    expect(readRecords(dir)).toHaveLength(1);
    expect(verifySkylineFiles(dir)).toEqual({ files: 1, problems: [] });
    expect(runSkylineFileCheck(dir)!.pass).toBe(true);

    const bytes = readFileSync(`${dir}/${rec.file}`);
    const bin = 492; // azimuth 123 degrees, inside the 120 to 130 degree block
    bytes.writeFloatLE(bytes.readFloatLE(bin * 4) + 0.05, bin * 4);
    writeFileSync(`${dir}/${rec.file}`, bytes);
    const row = runSkylineFileCheck(dir)!;
    expect(row.pass).toBe(false);
    expect((row.detail as { problems: string[] }).problems).toEqual(['test-site-2m.bin: contents differ from the build record in azimuth 120 to 130 degrees']);
  });
  it('reports nothing to check, instead of a pass, when no skyline is shipped', () => {
    expect(runSkylineFileCheck(mkdtempSync(`${tmpdir()}/oneiric-empty-`))).toBeNull();
  });
});

describe('raster orientation check on two named craters', () => {
  // Synthetic ground: a bowl 3 km deep at each crater's catalogue position, reaching level ground at the rim.
  const pits: HeightAt = (lat, lon) => CRATERS.reduce((z, c) => {
    const d = surfaceDistM(siteFrame(lat, lon, 1_737_400).up, siteFrame(c.latDeg, c.eLonDeg, 1_737_400).up) / 1000;
    return z - 3_000 * Math.max(0, 1 - (d / (c.diameterKm / 2)) ** 2);
  }, 0);
  it('uses the catalogue positions of Shackleton and Cabeus', () => {
    expect(CRATERS.map((c) => [c.name, c.latDeg, +c.eLonDeg.toFixed(2)])).toEqual([['Shackleton', -89.67, 129.78], ['Cabeus', -85.33, 317.87]]);
  });
  it('passes when the pits are where the catalogue says', async () => {
    const r = await orientationCheck(pits);
    expect(r.map((c) => c.pass)).toEqual([true, true]);
  });
  it('sabotage: fails for a raster mirrored in longitude, and for one rotated a quarter turn', async () => {
    expect((await orientationCheck((lat, lon) => pits(lat, 360 - lon))).some((c) => !c.pass)).toBe(true);
    expect((await orientationCheck((lat, lon) => pits(lat, lon + 90))).some((c) => !c.pass)).toBe(true);
  });
  it('fails, rather than passes, when a point has no height', async () => {
    expect((await orientationCheck(() => NaN)).every((c) => !c.pass)).toBe(true);
  });
});
