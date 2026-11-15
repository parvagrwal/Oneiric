# Oneiric

Oneiric compares lunar landing sites and dates. For a site and a UTC landing date, you see when a mission has sunlight for power and a line of sight to Earth, what verdict your stay rules reach, and how many days of schedule slip that answer survives. It is built for mission planners who must re-evaluate a landing site and date after a delay, at $0 out-of-pocket cost.

**Status:** the calculation engine, the 2023–2040 Sun and Earth position tables, the terrain skyline builder, the Compare board, the Window Finder, the south-polar map, and the recorded-mission checks run in the repository preview. The library holds 33 lunar sites — south-polar reference points, Artemis III candidate regions (Oct 2024 list, each marked as an illustrative point, not a NASA-selected site), CLPS and international mission targets, and Apollo landmarks — plus custom latitude and longitude entry. Twenty-four south-polar sites ship with 2 m terrain skylines built from LOLA elevation rasters: 22 **grade B** (complete 20 m near field) and 2 **grade C** (240 m raster only, outside the 20 m tile). The 9 library sites outside the south-polar rasters and every custom coordinate run at **grade D** (smooth sphere, no terrain). Replaying the IM-2 landing instant shows the Sun 2.46° above the horizon at the recorded site (azimuth 65.69°), from the same cached table and 2 m skyline the app uses. There is no external deployment URL yet.

NASA data: JPL Horizons (Sun and Earth positions seen from the Moon, 2023 to 2040) and LOLA south-pole elevation rasters from NASA's Planetary Geodesy Data Archive (20 m, 80 m, and 240 m per pixel) drive the calculations. Raw LOLA rasters stay outside Git; the 24 shipped skylines and their verification checksums are in `app/public/data/skylines/`.

## How do we check the Sun and Earth directions?

The engine computes where the Sun and Earth sit in the sky of a lunar surface point. You can check it against JPL Horizons site queries for eight points, about 500 dates each, 8,000 comparisons in total, using the angle between unit vectors.

| Check | Comparisons | Largest error | RMS error | Limit | Result |
|---|---|---|---|---|---|
| Sun and Earth direction against JPL Horizons | 8,000 | 0.0061° | 0.0028° | 0.02° | Pass |

- Sun alone: largest error 0.0002°. Earth alone: largest error 0.0061°.
- The Earth error is likely stellar aberration, which Horizons includes and the hourly table does not. That cause is not verified yet.
- Run `npm run validate` to write `app/public/data/validation.json`.
- Evidence: `evidence/sun-earth-direction-check/` (command, raw output, saved result).
- The eight points include three equator points and two mid-latitude points that exist only to cover the geometry. They are test points, not landing sites.

## How do we check the terrain skylines?

The skyline builder casts rays from a site across an elevation raster and records, for each 0.25° of azimuth, the highest elevation angle and the distance to the terrain that sets it. Checks test the maths, the raster orientation, and the shipped binary files.

| Check | Comparisons | Largest error | RMS error | Limit | Result |
|---|---|---|---|---|---|
| Skyline elevation on synthetic terrain | 10,084 | 0.0029° | 0.00055° | 0.01° | Pass |
| Elevation raster orientation on Shackleton and Cabeus | 4 | — | — | Crater floor below rim and mirrored longitude | Pass |
| Shipped skylines match their build records | 24 | — | — | Exact 10° azimuth block checksums | Pass |

- Refinement on synthetic rough ground: halving the ray step and doubling the rays per bin moved every 14-day metric by at most 0.22 percentage points (limit 1).
- If you run `npm run validate` without the gitignored LOLA `.TIF` rasters in `data/`, the raster orientation check reports pending rather than passed.
- Evidence: `evidence/terrain-skyline-check/` and `app/public/data/validation.json`.

## How does it behave on recorded mission events?

The tool replays six recorded facts with the same engine the app uses. Tolerances were fixed on 2026-11-15, before the first run; a missed tolerance would stay in the results with its explanation instead of being tuned away. The run on 2026-11-15 passes all six:

