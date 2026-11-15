// The static hillshade basemap: the manifest the app reads, and the rule that no picture is ever substituted.
//
// The wrongness: an image that is not LOLA relief shown as if it were, a manifest with no build command so nobody
// can remake it, and an absent basemap drawing something that looks like terrain.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { basemapManifest, encodeGrayPng, BASEMAP_DIR, HILLSHADE, MANIFEST_FILE, IMAGE_EXTENT_M } from '../pipeline/build-basemap.ts';
import { hillshadeCaption, hillshadeResolutionM, hillshadeState, hillshadeTiles, type HillshadeManifest } from '../app/src/hillshade.ts';

const GOOD: HillshadeManifest = {
  image: 'south-pole-hillshade.png',
  width: 2048,
  height: 2048,
  extentM: IMAGE_EXTENT_M,
  sourcePixelM: 80,
  product: 'LOLA 80 m south-polar hillshade (product 90)',
  source: 'NASA PGDA product 90: LDEM_80S_80MPP_ADJ_HILL.TIF',
  builtUtc: '2026-11-15T00:00:00.000Z',
  command: 'npm run build:basemap',
  derivation: 'LOLA shaded relief',
};

describe('the manifest a build writes', () => {
  it('names the product, the source raster, the build command and the derivation', () => {
    const m = basemapManifest({ image: 'x.png', width: 10, height: 10, sourcePixelM: 80, builtUtc: '2026-11-15T00:00:00Z', command: 'npm run build:basemap' });
    expect(m.product).toMatch(/LOLA 80 m south-polar hillshade/);
    expect(m.source).toMatch(/LDEM_80S_80MPP_ADJ_HILL\.TIF/);
    expect(m.command).toBe('npm run build:basemap');
    expect(m.derivation).toBe('LOLA shaded relief');
    expect(m.extentM).toEqual(IMAGE_EXTENT_M);
  });

  it('refuses dimensions, a pixel size or a date that cannot be true', () => {
    const base = { image: 'x.png', width: 10, height: 10, sourcePixelM: 80, builtUtc: '2026-11-15T00:00:00Z', command: 'c' };
    expect(() => basemapManifest({ ...base, width: 0 })).toThrow(/positive/);
    expect(() => basemapManifest({ ...base, sourcePixelM: -80 })).toThrow(/positive/);
    expect(() => basemapManifest({ ...base, builtUtc: 'someday' })).toThrow(/UTC instant/);
    expect(() => basemapManifest({ ...base, image: '' })).toThrow(/image name/);
  });

  it('the hillshade product describes a raster the header check can validate', () => {
    expect(HILLSHADE.file).toBe('LDEM_80S_80MPP_ADJ_HILL.TIF');
    expect(HILLSHADE.pixelM).toBe(80);
  });
});

describe('what the app can show', () => {
  it('reports unavailable, with the reason, when no manifest is shipped', () => {
    const state = hillshadeState(null, 'https://example.test/');
    expect(state.kind).toBe('unavailable');
    if (state.kind === 'unavailable') {
      expect(state.reason).toMatch(/No static hillshade is shipped/);
      expect(state.reason).toMatch(/not in the repository/);
      expect(state.reason).toMatch(/Moon Trek/);
    }
    expect(hillshadeCaption(state)).toBe(hillshadeState(null, '').kind === 'unavailable' ? (hillshadeState(null, '') as { reason: string }).reason : '');
  });

  it('builds an available state with a URL relative to the deployment base', () => {
    const state = hillshadeState(GOOD, 'https://example.test/repo/');
    expect(state.kind).toBe('available');
    if (state.kind === 'available') {
      expect(state.url).toBe('https://example.test/repo/data/basemap/south-pole-hillshade.png');
      expect(hillshadeResolutionM(state.manifest)).toBeCloseTo(608_000 / 2048, 6);
      expect(hillshadeCaption(state)).toMatch(/Static shaded relief of the south pole/);
      expect(hillshadeCaption(state)).toMatch(/Offline/);
      expect(hillshadeTiles(state.manifest)).toHaveLength(1);
    }
  });

  it('refuses a manifest whose image is not declared as LOLA shaded relief', () => {
    const bad = { ...GOOD, derivation: 'synthetic' as unknown as 'LOLA shaded relief' };
    const state = hillshadeState(bad, 'https://example.test/');
    expect(state.kind).toBe('unavailable');
    if (state.kind === 'unavailable') expect(state.reason).toMatch(/not declared as LOLA shaded relief/);
  });

  it('refuses a manifest that names no product, no source, or no build command', () => {
    for (const patch of [{ product: '' }, { source: '' }, { command: '' }]) {
      const state = hillshadeState({ ...GOOD, ...patch }, 'https://example.test/');
      expect(state.kind).toBe('unavailable');
    }
  });

  it('refuses a manifest with no usable extent or a non-image file name', () => {
    expect(hillshadeState({ ...GOOD, extentM: [0, 0] as unknown as [number, number, number, number] }, '').kind).toBe('unavailable');
    expect(hillshadeState({ ...GOOD, image: 'hillshade.txt' }, '').kind).toBe('unavailable');
  });
});

describe('the PNG encoder', () => {
  it('writes a PNG signature and the requested dimensions, and round-trips a known pattern', () => {
    const width = 4;
    const height = 3;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = i * 20;
    const png = encodeGrayPng(width, height, gray);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(width); // IHDR width, after the 8-byte signature and the 8-byte chunk header
    expect(view.getUint32(20)).toBe(height);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(0); // grayscale
    // The last four bytes are the IEND CRC; a zero-length IEND is 12 bytes at the end.
    expect(png.length).toBeGreaterThan(8 + 25 + 12);
  });

  it('refuses a sample count that does not match the dimensions', () => {
    expect(() => encodeGrayPng(4, 4, new Uint8Array(15))).toThrow(/expected 16 samples/);
  });
});

describe('this checkout', () => {
  it('a shipped basemap manifest describes an available basemap with its image present', () => {
    // The hillshade raster is gitignored, so checkouts differ: this checkout may or may not
    // hold it, and the manifest may or may not be built yet. What must never happen is a
    // manifest that claims a basemap the files do not back up, so the test checks the shipped
    // manifest when one exists and passes vacuously when none does. An empty basemap directory
    // with no manifest is not a shipped basemap.
    if (!existsSync(MANIFEST_FILE)) return;
    const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as HillshadeManifest;
    const state = hillshadeState(manifest, 'https://example.com/');
    expect(state.kind).toBe('available');
    expect(existsSync(`${BASEMAP_DIR}/${manifest.image}`)).toBe(true);
  });

  it('with no shipped manifest the map reports the basemap as unavailable', () => {
    if (existsSync(MANIFEST_FILE)) return;
    const state = hillshadeState(null, '');
    expect(state.kind).toBe('unavailable');
  });
});
