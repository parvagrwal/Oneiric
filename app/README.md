# Oneiric app

The browser interface for Oneiric: pick a lunar landing site and a UTC landing date, and see when the mission has sunlight for power and a line of sight to Earth, what verdict the stay rules reach, and how many days of schedule slip that answer survives.

Live app: <https://oneiric-1jt.pages.dev/>

## Run it

```bash
npm ci
npm run dev -- --host 0.0.0.0
```

The app reads its data from `public/data/` (Sun and Earth position tables, terrain skylines, validation rows), which the root pipeline builds. No network is needed after `npm ci`, except for the Moon Trek basemap on the south-pole map, which loads online-only tiles. The Moon picture on the 3D globe ships in `public/data/lroc_color_2k.jpg`, so the globe works offline too; the public NASA URL is tried first and the shipped copy is the fallback.

## What is in here

- `src/App.tsx` — the scenario bar, the Compare board (up to four site cards), the Window Finder matrix, and the wiring to the engine Worker.
- `src/Hero.tsx` — the first screen: the slip-tolerance headline, the numbers strip, and the scenario summary.
- `src/MoonGlobe.tsx` — the 3D Moon view (React Three Fiber): one marker per site, Sun and Earth pointers from the cached Horizons table, a south-pole camera preset, and the 30-second Autopilot tour (`src/autopilot-script.ts`, `src/TourOverlay.tsx`). Navigation only; it changes no verdict, metric, or grade. Without WebGL the app shows a static site chart (`src/MoonStatic.tsx`) instead.
- `src/MapView.tsx` — the south-polar map (OpenLayers, stereographic projection): the 33 library sites, the nine USGS Artemis III candidate region outlines, and the Moon Trek LOLA shaded-relief basemap when online, over the shipped static hillshade (`public/data/basemap/south-pole-hillshade.png`).
- `src/WindowFinder.tsx` — the sites × landing dates matrix: one verdict cell per site and date, click to load, Shift-click to add a card, drag along a row to slip the date.
- `src/MethodDrawer.tsx` — the Method and checks drawer: what each check does, the recorded pass/fail rows from `validation.json`, per-quantity sources, and the limits the tool states out loud.
- `src/engine.worker.ts` — the calculation engine running in a Web Worker (the same `engine/` code the pipeline uses, so the app and the checks cannot drift apart).
- `src/heights-ui.ts` — the Observer height selector (0, 2, 10, 20 m); a height with no stored skyline runs the smooth sphere at grade D, labelled as such.
- `src/moon-texture.ts` — the Moon picture sources: the NASA SVS CGI Moon Kit URL first, then the shipped copy in `public/data/`.
- `public/data/` — the shipped data: ephemeris tables, terrain skylines and their index, site library, validation rows, and the Moon picture.

## Checks

```bash
npm run build   # typecheck + production build
npm run lint    # oxlint
```

The root README (`../README.md`) documents the calculation, the checks, and the known limits.
