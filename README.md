# Oneiric

Oneiric compares lunar landing sites and dates. For a site and a date it will show when a mission has sunlight for power and a line of sight to Earth, and how many days of schedule slip that answer survives. It is for mission planners who must re-evaluate a site and date after a delay.

**Status:** the calculation engine, the Sun and Earth position tables, the direction check, the terrain skyline builder and a web preview are built. The skyline builder passes its check on synthetic terrain and has been run on the LOLA elevation rasters: the repository holds terrain skylines for all six polar sites at 2 m — four **grade B** (20 m near field) and two **grade C** (240 m only, where the 20 m raster does not cover the site). The three sites outside the south polar rasters are still **grade D** (smooth sphere, no terrain). There is no external deployment URL yet.

NASA data: JPL Horizons (Sun and Earth positions seen from the Moon, 2023 to 2040) is in use. The LOLA south-pole elevation rasters (20 m, 80 m and 240 m per pixel) are what the skyline builder reads; they are not in the repository, but the six shipped skylines are built from them.

## Proof: Sun and Earth directions match JPL Horizons

The engine computes where the Sun and Earth sit in the sky of a lunar surface point. We compare it with JPL Horizons site queries for eight points, about 500 dates each, 8,000 comparisons in all, using the angle between unit vectors.

| Check | Comparisons | Largest error | RMS error | Limit | Result |
|---|---|---|---|---|---|
| Sun and Earth direction against JPL Horizons | 8,000 | 0.0061° | 0.0028° | 0.02° | Pass |

- Sun alone: largest error 0.0002°. Earth alone: largest error 0.0061°.
- The Earth error is most likely stellar aberration, which Horizons includes and the hourly table does not. We have not verified that cause.
- Run it yourself: `npm run validate` writes `app/public/data/validation.json`.
- Evidence: `evidence/sun-earth-direction-check/` (command, raw output, saved result).
- The eight points include three equator points and two mid-latitude points that exist only to cover the geometry. They are test points, not landing sites.

## Proof: the terrain skyline maths

The skyline builder casts rays from a site across an elevation raster and records, for each 0.25° of azimuth, the highest elevation angle and the distance to the terrain that sets it. We check it on synthetic terrain whose horizon is known from a formula: flat ground at four array heights, a ridge at 5 km, 40 km and 150 km (one per raster resolution), and two hills that fix the compass directions.

| Check | Comparisons | Largest error | RMS error | Limit | Result |
|---|---|---|---|---|---|
| Skyline elevation on synthetic terrain | 10,084 | 0.0029° | 0.00055° | 0.01° | Pass |

- This checks the mathematics only. Synthetic terrain says nothing about whether the real rasters are read the right way round.
- Refinement: halving the ray step and doubling the rays per bin moved every 14-day metric by at most 0.22 percentage points (limit 1) on synthetic rough ground.
- Two checks have **not been run yet** because they need the LOLA rasters: the raster orientation check (Shackleton and Cabeus must be low ground at their catalogue coordinates) and the check that stored skyline files still match their build records. `npm run validate` lists both as pending, never as passed.
- Evidence: `evidence/terrain-skyline-check/`.

## What is in the repository

| Folder | What it holds |
|---|---|
| `engine/` | Pure TypeScript calculation: site frame, interpolation of the hourly table, terrain skyline builder, skyline lookup, sunlit fraction, Earth visibility, time series, metrics, verdict rules, slip tolerance. It imports nothing from Node or the browser, so one copy can run in the pipeline and in a Web Worker. |
| `pipeline/` | Node scripts that fetch Horizons responses, build the binary tables, read the elevation rasters, build the skylines, and run the checks. |
| `fixtures/` | Raw Horizons responses, saved exactly as received. |
| `tests/` | Unit tests, including deliberate-sabotage tests. |
| `evidence/` | For each finished step: the command, the raw output, and a saved result. |

## How to run it

You need Node 20 or later. The Horizons responses are already saved, so these commands need no network.

```bash
npm ci
npm run build:ephemeris   # raw responses -> app/public/data/ephem/<year>.bin
npm test                  # 118 tests
npm run typecheck
npm run validate          # direction and skyline checks -> app/public/data/validation.json
npm run mutation-check    # changes the engine one element at a time; every change must make a test fail

# Start the preview
cd app
npm ci
npm run dev -- --host 0.0.0.0
```

In the preview, focus the skyline view or its scrubber. Use **Left** and **Right** to move by 10 minutes, **Home** and **End** to jump to either end, and **Space** to play or pause.

