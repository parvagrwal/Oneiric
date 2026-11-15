// Read windows of the LOLA south polar elevation rasters (cloud-optimised GeoTIFFs from NASA Goddard's PGDA, product 90).
// Origin, pixel size and the no-data value are read from each file, never assumed. Each window is cached as raw
// 32-bit floats under data/, which is not shipped. A raster is read from data/ (or data-raw/) if it is there,
// otherwise over HTTP range requests from PGDA.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fromFile, fromUrl, type GeoTIFFImage } from 'geotiff';
import { R_MOON_KM } from '../engine/constants.ts';
import { demHeight, makeDemGrid, southPolarXY, TIER_LIMITS_M, type DemGrid } from '../engine/terrain.ts';

export interface Product { name: string; file: string; url: string; pixelM: number; maxDistM: number; reachM: number }

const PGDA = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp';
export const PRODUCT_PAGE = 'https://pgda.gsfc.nasa.gov/products/90';
/** Finest first. `reachM` is how far from the site the raster is read. */
export const PRODUCTS: Product[] = [
  { name: 'LOLA 20 m', file: 'LDEM_80S_20MPP_ADJ.TIF', url: `${PGDA}/LDEM_80S_20MPP_ADJ.TIF`, pixelM: 20, maxDistM: TIER_LIMITS_M[0], reachM: 15_000 },
  { name: 'LOLA 80 m', file: 'LDEM_80S_80MPP_ADJ.TIF', url: `${PGDA}/LDEM_80S_80MPP_ADJ.TIF`, pixelM: 80, maxDistM: TIER_LIMITS_M[1], reachM: 80_000 },
  { name: 'LOLA 240 m', file: 'LDEM_60S_240MPP_ADJ.TIF', url: `${PGDA}/LDEM_60S_240MPP_ADJ.TIF`, pixelM: 240, maxDistM: TIER_LIMITS_M[2], reachM: 450_000 },
];
/** Local raster folders, in the order they are checked. */
export const RASTER_DIRS = ['data', 'data-raw'] as const;
/** The folder a missing raster is reported against. */
export const RASTER_DIR = RASTER_DIRS[0];
export const WINDOW_DIR = 'data/dem-windows';

/** The local copy of a product, in the first folder that holds it; otherwise the path it would have in data/. */
export const localRaster = (p: Product) => RASTER_DIRS.map((d) => `${d}/${p.file}`).find((f) => existsSync(f)) ?? `${RASTER_DIR}/${p.file}`;
export const haveLocalRaster = (p: Product) => existsSync(localRaster(p));

export interface RasterHeader {
  width: number; height: number; pixelM: number; xEdgeM: number; yEdgeM: number;
  noData: number | null; geoKeys: Record<string, unknown>; source: string;
}

/** Read and check the georeferencing of a raster. Refuses anything that is not a north-up south polar stereographic grid on R. */
export function checkHeader(image: Pick<GeoTIFFImage, 'getWidth' | 'getHeight' | 'getOrigin' | 'getResolution' | 'getGDALNoData' | 'getGeoKeys'>, expectedPixelM: number, source: string): RasterHeader {
  const [xEdgeM, yEdgeM] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  if (!(rx > 0) || !(ry < 0)) throw new Error(`${source}: expected column 0 at the smallest x and row 0 at the largest y, got pixel steps ${rx}, ${ry}`);
  if (Math.abs(rx + ry) > 1e-6 * rx) throw new Error(`${source}: pixels are not square (${rx} by ${-ry})`);
  if (Math.abs(rx - expectedPixelM) > 1e-6 * expectedPixelM) throw new Error(`${source}: pixel size is ${rx} m, expected ${expectedPixelM} m`);
  const geoKeys = (image.getGeoKeys() ?? {}) as Record<string, unknown>;
  const mustBe = (key: string, want: number, tol: number) => {
    const v = geoKeys[key];
    if (typeof v === 'number' && Math.abs(v - want) > tol) throw new Error(`${source}: ${key} is ${v}, expected ${want}`);
  };
  mustBe('GeogSemiMajorAxisGeoKey', R_MOON_KM * 1000, 0.5);
  mustBe('GeogSemiMinorAxisGeoKey', R_MOON_KM * 1000, 0.5);
  mustBe('ProjNatOriginLatGeoKey', -90, 1e-9);
  mustBe('ProjStraightVertPoleLongGeoKey', 0, 1e-9);
  mustBe('ProjScaleAtNatOriginGeoKey', 1, 1e-12);
  mustBe('ProjFalseEastingGeoKey', 0, 1e-9);
  mustBe('ProjFalseNorthingGeoKey', 0, 1e-9);
  return { width: image.getWidth(), height: image.getHeight(), pixelM: rx, xEdgeM, yEdgeM, noData: image.getGDALNoData(), geoKeys, source };
}

export interface OpenRaster { product: Product; image: GeoTIFFImage; header: RasterHeader }

/** Open a raster file or URL and check its georeferencing. A remote open is retried: PGDA range requests
 * time out under load, and one failed request must not drop the whole raster. The header check is not
 * retried — a raster that fails it is wrong, not slow. */
export async function openRasterAt(p: Product, source: string): Promise<OpenRaster> {
  const remote = /^https?:/.test(source);
  const load = async () => {
    const tiff = remote ? await fromUrl(source) : await fromFile(source);
    return tiff.getImage(0);
  };
  const image = remote ? await readWithRetry(load, `${p.name} open`) : await load();
  return { product: p, image, header: checkHeader(image, p.pixelM, source) };
}

