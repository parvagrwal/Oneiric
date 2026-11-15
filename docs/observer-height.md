# Adding an observer height

The app loads every terrain skyline it finds, at every height. Nothing in the code lists which heights exist, so a new height appears in the selector as soon as its files are in place. This page is the contract those files have to meet.

## What the selector offers

The observer-height selector lists four standard heights (0, 2, 10 and 20 m), every height that has a stored skyline, and the height in the link if it is not one of those. A height is marked **terrain at N sites** only when at least one skyline file at that height loaded. Every other height reads **no terrain skyline yet** and is selectable: choosing it runs the smooth sphere for every site and labels the card **grade D (smooth sphere, no terrain)**.

There is no interpolation and no nearest match. A request for 10 m when only 2 m files exist returns grade D, never the 2 m horizon. On smooth ground the horizon sits at −0.087° from a 2 m mast and −0.194° from a 10 m mast; borrowing one for the other would shift the horizon by about a tenth of a degree, a fifth of the Sun's diameter, with no label saying so. The rule is implemented once, in `engine/heights.ts`, and used by both the pipeline and the app.

## File layout

One binary skyline and one JSON record per site and height, plus one index for the app:

```text
app/public/data/skylines/
  <siteId>-<heightM>m.bin     e.g. connecting-ridge-10m.bin
  <siteId>-<heightM>m.json    e.g. connecting-ridge-10m.json
  index.json
```

- **`<siteId>`** is the `id` in `app/public/data/sites.json`, lowercase with hyphens. It must match exactly; a mismatch is treated as a site with no skyline at that height.
- **`<heightM>`** is the observer height above the terrain in whole metres, matching the `heightM` inside the `.bin` record. `2`, `10`, `20` and `0` are the standard set. Any whole number is accepted. `-` is the separator.
- **`.bin`** is 8,640 bytes: 1,440 little-endian float32 horizon elevations in degrees, followed by 1,440 little-endian uint16 distances to the blocking terrain in 10 m units. That is `SKYLINE_BYTES` in `engine/terrain.ts`.
- **`.json`** is the build record written by `pipeline/build-skylines.ts`. The app does not read it, but `npm run validate` checks the `.bin` against the checksums in it, and the sidecar is what makes a changed file traceable to its azimuth block.
- **`index.json`** is the only file the app reads to decide what exists.

## Index format

```json
{
  "generatedBy": "pipeline/build-skylines.ts",
  "skylines": [
    {
      "siteId": "connecting-ridge",
      "heightM": 10,
      "grade": "B",
      "terrain": "LOLA 20 m + LOLA 80 m + LOLA 240 m",
      "siteElevationM": -1234.5,
      "file": "connecting-ridge-10m.bin"
    }
  ]
}
```

One row per site and height. `heightM` must equal the height the `.bin` was built for; `grade` is `A`, `B`, `C` or `D` with the meanings in `engine/provenance.ts`; `terrain` is the list of rasters that supplied samples, and must not be the smooth-sphere label for any grade above D. `file` is the file name inside the same folder.

The app refuses an index that is not a list, or a row with no `siteId`, `heightM`, `grade`, `terrain`, `siteElevationM` or `file`, rather than reporting no terrain at all. A file listed in the index but missing from disk is counted and named in the **Method and checks** drawer, and that height is shown as unavailable. That combination is a broken build, not a height that has not been built.

## Building the files

`pipeline/build-skylines.ts` writes the `.bin`, the `.json` and `index.json` for every polar site. It needs the LOLA rasters in `data/` (or `data-raw/`), or reads the 20 m file over HTTP range requests.

```bash
# every polar site at 0, 2, 10 and 20 m
npm run build:skylines -- --heights 0,2,10,20

# one site, to check the pipeline first
npm run build:skylines -- --heights 0,2,10,20 --site connecting-ridge

# confirm the files, then report what each height changes
npm run validate
npm run height-report
```

`npm run height-report` prints, for every site with more than one stored height, the sunlit percentage, longest dark gap, Earth-visible percentage and longest link gap at each height, and the change from the lower height to the higher one. It reports values only, with no threshold and no pass mark. With a single height it says so and stops; it never fills a second column in.

## What is checked automatically

- `tests/heights.test.ts` — the resolver returns a skyline only at its exact height, refuses two records for one site and height, and refuses a height that is not a number.
- `tests/height-selector.test.ts` — writes a 10 m skyline into a temporary folder in this layout, then computes the same scenario at 2 m, 10 m and 20 m. It proves the 10 m files are used without any code change, that 20 m with no file returns the smooth sphere at grade D, and that a payload built for another height is refused rather than used.
- `tests/skyline-index.test.ts` — an index missing a file, a grade or a height is an error, not a silently empty list.
- `tests/heights-ui.test.ts` — the selector's wording offers a missing height and calls the fallback a smooth sphere at grade D.
- `npm run validate` — the shipped-skyline row re-hashes every `.bin` the index lists, at every height, against its record.

## Not done here

The 0, 10 and 20 m skylines for the 24 polar sites are not in the repository. Building them needs the LOLA rasters, which were not reachable from the environment this change was built in. Every code path above is in place and tested against files in this layout, so adding them is a build run plus a review, not a code change.
