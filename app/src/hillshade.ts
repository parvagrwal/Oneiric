// The static hillshade basemap: the outage fallback that must be built before the online tiles, because it is the
// picture that still works when Moon Trek does not.
//
// What this file does and does not do. It reads the manifest the pipeline writes when a hillshade image exists, and
// it says plainly when none does. It never draws a substitute: a synthetic relief image would look exactly like
// terrain and would be a lie about a NASA product. With no image, the map falls back to the vector layers (site
// markers, region outlines, pole) over a plain background, and the caption says the basemap is unavailable.
import type { TileCoord } from './hillshade-types.ts';

export interface HillshadeManifest {
  /** File name under app/public/data/basemap/, for example `south-pole-hillshade.jpg`. */
  image: string;
  /** Image width and height in pixels. */
  width: number;
  height: number;
  /** Ground extent of the image, metres, as [minX, minY, maxX, maxY] in the south polar stereographic frame. */
  extentM: [number, number, number, number];
  /** Native pixel size of the source raster, metres. */
  sourcePixelM: number;
  /** NASA product the picture was made from, named exactly as the product page names it. */
  product: string;
  /** Where the product came from. */
  source: string;
  /** Date the image was made, so a reader can tell how old it is. */
  builtUtc: string;
  /** The command that made it, so a reader can remake it. */
  command: string;
  /** True when the image is a shaded relief of measured elevation, never a synthetic surface. */
  derivation: 'LOLA shaded relief';
}

export type HillshadeState =
  | { kind: 'available'; manifest: HillshadeManifest; url: string }
  | { kind: 'unavailable'; reason: string };

/** Ceiling on the manifest size, so a wrong file cannot be loaded as if it were a picture. */
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

/**
 * Decide what the map can show. `manifest` is the parsed JSON, or null when the file is absent. The URL is built
 * from `document.baseURI` so the same build works at a domain root and under a GitHub Pages sub-path.
 */
export function hillshadeState(manifest: HillshadeManifest | null, baseUri: string): HillshadeState {
  if (!manifest) {
    return {
      kind: 'unavailable',
      reason:
        'No static hillshade is shipped with this build: the LOLA elevation rasters it is made from are not in the repository. The map uses the online Moon Trek tiles instead, and the site markers and region outlines render without either.',
    };
  }
  const problems: string[] = [];
  if (!manifest.image || !/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(manifest.image)) problems.push('image name is missing or not an image file');
  if (!(manifest.width > 0) || !(manifest.height > 0)) problems.push('image dimensions are not positive');
  if (manifest.width * manifest.height * 4 > MAX_IMAGE_BYTES) problems.push('image is larger than the map will load');
  if (manifest.extentM.length !== 4 || !manifest.extentM.every((v) => Number.isFinite(v))) problems.push('extent is not four finite metres');
  if (!(manifest.sourcePixelM > 0)) problems.push('source pixel size is not positive');
  if (!manifest.product || !manifest.source) problems.push('product or source is not named');
  if (!manifest.builtUtc || !Number.isFinite(Date.parse(manifest.builtUtc))) problems.push('build date is missing or unreadable');
  if (!manifest.command) problems.push('the command that made it is not recorded');
  if (manifest.derivation !== 'LOLA shaded relief') problems.push('the image is not declared as LOLA shaded relief');
  if (problems.length > 0) return { kind: 'unavailable', reason: `The shipped hillshade manifest cannot be used: ${problems.join('; ')}.` };
  return { kind: 'available', manifest, url: new URL(`data/basemap/${manifest.image}`, baseUri).toString() };
}

/** Native ground resolution of the shipped image, metres per pixel. Printed next to the picture. */
export function hillshadeResolutionM(manifest: HillshadeManifest): number {
  const [minX, , maxX] = manifest.extentM;
  return (maxX - minX) / manifest.width;
}

/** One sentence for the map caption: what the picture is, its resolution, and its date. */
export function hillshadeCaption(state: HillshadeState): string {
  if (state.kind === 'unavailable') return state.reason;
  const { manifest } = state;
  return `Static shaded relief of the south pole, made from ${manifest.product} on ${manifest.builtUtc.slice(0, 10)} at ${hillshadeResolutionM(manifest).toFixed(0)} m per pixel. Offline: no network is needed for this picture.`;
}

/** The tile grid the static picture is drawn on: one image, one tile, covering the whole extent. */
export function hillshadeTiles(manifest: HillshadeManifest): TileCoord[] {
  return [{ z: 0, col: 0, row: 0, extentM: manifest.extentM, url: '' }];
}