/** Open a product from data/ or data-raw/ or, failing that, remotely. Returns null if `remote` is false and the file is absent. */
export async function openRaster(p: Product, remote: boolean): Promise<OpenRaster | null> {
  if (haveLocalRaster(p)) return openRasterAt(p, localRaster(p));
  return remote ? openRasterAt(p, p.url) : null;
}

/**
 * Pixel window [left, top, right, bottom) that reaches `reachM` on the ground from map point (x, y), clipped to the
 * raster. Null if empty. South polar stereographic scale grows away from the pole — 1 + (r/2R)^2 at map radius r —
 * so a ground distance maps to a longer map distance. The reach is inflated by the scale at the far edge of the
 * window, plus two pixels so bilinear sampling still works at the edge. Without the inflation, a site away from
 * the pole loses the rim of its near field: at Nobile Rim 2 a 14,999 m ground distance maps to 15,041 m, past a
 * window that only reaches 15,020 m, and the skyline is wrongly downgraded.
 */
export function pixelWindow(h: RasterHeader, xM: number, yM: number, reachM: number): [number, number, number, number] | null {
  const rFarM = Math.hypot(xM, yM) + reachM;
  const scale = 1 + (rFarM / (2 * R_MOON_KM * 1000)) ** 2;
  const reach = reachM * scale + 2 * h.pixelM;
  const left = Math.max(0, Math.floor((xM - reach - h.xEdgeM) / h.pixelM));
  const right = Math.min(h.width, Math.ceil((xM + reach - h.xEdgeM) / h.pixelM));
  const top = Math.max(0, Math.floor((h.yEdgeM - (yM + reach)) / h.pixelM));
  const bottom = Math.min(h.height, Math.ceil((h.yEdgeM - (yM - reach)) / h.pixelM));
  return right - left >= 2 && bottom - top >= 2 ? [left, top, right, bottom] : null;
}

/**
 * Turn an escaping network failure into a clean exit. A failed request inside the GeoTIFF reader can surface
 * as an unhandled rejection, which crashes the process with a raw stack trace instead of reaching the caller's
 * catch. Every script that reads a raster over the network calls this once at the top: nothing is lost, the
 * work already done and the cached windows are kept, and re-running the same command continues where it stopped.
 */
export function failCleanlyOnNetworkError(): void {
  process.on('unhandledRejection', (e) => {
    console.error(`A network request failed (${(e as Error)?.message ?? e}). Nothing is lost: the work already done and the cached windows are kept. Re-run the same command to continue.`);
    process.exit(1);
  });
}

/**
 * Run an async read, retrying failures with backoff. PGDA range requests time out under load — a retry a second
 * later usually succeeds — so one failed fetch must not kill a build. After the last attempt the original error
 * is thrown, so a genuinely broken read still fails loudly instead of silently returning nothing.
 */
export async function readWithRetry<T>(fn: () => Promise<T>, label: string, attempts = 3, baseDelayMs = 1000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) {
        const waitMs = baseDelayMs * 2 ** i;
        console.error(`${label}: attempt ${i + 1} of ${attempts} failed (${(e as Error).message}); retrying in ${waitMs} ms`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw last;
}

/** Read one window as a DemGrid, from the cache if it is there. No-data pixels become NaN. */
export async function readWindow(r: OpenRaster, win: [number, number, number, number], cacheDir: string | null = WINDOW_DIR): Promise<DemGrid> {
  const [left, top, right, bottom] = win;
  const width = right - left, height = bottom - top;
  const cache = cacheDir ? `${cacheDir}/${r.product.file}.${left}-${top}-${right}-${bottom}.bin` : null;
  let z: Float32Array;
  if (cache && existsSync(cache)) {
    const b = readFileSync(cache);
    z = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  } else {
    const rasters = await readWithRetry(
      () => r.image.readRasters({ window: win, samples: [0] }),
      `${r.product.name} window ${left},${top}-${right},${bottom}`,
    );
    z = Float32Array.from((rasters as unknown as ArrayLike<number>[])[0]);
    const { noData } = r.header;
    if (noData !== null) for (let i = 0; i < z.length; i++) if (z[i] === noData) z[i] = NaN;
    if (cache) {
      mkdirSync(cacheDir!, { recursive: true });
      writeFileSync(cache, Buffer.from(z.buffer, z.byteOffset, z.byteLength));
    }
  }
  return makeDemGrid({
    name: r.product.name, pixelM: r.header.pixelM, width, height, z,
    xEdgeM: r.header.xEdgeM + left * r.header.pixelM, yEdgeM: r.header.yEdgeM - top * r.header.pixelM,
  });
}

/** The window of a product around a site, or null if the site is not on that raster. */
export async function siteWindow(r: OpenRaster, latDeg: number, lonDeg: number, cacheDir: string | null = WINDOW_DIR): Promise<DemGrid | null> {
  const { x, y } = southPolarXY(latDeg, lonDeg);
  const win = pixelWindow(r.header, x, y, r.product.reachM);
  if (!win) return null;
  const g = await readWindow(r, win, cacheDir);
  if (!Number.isFinite(demHeight(g, x, y))) return null;
  // A window hundreds of kilometres wide near the lunar south pole spans kilometres of relief. Less means the unit is wrong.
  if (g.z.length > 1_000_000 && r.product.reachM >= 100_000) {
    let lo = Infinity;
    for (const v of g.z) if (v < lo) lo = v;
    if (g.zMaxM - lo < 1000) throw new Error(`${r.header.source}: relief of only ${(g.zMaxM - lo).toFixed(1)} over the window; heights do not look like metres`);
  }
  return g;
}