| Recorded event | Reference | Result |
|---|---|---|
| Greatest eclipse, 14 Mar 2025 | NASA catalogue: 06:58:47 UTC at the Moon's centre | 06:59:00 UTC, +0.2 min (limit ±5 min) |
| Sun hidden at Blue Ghost's site, 14 Mar 2025 | Firefly imagery: fully hidden about 07:30 UTC, Sun back about 08:30 UTC | fraction 0.0000 at 07:30 UTC; back at 08:36:52.5 UTC (allowed 08:10–08:50 UTC) |
| Blue Ghost sunset, 16 Mar 2025 | Last contact 23:25 UTC, about 5 h after sunset | sunset 20:53:45 UTC, +2.48 h from 18:25 UTC (limit ±3 h) |
| Chandrayaan-3 sunset, Sep 2023 | ISRO: Pragyan parked 2023-09-02, Vikram 2023-09-04; sunset must be after the sleep date | first sunset 2023-09-04 07:26:52.5 UTC, 0.31 d after the sleep reference (grade C, LOLA 240 m) |
| SLIM, Jan 2024 | Landed with cells facing west; power returned 2024-01-28 | Sun azimuth 81.7° at landing, 276.7° on 2024-01-28 (east → west) |
| Chang'e-6, 2023–2040 | Far side: Earth never above the horizon | highest Earth elevation −32.79° at 2039-05-31, across 157,777 hourly epochs |

- Run it with `npx tsx pipeline/hindcast-checks.ts`, or as part of `npm run validate`; the results are recorded in `app/public/data/validation.json`.
- Mission hindcasts replay recorded events. They do not predict future missions.
- Evidence: `evidence/mission-hindcasts/`.

## What does a 21-day slip change?

`npx tsx pipeline/find-worked-case.ts` scanned every shipped polar skyline (24 sites, grade B or C) and every 6.5-day sortie start in 2027–2029, and found 97,542 cases where a 21-day shift flips exactly one verdict in a pair. The top-scoring example is walked through in `docs/worked-case.md`: at de Gerlache Rim 2 centroid the verdict flips GO → NO-GO (sunlit 100 % → 28.3 %), while the rim's highest point holds its GO and gains slip tolerance. Evidence: `evidence/worked-case/`.

## What is in the repository?

| Folder | What it holds |
|---|---|
| `engine/` | Pure TypeScript calculation: site frame, interpolation of the hourly table, terrain skyline builder, skyline lookup, sunlit fraction, Earth visibility, time series, stay metrics, rolling prefix-sum window evaluation, verdict rules, and slip tolerance. It imports nothing from Node or the browser, so one copy runs in the pipeline and in the Web Worker. |
| `app/` | React + TypeScript interface: Scenario bar with editable rule presets and URL sharing, grouped 33-site picker with custom Grade D coordinates, Compare board (up to four scenario cards side-by-side with CSV and JSON export), skyline and sky-track canvas, the Window Finder (`sites × landing dates` canvas matrix), a south-polar map (Moon Trek basemap, online only), and the Method and checks drawer that renders `validation.json`. |
| `pipeline/` | Node scripts that fetch Horizons responses, build the binary tables, read the elevation rasters, build the skylines, and run the checks. |
| `docs/` | Engineering notes, including the worked example of a 21-day slip (`docs/worked-case.md`). |
| `fixtures/` | Raw Horizons responses, saved as received. |
| `tests/` | Automated unit and integration tests (136 tests across 17 files), including deliberate-sabotage tests and bare-VM Worker parity checks. |
| `evidence/` | For each finished step: the command, the raw output, and a saved receipt. |

## How do you run it locally?

You need Node 20 or later. The Horizons responses and the 24 polar skylines at 2 m are already in the repository, so these commands need no network after `npm ci`.

```bash
npm ci
npm run build:ephemeris   # raw responses -> app/public/data/ephem/<year>.bin
npm test                  # 136 tests across 17 test files
npm run typecheck
npm run validate          # direction, skyline, stored-skyline and hindcast checks -> app/public/data/validation.json
npm run mutation-check    # changes 37 engine elements one at a time; every mutant must fail a test
npx tsx pipeline/hook-sun-elevation.ts   # Sun elevation at the recorded IM-2 landing instant
npx tsx pipeline/find-worked-case.ts     # scan 2027–2029 for 21-day verdict flips

# Start the web application
cd app
npm ci
npm run dev -- --host 0.0.0.0
```

In the web application:

