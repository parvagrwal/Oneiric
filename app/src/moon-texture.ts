// The Moon picture on the 3D globe. It is a picture only: it never feeds a verdict, a metric, or a grade.
// Source: NASA Scientific Visualization Studio, CGI Moon Kit (svs.gsfc.nasa.gov/4720), 2K colour map,
// built from Lunar Reconnaissance Orbiter Camera wide-angle mosaics. Equirectangular, centred on 0° longitude.

export const MOON_TEXTURE_PAGE = 'https://svs.gsfc.nasa.gov/4720/';
export const MOON_TEXTURE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg';
export const MOON_TEXTURE_NAME = 'NASA SVS CGI Moon Kit · LROC colour map, 2K';

/**
 * Tried in order. The first is the public NASA URL. The second is an optional same-origin copy of the same file,
 * used only if the public URL cannot be loaded (for example when the host sends no cross-origin header);
 * it is not shipped with the repository. If both fail the globe stays a plain shaded sphere.
 */
export function moonTextureCandidates(): string[] {
  return [MOON_TEXTURE_URL, `${import.meta.env.BASE_URL}data/lroc_color_2k.jpg`];
}

export type SurfaceState = 'loading' | 'ready' | 'plain';