### Building the terrain skylines

The skylines shipped with the repository were built with this step. To rebuild them, put the 80 m and 240 m files from the [LOLA south pole product page](https://pgda.gsfc.nasa.gov/products/90) in `data/` (about 400 MB together; the folder is ignored by Git). The 20 m file is 2.6 GB and is not downloaded: the builder reads the 15 km window it needs over the network. `data-raw/` is accepted as an alternative folder for any of the three files. A network read that fails is retried twice with backoff, and opening a raster over the network is retried the same way; if a raster still cannot be opened, the build stops and writes nothing instead of rebuilding sites from a coarser raster. If a build still stops on the network, re-run the same command — the skylines already built and the cached windows are kept.

- `LDEM_80S_20MPP_ADJ.TIF` (20 m per pixel, used out to 15 km) — read over the network
- `LDEM_80S_80MPP_ADJ.TIF` (80 m, 15 to 80 km) — in `data/`
- `LDEM_60S_240MPP_ADJ.TIF` (240 m, 80 to 450 km) — in `data/`

```bash
npm run build:skylines    # one skyline per site -> app/public/data/skylines/
npm run validate          # now also runs the orientation check and the stored-file check
```

Without local files the builder tries to read the windows it needs over the network. A site gets grade B when the 20 m raster covers its whole 15 km near field, grade C when only the 240 m raster is used, and stays grade D when no raster covers it. The builder stops with an error if a raster's header does not match the expected projection, pixel size or orientation.

The preview uses the derived files in `app/public/data/`: the 2023–2040 hourly tables, the draft site list, and the recorded validation row. To fetch the responses again, run `npm run fetch:ephemeris` and `npm run fetch:fixtures`. They send one request at a time with a pause between requests and save every raw response.

## How it computes

- **Frame:** the Moon's mean-Earth frame (`MOON_ME`, DE441 ephemeris), east-positive longitude, sphere radius 1,737.4 km.
- **Direction:** elevation and azimuth are computed from the site, not from the Moon's centre. For Earth the difference is about 0.26°.
- **Positions:** hourly Sun and Earth vectors from JPL Horizons, interpolated linearly. Times are UTC.
- **Sunlit fraction:** 64 sample points on the solar disc (true angular radius, about 0.27°). A sample counts if it is above the skyline and not behind Earth's disc. Dark means fraction below 0.01, which with 64 samples means no sample visible.
- **Earth visible:** Earth's centre is at or above the skyline plus a margin (default 0°).
- **Verdict:** GO when every rule is met and the start can slip 3 days or more later. MARGINAL when every rule is met but it can slip less than 3 days later. NO-GO when a rule fails. The card prints the rule that decided it. Days early are shown but never decide.
- **Rule presets:** 6.5-day sortie and 14-day lander. Both are illustrative, not agency requirements. The one-year stay has no verdict.
- **Terrain skyline:** 1,440 azimuth bins of 0.25°. Each bin takes the highest of 4 rays. A ray steps half a pixel at a time, on the 20 m raster to 15 km, the 80 m raster to 80 km and the 240 m raster to 450 km, and includes the Moon's curvature.
- **Fidelity grade:** B, C and D describe the terrain behind a result. B is the three-raster skyline with a complete 20 m near field. C is the 240 m raster alone. D is a smooth sphere with no terrain. A result is never shown without its grade.

## Limits

- No elevation model sees features smaller than its pixel. The 20 m LOLA product would not have seen the crater that Athena landed in on the IM-2 mission: Intuitive Machines said the lander came down 250 m from its target, and NASA said more than 400 m.
- Energy over a window is a sum over 10-minute steps. Near sunrise and sunset it can differ from the true integral by up to about half a step at each edge.
- The fixed vertical array has no facing direction in the project's source documents. The engine evaluates eight compass facings and reports the best one with its direction.

## Data and tools

- JPL Horizons API, no key needed. Raw responses are in `fixtures/horizons/`.
- LOLA south-pole elevation rasters from NASA's Planetary Geodesy Data Archive (product 90, "A New View of the Lunar South Pole from LOLA"). Not downloaded into the repository.
- `geotiff` (npm) reads the raster windows.
- AI tools were used for the plan, the code and this text. The full tool list belongs in the AI disclosure, which is not written yet. No AI model is part of the computation.
- Licence: Apache-2.0 for code (see `LICENSE`); data files are CC0 (see `DATA-LICENSE`).