- Add up to four sites on the **Compare board** and set a shared UTC landing date or per-card date overrides. Every control and custom coordinate is stored in the URL for **Share URL**. Each card carries **CSV** (the full 10-minute series) and **JSON** (scenario, metrics, dataset names, grade, engine commit and the shape-B Horizons query that reproduces the comparison) downloads, plus a **Horizons check** line when a cached Horizons query exists for that site.
- Click **Method and checks** (top bar or footer) to open the evidence drawer: what each check does, the recorded pass/fail rows from `validation.json` rendered as they are, per-quantity sources, the limits the tool states out loud, and how to reproduce the results.
- Scroll to the **Map** section for the south pole in stereographic projection: the 33 library sites, the nine USGS Artemis III candidate region outlines (simplified), and — when online — the Moon Trek LOLA shaded-relief basemap. Click a marker to load its site into the active card.
- Open **Edit rules** in the Scenario bar to adjust sunlit minimum, longest dark gap, Earth-visible minimum, longest link gap, stay length, or Earth elevation margin. All presets are labelled **illustrative, not agency requirements**.
- Enter custom `MOON_ME` latitude and longitude under **+ Custom**. Custom points use the smooth-sphere horizon dip and are always labelled **Grade D (smooth sphere, no terrain)**.
- Click any cell in the **Window Finder** (`Daily · 120 d` or `Weekly · 52 w`) to load that site and `00:00 UTC` landing date into the active card, **Shift+click** to open a new card, or drag horizontally along a row to slip the landing date.
- Focus the scrubber or Window Finder canvas for keyboard navigation (**Left** and **Right** step by 10 minutes on the scrubber or 1 column on the matrix; **Home**, **End**, **Space**, and **Enter** are supported).

Evidence for the Compare board and Window Finder verification is saved in `evidence/compare-board-and-window-finder/`. Evidence for the mission replays is in `evidence/mission-hindcasts/`, for the worked slip example in `evidence/worked-case/`, and for the south-polar map in `evidence/south-pole-map/`.

### How do you rebuild the terrain skylines?

