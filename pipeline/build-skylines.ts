// Build the terrain skyline of every site at or south of 60 degrees south, from the LOLA rasters.
//   npm run build:skylines                      # 2 m height, every polar site
//   npm run build:skylines -- --heights 0,2,10,20 --site connecting-ridge
// Rasters are read from data/ (or data-raw/) when present, otherwise over HTTP range requests from PGDA.
// Nothing is written for a site whose build fails; a site with no skyline stays on the smooth sphere.
import { readFileSync } from 'node:fs';
import { engineVersion } from './engine-version.ts';
import { haveLocalRaster, openRaster, PRODUCT_PAGE, PRODUCTS, RASTER_DIR, siteWindow, type OpenRaster } from './dem.ts';
import { buildGraded, SKYLINE_DIR, writeIndex, writeSkyline, type SiteInfo } from './skyline-files.ts';
import type { Tier } from '../engine/terrain.ts';

export const SITES_FILE = 'app/public/data/sites.json';
export const POLAR_LIMIT_LAT = -60;

function args() {
  const a = process.argv.slice(2);
  const value = (flag: string) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  return { heights: (value('--heights') ?? '2').split(',').map(Number), only: value('--site'), local: a.includes('--local-only') };
}

async function main() {
  const { heights, only, local } = args();
  if (heights.some((h) => !(h >= 0))) throw new Error('--heights takes metres, for example 0,2,10,20');
  const sites = (JSON.parse(readFileSync(SITES_FILE, 'utf8')).sites as SiteInfo[]).filter((s) => s.lat <= POLAR_LIMIT_LAT && (!only || s.id === only));
  if (sites.length === 0) throw new Error('no matching site at or south of 60 degrees south');

  const rasters: OpenRaster[] = [];
  for (const p of PRODUCTS) {
    try {
      const r = await openRaster(p, !local);
      if (r) { rasters.push(r); console.log(`${p.name}: ${r.header.source} (${r.header.width} x ${r.header.height} pixels of ${r.header.pixelM} m)`); }
      else console.log(`${p.name}: not in data/ or data-raw/ and --local-only was given; skipped`);
    } catch (e) {
      console.log(`${p.name}: could not be opened (${(e as Error).message})`);
    }
  }
  if (rasters.length === 0) {
    console.error(`No elevation raster could be opened. Download the files listed at ${PRODUCT_PAGE} into ${RASTER_DIR}/:`);
    for (const p of PRODUCTS) console.error(`  ${p.url}${haveLocalRaster(p) ? '  (present)' : ''}`);
    console.error('No skyline was written. Every site stays on the smooth sphere, grade D.');
    process.exit(1);
  }

  const commit = engineVersion();
  const files = Object.fromEntries(PRODUCTS.map((p) => [p.name, { file: p.file, url: p.url }]));
  let failed = 0;
  for (const site of sites) {
    try {
      const tiers: Tier[] = [];
      for (const r of rasters) {
        const dem = await siteWindow(r, site.lat, site.eLon);
        if (dem) tiers.push({ dem, maxDistM: r.product.maxDistM });
      }
      for (const h of heights) {
        const t = Date.now();
        const g = buildGraded(tiers, site.lat, site.eLon, h);
        const rec = writeSkyline(SKYLINE_DIR, site, g, commit, files);
        console.log(`${site.id} at ${h} m: grade ${rec.grade}, ${rec.terrain}, horizon ${rec.horizonDeg.min.toFixed(2)} to ${rec.horizonDeg.max.toFixed(2)} deg, ` +
          `reached ${rec.distanceReachedKm.toFixed(0)} km, ${rec.raysEndedAtRasterEdge} rays ended at a raster edge, ${((Date.now() - t) / 1000).toFixed(1)} s -> ${rec.file}`);
      }
    } catch (e) {
      failed++;
      console.error(`${site.id}: no skyline written (${(e as Error).message})`);
    }
  }
  console.log(`index lists ${writeIndex(SKYLINE_DIR)} skylines in ${SKYLINE_DIR}/`);
  if (failed) process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
