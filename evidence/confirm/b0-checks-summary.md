# B0 checks — evidence summary

Run by Muse from the Muse VM, Sat 2026-11-14, ~22:53–23:00 IST. Raw outputs are in this folder. Copy this folder's contents into `~/oneiric/evidence/confirm/` when the repo exists (B0).

## B0.5.1 Horizons CORS — NO header, proxy needed

- Plan's command (`curl -sI`, HEAD) returns **HTTP 405 Method Not Allowed** — the Horizons API does not support HEAD, so that command cannot test CORS. Raw headers: `cors-headers.txt`.
- Re-test with a valid GET + `Origin: https://example.com` header: HTTP 200, real API response body (`API VERSION: 1.2`), **no `access-control` headers**. Raw headers: `cors-get-headers.txt`, body: `cors-get-body.txt`.
- Result: the browser cannot call Horizons directly. The Pages Function proxy (P1-1) is needed for any browser-side live check. Nothing in the P0 decision path is live, so this does not block B1–B5.

## B0.5.2 PGDA range requests — 206 confirmed

- 20 m DEM `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF`: HEAD with `Range: bytes=0-1023` → **HTTP 206 Partial Content**; GET with Range → `Content-Range: bytes 0-1023/2696082051`, 1024 bytes received. Total file size: **2,696,082,051 bytes**. Raw headers: `range-get-headers.txt`, body: `range-get-body.bin`.
- Verified file sizes (HEAD `Content-Length`):
  - 80 m DEM `LDEM_80S_80MPP_ADJ.TIF`: **189,158,392 bytes** (~180 MB)
  - 80 m hillshade `LDEM_80S_80MPP_ADJ_HILL.TIF`: **88,474,342 bytes** (~84 MB)
  - 240 m DEM `LDEM_60S_240MPP_ADJ.TIF`: **218,961,039 bytes** (~209 MB)
  - 40 m DEM `LDEM_80S_40MPP_ADJ.TIF`: 685 MB (page listing; fallback if PGDA is slow)
- Product page: `pgda-product-90.html` (HTTP 200, 30,348 bytes).
- Result: **geotiff.js can read windows of the 20 m file remotely. Skip the 2.6 GB download** (plan §4.2 item 6). Download only the 80 m DEM, 240 m DEM, and 80 m hillshade (~473 MB total). Fallback if remote reads prove slow in B3: download the 20 m file then.

## B0.5.3 Horizons azimuth convention — north-through-east confirmed

- Query: Sun (`COMMAND='10'`) from a lunar-surface observer at 0°E, 0°N (`CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='0,0,0'`), 2026-11-15 to 2026-12-15, 1-hour steps, `QUANTITIES='4'`, `APPARENT='AIRLESS'`. 721 epochs. Raw output: `azimuth-000.txt`.
- **Sunrise: between 2026-Nov-17 00:00 and 01:00 UTC, Sun azimuth 91.55°** (essentially due east).
- Sunset: between 2026-Dec-01 19:00 and 20:00 UTC, Sun azimuth 268.53° (essentially due west).
- Result: azimuth is measured north (0°) through east (90°), south (180°), west (270°). The engine's azimuth convention is confirmed.

## B0.6.1 Moon Trek South Pole layer — verified, tiles load cross-origin

- Layer: **LRO_LOLA_Shade_SPole75_30mp_v04** — LOLA DEM hillshade, S Pole 75°, 30 m/px. Covers all polar sites (all Artemis regions, IM-1, IM-2 are south of 75°S).
- Endpoint (WMTS, REST): `https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_Shade_SPole75_30mp_v04`
- Style: `default`. TileMatrixSet: `default028mm`. Zoom levels 0–6. Format: PNG.
- Tile URL template (from GetCapabilities): `https://trek.nasa.gov/tiles/Moon/SP/LRO_LOLA_Shade_SPole75_30mp_v04/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`
- Tile test: `.../1.0.0/default/default028mm/0/0/0.png` → HTTP 200, 14,982 bytes, valid 256×256 PNG. Raw tile: `tile-0-0-0.png`, headers: `tile-headers.txt`.
- **CORS: `Access-Control-Allow-Origin: *`** — tiles load cross-origin in the browser. The plan's open check is resolved: the B5 map can use this WMTS layer directly in OpenLayers.
- How found: Trek API page loads `config/config.json` → `listVisibleLayersUrl` (Solr `searchItems`, 490 south-pole layers) → `getLayerServices` by item UUID. Raw files: `trek-api.html`, `trekApi.js`, `trek-config.json`, `trek-sp-layers.json`, `trek-layer-services.json`, `trek-wmts-caps.xml`.
- Alternates: `LRO_LOLA_Shade_SPole45_100mp_v04` (wider, 100 m/px); `LRO_LOLA_Shade_SPole875_5mp_v04` (5 m/px, only within 87.5°S — misses Nobile, IM-1); `LRO_WAC_Mosaic_SPole60_100m_v02` (imagery basemap).

## B0.6.2 USGS Artemis region shapefiles — NOT obtained from this VM

- USGS page `https://www.usgs.gov/data/down-selected-artemis-iii-candidate-landing-site-navigational-grids` loads (HTTP 200 with a browser user-agent; 403 with default curl UA), but its download links are rendered by JavaScript — no download URL in the static HTML. Raw page: `usgs-artemis.html`.
- ScienceBase API search returns HTTP 403 from this VM, with and without a browser user-agent. Raw: `sciencebase-artemis.json`.
- Next step: open the USGS page in a real browser and download the shapefiles there; or use the plan's fallback in B3 (approximate centres read off QuickMap by hand, labelled approximate).

## Files in this folder

| File | What it is |
|---|---|
| `b0-checks-summary.md` | This file |
| `cors-headers.txt` | HEAD response headers (405 — Horizons has no HEAD) |
| `cors-get-headers.txt`, `cors-get-body.txt` | Valid GET + Origin, headers and body (no CORS header) |
| `pgda-product-90.html` | PGDA product 90 page (file list + sizes) |
| `range-get-headers.txt`, `range-get-body.bin` | Range GET, 206, 1024 bytes |
| `azimuth-000.txt` | Horizons Sun az/el at (0,0), 721 epochs |
| `trek-api.html`, `trekApi.js`, `trek-config.json` | Trek API page + JS + config |
| `trek-sp-layers.json` | 490 south-pole layers (Solr response) |
| `trek-layer-services.json` | WMTS endpoint for the hillshade layer |
| `trek-wmts-caps.xml` | GetCapabilities (style, TileMatrixSet, zooms) |
| `tile-0-0-0.png`, `tile-headers.txt` | Real tile + headers (CORS `*`) |
| `usgs-artemis.html`, `sciencebase-artemis.json` | USGS page + failed ScienceBase search |
