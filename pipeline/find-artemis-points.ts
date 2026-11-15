// Derive the two illustrative points per Artemis III candidate region from the USGS outlines:
// the outline's area centroid and its highest 20 m pixel. Prints the points as JSON.
//   npm run artemis-points
// Input: data/A3_9regions-lonlat-simplified.geojson (USGS, "Down Selected Artemis III Candidate
// Landing Site Navigational Grids", DOI 10.5066/P1MEQ6UK), shipped in the repository.
// The 20 m raster is read over the network from PGDA; its windows are cached under data/dem-windows/.
// The points are illustrative, not NASA-selected sites; the site library labels them so.
import { readFileSync } from 'node:fs';
import { DEG, R_MOON_KM } from '../engine/constants.ts';
import { southPolarXY } from '../engine/terrain.ts';
import { failCleanlyOnNetworkError, openRaster, PRODUCTS, readWindow, type OpenRaster } from './dem.ts';

failCleanlyOnNetworkError();

const REGIONS_FILE = 'data/A3_9regions-lonlat-simplified.geojson';
const USGS_PAGE = 'https://www.usgs.gov/data/down-selected-artemis-iii-candidate-landing-site-navigational-grids';
const R_M = R_MOON_KM * 1000;
/** The existing Nobile Rim 2 reference point, independently sourced; it must fall inside its region outline. */
const NOBILE_RIM_2 = { lat: -84.20156, lon: 60.69989 };

interface Region { name: string; code: string; corners: [number, number][] } // corners are [lon, lat], lon in -180..180
interface LatLon { lat: number; lon: number }

/** Longitude/latitude from map metres: inverse south polar stereographic. Longitude comes back in -180..180. */
export function mapToLonLat(xM: number, yM: number): LatLon {
  const r = Math.hypot(xM, yM);
  return { lat: (2 * Math.atan(r / (2 * R_M))) / DEG - 90, lon: Math.atan2(xM, yM) / DEG };
}

/** Point in polygon, ray casting in lon/lat. No region crosses the antimeridian, so no wraparound handling. */
export function insidePolygon(lon: number, lat: number, poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Centroid of the corners as the mean of their unit vectors, the spherical centroid of the vertices. */
export function centroidOf(corners: [number, number][]): LatLon {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of corners) {
    const la = lat * DEG;
    const lo = lon * DEG;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const n = Math.hypot(x, y, z);
  return { lat: Math.asin(z / n) / DEG, lon: Math.atan2(y / n, x / n) / DEG };
}

/** Plain mean of the corner coordinates, a cross-check on the centroid. */
export function planarMean(corners: [number, number][]): LatLon {
  const lon = corners.reduce((s, c) => s + c[0], 0) / corners.length;
  const lat = corners.reduce((s, c) => s + c[1], 0) / corners.length;
  return { lat, lon };
}

/**
 * Area centroid of the outline: project the corners to south polar stereographic map metres, take the planar
 * polygon centroid, and convert back. The projection is conformal and its scale varies by under 1% across any
 * one region, so this is the outline's centroid to within metres. This is the shipped centroid.
 */
export function areaCentroid(corners: [number, number][]): LatLon {
  const pts = corners.map(([lon, lat]) => southPolarXY(lat, lon));
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  const a6 = 3 * a2;
  return mapToLonLat(cx / a6, cy / a6);
}

/** Surface distance in metres between two lon/lat points, haversine. */
export function surfaceDist(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(h));
}

function eastLon(lon: number): number {
  return lon < 0 ? lon + 360 : lon;
}

function readRegions(): Region[] {
  const raw = JSON.parse(readFileSync(REGIONS_FILE, 'utf8')) as {
    features: { properties: { Region: string; RegionCode: string }; geometry: { type: string; coordinates: number[][][] } }[];
  };
  return raw.features.map((f) => {
    if (f.geometry.type !== 'Polygon') throw new Error(`${REGIONS_FILE}: expected Polygon geometry`);
    const ring = f.geometry.coordinates[0];
    const corners = ring.slice(0, -1) as [number, number][];
    if (corners.length !== 4) throw new Error(`${f.properties.Region}: expected 4 corners, got ${corners.length}`);
    return { name: f.properties.Region, code: f.properties.RegionCode, corners };
  });
}

interface Highest { lat: number; lon: number; heightM: number; pixelsInside: number; nanInside: number }