To rebuild the skylines from scratch, place the 80 m and 240 m files from the [LOLA south pole product page](https://pgda.gsfc.nasa.gov/products/90) in `data/` (about 400 MB together; ignored by Git). The 20 m file is 2.6 GB and does not need to be downloaded in full: the builder reads the 15 km window around each site over HTTP range requests. `data-raw/` is also accepted. Failed network reads retry twice with backoff; if a raster still cannot be opened, the build stops and writes nothing instead of downgrading a site to a coarser raster.

- `LDEM_80S_20MPP_ADJ.TIF` (20 m per pixel, 0 to 15 km) — read over HTTP range requests or from `data/`
- `LDEM_80S_80MPP_ADJ.TIF` (80 m per pixel, 15 to 80 km) — in `data/`
- `LDEM_60S_240MPP_ADJ.TIF` (240 m per pixel, 80 to 450 km) — in `data/`

```bash
npm run build:skylines    # one skyline per polar site -> app/public/data/skylines/
npm run validate          # runs direction, synthetic terrain, orientation, and stored-file checks
```

## How does the calculation work?

- **Frame:** the Moon's mean-Earth frame (`MOON_ME`, DE441 ephemeris), east-positive longitude, sphere radius 1,737.4 km.
- **Direction:** elevation and azimuth are computed from the surface site, not from the Moon's centre. For Earth, topocentric parallax reaches about 0.26°.
- **Positions:** hourly Sun and Earth vectors from JPL Horizons, interpolated linearly in UTC.
- **Sunlit fraction:** 64 sample points on the solar disc (true angular radius, about 0.27°). A sample counts when it sits above the skyline and outside Earth's disc. Dark means sunlit fraction below 0.01 (zero visible samples out of 64).
- **Solar energy:** integrated over 10-minute steps in kWh/m² at 1,361 W/m² for three geometries: a vertical Sun-tracking mast, a fixed vertical array (best of 8 compass facings, facing printed), and a horizontal flat deck.
- **Earth visible:** Earth's centre sits at or above the skyline plus an elevation margin (default 0°).
- **Verdict and slip tolerance:** `viable(t)` is evaluated every 6 hours using rolling prefix sums over the 10-minute series, with 1-minute bisection at gap boundaries. Verdict precedence is `NO-GO > MARGINAL > GO`: **GO** when every rule passes and the landing can slip 3 days or more later, **MARGINAL** when every rule passes with less than 3 days of late slip, and **NO-GO** when a rule fails. Every card prints the deciding rule in one sentence, plus early/late slip or the next viable window.
- **Rule presets:** 6.5-day sortie (sunlit ≥ 95%, dark gap ≤ 6 h, Earth-visible ≥ 90%, link gap ≤ 6 h), 14-day lander (sunlit ≥ 80%, dark gap ≤ 24 h, Earth-visible ≥ 50%, link gap ≤ 48 h), and 365-day stay (annual figures and longest night only, no verdict). All presets are **illustrative, not agency requirements**, and editable.
- **Fidelity grades:** **B** is the three-tier LOLA skyline with a complete 20 m near field; **C** is the 240 m LOLA raster alone; **D** is a smooth sphere (`H = -acos(R / (R + h))`) with no terrain. Every visual prints its dataset source and fidelity grade.

## What is real versus illustrative?

| Element | Status | Source or guardrail |
|---|---|---|
| Sun and Earth positions (2023–2040) | Real NASA data | JPL Horizons `MOON_ME` vectors (`fixtures/horizons/`); checked across 8,000 comparisons (max error 0.0061°) |
| 24 polar skylines at 2 m (22 grade B, 2 grade C) | Real NASA data | LOLA south-pole DEMs (PGDA product 90: 20 m, 80 m, 240 m); verified by checksums in `app/public/data/skylines/` |
| 9 non-polar sites and custom coordinates | Smooth-sphere model | Marked **Grade D (smooth sphere, no terrain)** on every card, chart, and matrix row |
| Artemis III candidate regions (Oct 2024 list) | Illustrative representative points | Each point is labelled **illustrative point, not a NASA-selected site** |
| Verdict presets (sortie, lander, one-year stay) | Illustrative rules | Editable in the Scenario bar and labelled **illustrative, not agency requirements** |
| Mission hindcasts | Replay of six recorded events | NASA catalogue, Firefly mission log, ISRO statements; all six pass, tolerances fixed before the run (`app/public/data/validation.json`) |
| South-polar map basemap | Online NASA imagery only | Moon Trek `LRO_LOLA_Shade_SPole75_30mp_v04` (south pole); loads only with network access and is never used in any calculation |
| Multi-height skylines beyond 2 m | Not built yet | 2 m only; other heights run the smooth sphere at grade D, labelled as such |

## What are the known limits?

- No elevation model resolves features smaller than its pixel. The 20 m LOLA product would not have seen the crater where Athena came to rest on the IM-2 mission: Intuitive Machines reported landing 250 m from its target site, and NASA reported more than 400 m.
- Energy over a stay is a Riemann sum over 10-minute steps; near sunrise and sunset it can differ from the continuous integral by up to half a step at each edge.
- Multi-height terrain skylines beyond 2 m are not shipped yet, so the Scenario bar shows 2 m. Any other height (set by editing the shared link) runs the site as a smooth sphere at grade D, labelled as such, never as terrain.
- The static hillshade the map was planned to ship could not be produced in this build environment: the LOLA rasters stay gitignored and were not reachable. The map therefore shows the Moon Trek LOLA shaded-relief tiles in the south-pole stereographic projection — imagery from the same source rasters — and the basemap needs network access; the site markers, region outlines and pole marker render regardless.
- The cached Horizons check shown on a card covers that one site only, from the cached site query (three sites use a 500-epoch query, the other thirty a 24-epoch query spread across 2023–2040); a site without a cached query would say it is not cached, and no number is invented for it.
- Mission hindcasts replay recorded events; they do not predict future missions, and the presets are illustrative, not agency requirements.

## Data, tools, and licences

- JPL Horizons API (no key required); raw responses are in `fixtures/horizons/`.
- LOLA south-pole elevation rasters from NASA's Planetary Geodesy Data Archive (product 90, "A New View of the Lunar South Pole from LOLA").
- Artemis III 9 candidate region outlines from USGS Astrogeology ScienceBase (`data/A3_9regions-lonlat-simplified.geojson`).
- `geotiff` (npm) reads GeoTIFF windows in the offline Node pipeline; React, TypeScript, and Vite power the static browser client.
- AI tools were used for planning, code, and documentation; the full tool list will appear in the submission AI disclosure. No AI model runs in the calculation engine or browser application.
- Licences: Apache-2.0 for code (`LICENSE`); CC0 for derived data files (`DATA-LICENSE`).
