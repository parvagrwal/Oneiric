# Oneiric

Oneiric compares lunar landing sites and dates. For a site and a date it will show when a mission has sunlight for power and a line of sight to Earth, and how many days of schedule slip that answer survives. It is for mission planners who must re-evaluate a site and date after a delay.

**Status:** the calculation engine, the Sun and Earth position tables, the first check, and a smooth-sphere web preview are built. The preview loads the draft site library, UTC scenarios, clocks, a timeline, and basic metrics through a Web Worker. No terrain is used yet, so every preview result is **grade D** (smooth sphere, no terrain). There is no external deployment URL yet.

NASA data in this step: JPL Horizons (Sun and Earth positions seen from the Moon, 2023 to 2040). LOLA elevation data is not used yet; the terrain step comes next.

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

## What is in the repository

| Folder | What it holds |
|---|---|
| `engine/` | Pure TypeScript calculation: site frame, interpolation of the hourly table, skyline lookup, sunlit fraction, Earth visibility, time series, metrics, verdict rules, slip tolerance. It imports nothing from Node or the browser, so one copy can run in the pipeline and in a Web Worker. |
| `pipeline/` | Node scripts that fetch Horizons responses, build the binary tables, and run the checks. |
| `fixtures/` | Raw Horizons responses, saved exactly as received. |
| `tests/` | Unit tests, including deliberate-sabotage tests. |
| `evidence/` | For each finished step: the command, the raw output, and a saved result. |

## How to run it

You need Node 20 or later. The Horizons responses are already saved, so these commands need no network.

```bash
npm ci
npm run build:ephemeris   # raw responses -> app/public/data/ephem/<year>.bin
npm test                  # 74 tests
npm run typecheck
npm run validate          # direction check -> app/public/data/validation.json
npm run mutation-check    # changes the engine one element at a time; every change must make a test fail

# Start the smooth-sphere preview
cd app
npm ci
npm run dev -- --host 0.0.0.0
```

In the preview, focus the skyline view or its scrubber. Use **Left** and **Right** to move by 10 minutes, **Home** and **End** to jump to either end, and **Space** to play or pause.

The preview uses the derived files in `app/public/data/`: the 2023–2040 hourly tables, the draft site list, and the recorded validation row. To fetch the responses again, run `npm run fetch:ephemeris` and `npm run fetch:fixtures`. They send one request at a time with a pause between requests and save every raw response.

## How it computes

- **Frame:** the Moon's mean-Earth frame (`MOON_ME`, DE441 ephemeris), east-positive longitude, sphere radius 1,737.4 km.
- **Direction:** elevation and azimuth are computed from the site, not from the Moon's centre. For Earth the difference is about 0.26°.
- **Positions:** hourly Sun and Earth vectors from JPL Horizons, interpolated linearly. Times are UTC.
- **Sunlit fraction:** 64 sample points on the solar disc (true angular radius, about 0.27°). A sample counts if it is above the skyline and not behind Earth's disc. Dark means fraction below 0.01, which with 64 samples means no sample visible.
- **Earth visible:** Earth's centre is at or above the skyline plus a margin (default 0°).
- **Verdict:** GO when every rule is met and the start can slip 3 days or more later. MARGINAL when every rule is met but it can slip less than 3 days later. NO-GO when a rule fails. The card prints the rule that decided it. Days early are shown but never decide.
- **Rule presets:** 6.5-day sortie and 14-day lander. Both are illustrative, not agency requirements. The one-year stay has no verdict.
- **Fidelity grade:** B, C and D describe the terrain behind a result. D is a smooth sphere with no terrain. A result is never shown without its grade.

## Limits

- No elevation model sees features smaller than its pixel. The 20 m LOLA product would not have seen the crater that Athena landed in on the IM-2 mission: Intuitive Machines said the lander came down 250 m from its target, and NASA said more than 400 m.
- Energy over a window is a sum over 10-minute steps. Near sunrise and sunset it can differ from the true integral by up to about half a step at each edge.
- The fixed vertical array has no facing direction in the project's source documents. The engine evaluates eight compass facings and reports the best one with its direction.

## Data and tools

- JPL Horizons API, no key needed. Raw responses are in `fixtures/horizons/`.
- AI tools were used for the plan, the code and this text. The full tool list belongs in the AI disclosure, which is not written yet. No AI model is part of the computation.
- Licence: Apache-2.0 for code (see `LICENSE`); data files are CC0 (see `DATA-LICENSE`).