/** The highest 20 m pixel inside the outline, scanning the raw pixel grid, never an interpolated height. */
async function highestPixel(raster: OpenRaster, region: Region): Promise<Highest> {
  const pts = region.corners.map(([lon, lat]) => southPolarXY(lat, lon));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const { pixelM, xEdgeM, yEdgeM, width, height } = raster.header;
  const left0 = (Math.min(...xs) - xEdgeM) / pixelM;
  const right0 = (Math.max(...xs) - xEdgeM) / pixelM;
  const top0 = (yEdgeM - Math.max(...ys)) / pixelM;
  const bottom0 = (yEdgeM - Math.min(...ys)) / pixelM;
  if (left0 < 0 || top0 < 0 || right0 > width || bottom0 > height) throw new Error(`${region.name}: outline reaches past the edge of the 20 m raster, the highest pixel cannot be trusted`);
  const left = Math.max(0, Math.floor(left0) - 1);
  const right = Math.min(width, Math.ceil(right0) + 1);
  const top = Math.max(0, Math.floor(top0) - 1);
  const bottom = Math.min(height, Math.ceil(bottom0) + 1);
  if (right - left < 2 || bottom - top < 2) throw new Error(`${region.name}: outline is outside the 20 m raster`);
  const grid = await readWindow(raster, [left, top, right, bottom]);
  let best: Highest = { lat: NaN, lon: NaN, heightM: -Infinity, pixelsInside: 0, nanInside: 0 };
  for (let row = 0; row < grid.height; row++) {
    const y = grid.yEdgeM - (row + 0.5) * grid.pixelM;
    for (let col = 0; col < grid.width; col++) {
      const x = grid.xEdgeM + (col + 0.5) * grid.pixelM;
      const { lat, lon } = mapToLonLat(x, y);
      if (!insidePolygon(lon, lat, region.corners)) continue;
      best.pixelsInside++;
      const z = grid.z[row * grid.width + col];
      if (!Number.isFinite(z)) {
        best.nanInside++;
        continue;
      }
      if (z > best.heightM) best = { ...best, lat, lon, heightM: z };
    }
  }
  if (!Number.isFinite(best.heightM)) throw new Error(`${region.name}: no usable 20 m pixel inside the outline`);
  return best;
}

async function main() {
  const regions = readRegions();
  if (regions.length !== 9) throw new Error(`${REGIONS_FILE}: expected 9 regions, got ${regions.length}`);
  const raster = await openRaster(PRODUCTS[0], true);
  if (!raster) throw new Error('the 20 m raster could not be opened locally or over the network');

  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const check = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    if (!pass) throw new Error(`check failed: ${name} — ${detail}`);
  };

  // The inverse projection must agree with the engine's forward projection, or every derived point is wrong.
  for (const region of regions) {
    const c = areaCentroid(region.corners);
    const p = southPolarXY(c.lat, c.lon);
    const back = mapToLonLat(p.x, p.y);
    const errM = Math.hypot(southPolarXY(back.lat, back.lon).x - p.x, southPolarXY(back.lat, back.lon).y - p.y);
    check(`projection round-trip, ${region.name}`, errM < 1, `round-trip error ${errM.toFixed(4)} m`);
  }

  const nobile = regions.find((r) => r.name === 'Nobile Rim 2');
  check(
    'the independently sourced Nobile Rim 2 point falls inside its region outline',
    !!nobile && insidePolygon(NOBILE_RIM_2.lon, NOBILE_RIM_2.lat, nobile.corners),
    `point ${NOBILE_RIM_2.lat}, ${NOBILE_RIM_2.lon}`,
  );

  const out = [];
  for (const region of regions) {
    const cent = areaCentroid(region.corners);
    const sph = centroidOf(region.corners);
    const planar = planarMean(region.corners);
    check(`centroid inside its outline, ${region.name}`, insidePolygon(cent.lon, cent.lat, region.corners), `centroid ${cent.lat.toFixed(5)}, ${cent.lon.toFixed(5)}`);
    // The two principled centroid definitions must agree on the ground. Degrees mislead near the pole (a
    // degree of longitude is metres there), so the comparison is in metres. A convention error would be tens
    // of kilometres off; definition differences are under a kilometre. The planar mean is reported for
    // transparency but is not a check: over a 67 km region this close to the pole it is skewed by longitude
    // convergence by over 4 km, so it cannot tell a definition difference from an error.
    const dSph = surfaceDist(cent, sph);
    check(`area and spherical centroids agree, ${region.name}`, dSph < 1000, `differ by ${dSph.toFixed(0)} m`);
    const high = await highestPixel(raster, region);
    check(`highest pixel inside its outline, ${region.name}`, insidePolygon(high.lon, high.lat, region.corners), `highest ${high.lat.toFixed(5)}, ${high.lon.toFixed(5)}`);
    check(`highest pixel height is plausible, ${region.name}`, high.heightM > -6000 && high.heightM < 9000, `${high.heightM.toFixed(1)} m`);
    check(`most pixels inside the outline hold data, ${region.name}`, high.nanInside < 0.05 * high.pixelsInside, `${high.nanInside} of ${high.pixelsInside} pixels without data`);
    out.push({
      region: region.name,
      code: region.code,
      centroid: { lat: +cent.lat.toFixed(5), eLon: +eastLon(cent.lon).toFixed(5) },
      centroidSpherical: { lat: +sph.lat.toFixed(5), eLon: +eastLon(sph.lon).toFixed(5) },
      centroidPlanar: { lat: +planar.lat.toFixed(5), eLon: +eastLon(planar.lon).toFixed(5) },
      highest: { lat: +high.lat.toFixed(5), eLon: +eastLon(high.lon).toFixed(5), heightM: +high.heightM.toFixed(1), pixelsInside: high.pixelsInside, nanInside: high.nanInside },
    });
  }

  console.log(
    JSON.stringify(
      {
        source: `USGS Artemis III candidate regions (Oct 2024 list), ${USGS_PAGE}`,
        points: 'outline centroid and highest 20 m pixel per region, both illustrative points, not NASA-selected sites',
        regions: out,
        checks,
      },
      null,
      2,
    ),
  );
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
