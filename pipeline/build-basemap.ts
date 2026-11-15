// Build the static hillshade basemap from the LOLA shaded-relief raster, and write its manifest.
//
//   npm run build:basemap
//
// The plan's order is static hillshade first, then the online tiles on top, because the static picture is the
// outage fallback: it needs no network. This script reads the LOLA hillshade raster named on the product page
// (LDEM_80S_80MPP_ADJ_HILL.TIF, 45 degree altitude and 45 degree azimuth) and writes one georeferenced image plus
// a manifest the app reads.
//
// If the raster is not present, nothing is written and the map reports the basemap as unavailable. A substituted
// image would look exactly like terrain and would be a false statement about a NASA product.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { haveLocalRaster, localRaster, openRasterAt, type Product } from './dem.ts';

export const BASEMAP_DIR = 'app/public/data/basemap';
export const MANIFEST_FILE = `${BASEMAP_DIR}/basemap.json`;

export const HILLSHADE_PRODUCT = 'LOLA 80 m south-polar hillshade (product 90)';
export const HILLSHADE_SOURCE =
  'NASA Planetary Geodesy Data Archive, product 90: LDEM_80S_80MPP_ADJ_HILL.TIF, "LDEM hillshade (45 deg altitude, 45 deg azimuth)"';

/** The hillshade raster described as a product, so the existing header check applies to it too. */
export const HILLSHADE: Product = {
  name: HILLSHADE_PRODUCT,
  file: 'LDEM_80S_80MPP_ADJ_HILL.TIF',
  url: 'https://pgda.gsfc.nasa.gov/products/90',
  pixelM: 80,
  maxDistM: Number.POSITIVE_INFINITY,
  reachM: 304_000,
};

/** Extent the image covers, metres: south polar stereographic at R = 1,737,400 m, +/- 304 km (80S to the pole — the raster is 7600 x 7600 px at 80 m). This is NOT the map view extent, which is +/- 457.44 km (75S, the Moon Trek layer). */
export const IMAGE_EXTENT_M: [number, number, number, number] = [-304_000, -304_000, 304_000, 304_000];

export interface BasemapManifest {
  image: string;
  width: number;
  height: number;
  extentM: [number, number, number, number];
  sourcePixelM: number;
  product: string;
  source: string;
  builtUtc: string;
  command: string;
  derivation: 'LOLA shaded relief';
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Encode 8-bit grayscale samples as a PNG. No dependency, so the pipeline stays as small as it is. */
export function encodeGrayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
  if (gray.length !== width * height) throw new RangeError(`expected ${width * height} samples, got ${gray.length}`);
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter type: none
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const encode = new TextEncoder();
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(encode.encode(type), 4);
    out.set(data, 8);
    const crcBuf = new Uint8Array(4 + data.length);
    crcBuf.set(encode.encode(type), 0);
    crcBuf.set(data, 4);
    view.setUint32(8 + data.length, crc32(crcBuf));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: grayscale
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** The manifest a build writes. Pure, so the test can check every field without a raster. */
export function basemapManifest(a: {
  image: string;
  width: number;
  height: number;
  sourcePixelM: number;
  builtUtc: string;
  command: string;
}): BasemapManifest {
  if (!(a.width > 0) || !(a.height > 0)) throw new RangeError('image dimensions must be positive');
  if (!(a.sourcePixelM > 0)) throw new RangeError('source pixel size must be positive');
  if (!Number.isFinite(Date.parse(a.builtUtc))) throw new RangeError('build date must be a UTC instant');
  if (!a.image) throw new RangeError('image name is required');
  return {
    image: a.image,
    width: a.width,
    height: a.height,
    extentM: IMAGE_EXTENT_M,
    sourcePixelM: a.sourcePixelM,
    product: HILLSHADE_PRODUCT,
    source: HILLSHADE_SOURCE,
    builtUtc: a.builtUtc,
    command: a.command,
    derivation: 'LOLA shaded relief',
  };
}

export const haveHillshadeRaster = (): boolean => haveLocalRaster(HILLSHADE);

async function main() {
  if (!haveHillshadeRaster()) {
    console.log(`No ${HILLSHADE.file} in data/ or data-raw/.`);
    console.log('Nothing was written. The map reports the static hillshade as unavailable and uses the online Moon Trek tiles.');
    console.log('To build it, place the LOLA hillshade from the product page in data/ and run this command again.');
    return;
  }
  const raster = await openRasterAt(HILLSHADE, localRaster(HILLSHADE));
  const { image, header } = raster;
  // Downsample to at most 2,048 px on the long side: the shipped picture stays a few MB and still shows the relief.
  const step = Math.max(1, Math.ceil(Math.max(header.width, header.height) / 2_048));
  const width = Math.floor(header.width / step);
  const height = Math.floor(header.height / step);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const bands = await image.readRasters({ window: [0, y * step, width * step, Math.min(header.height, y * step + 1)] });
    const band = bands[0] as ArrayLike<number>;
    for (let x = 0; x < width; x++) {
      const v = band[Math.min(band.length - 1, x * step)];
      gray[y * width + x] = v === undefined || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  mkdirSync(BASEMAP_DIR, { recursive: true });
  const file = 'south-pole-hillshade.png';
  writeFileSync(`${BASEMAP_DIR}/${file}`, encodeGrayPng(width, height, gray));
  const manifest = basemapManifest({
    image: file,
    width,
    height,
    sourcePixelM: raster.header.pixelM * step,
    builtUtc: new Date().toISOString(),
    command: 'npm run build:basemap',
  });
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${BASEMAP_DIR}/${file} (${width} x ${height}) and ${MANIFEST_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
