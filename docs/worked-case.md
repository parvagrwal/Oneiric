# A 21-day slip that flips one site's verdict and not its neighbour's

Oneiric's compare board answers questions like "what if the launch slips a month?" This page walks through one real output of the search tool: a landing date where a three-week delay changes the verdict for one illustrative de Gerlache Rim 2 point, while the highest-point counterpart in the same rim keeps its GO.

Both roles are played by south-polar reference points built from the shipped 2 m skylines (grade B, LOLA 20 m + 80 m + 240 m). The dates are real 2028 epochs; the verdict rules are the tool's 6.5-day sortie preset, which is illustrative, not an agency requirement.

## The two sites

| Role | Site | Latitude | East longitude | Grade | Site elevation (above 1,737.4 km sphere) |
|---|---|---|---|---|---|
| The one that flips | de Gerlache Rim 2 centroid | −88.22998° | 295.37156° | B | −88.4 m |
| The one that holds | de Gerlache Rim 2 highest point | −88.58747° | 292.09202° | B | 1,765.2 m |

Both de Gerlache Rim 2 points are illustrative representative points derived from the USGS Artemis III candidate region (Oct 2024 list) outlines. They are not NASA-selected sites.

## What the tool says before and after a 21-day slip

| | 2028-09-05, 6.5-day sortie | 2028-09-26, 6.5-day sortie |
|---|---|---|
| centroid — verdict | GO | NO-GO |
| centroid — sunlit | 100.0 % | 28.3 % |
| centroid — longest dark gap | 0.0 h | 110.0 h |
| centroid — Earth visible | 100.0 % | 83.4 % |
| centroid — longest link gap | 0.0 h | 25.7 h |
| centroid — late-slip tolerance | 3.0 d | — (not viable) |
| highest — verdict | GO | GO |
| highest — sunlit | 100.0 % | 100.0 % |
| highest — Earth visible | 100.0 % | 100.0 % |
| highest — late-slip tolerance | 4.25 d | 10.5 d |

The deciding rules, verbatim from the tool:

- centroid at 2028-09-05: "Every rule is met, and the start can slip 3 days later."
- centroid at 2028-09-26: "Fails: sunlit at least 95% (got 28.3%)."
- highest at 2028-09-26: "Every rule is met, and the start can slip 10.5 days later."

## What blocks the Sun

The blocked stay (2028-09-26, centroid) has one long dark gap:

- Dark gap: 2028-09-26 00:00 UTC → 2028-09-30 13:58:07.5 UTC — 110.0 h (4.6 days).
- Mid-gap: 2028-09-28 06:59:03.75 UTC; the Sun's azimuth then is 128.85°, and the skyline at that azimuth sits 7.17° above the horizon.
- The terrain that sets that horizon is a ridge 0.3 km away, at latitude −88.2362°, east longitude 295.6219°.

A point 88 m below the sphere datum, with a ridge 0.3 km away setting the horizon 7.17° above the horizontal: the geometry is exactly what a smooth-sphere model misses, which is why this class of question cannot be answered without a terrain skyline. The highest point of the same rim sits 1.85 km above the centroid, looks over the same ridge, and never goes dark across the window.

## Where this came from, and how to reproduce it

The case was not hand-picked. `pipeline/find-worked-case.ts` scanned every shipped polar 2 m skyline (24 sites, grade B or C), every 6.5-day sortie start date in 2027–2029, for a 21-day shift that flips exactly one verdict of the pair. It found 97,542 (pair, date) candidates; the top fifteen tied at the top score (29), and the candidate above is the first listed, for 2028-09-05. That date ties twice in the list — with de-gerlache-rim-2-highest and again with malapert-massif-highest as the holding site — and both are reported by the tool, which chose neither by hand. The other tied dates are 2027-09-14, 2027-09-15, 2027-09-16, 2027-10-12, 2027-10-13, 2027-10-14, 2028-08-06, 2028-09-02, 2028-09-03, 2028-09-04, 2028-10-01, 2028-10-02, and 2029-08-25; the tool treats them as equally good examples.

```bash
npx tsx pipeline/find-worked-case.ts
```

The full raw output, including the machine-readable block for this case, is in `evidence/worked-case/output.txt`. The command above reads only repository files (ephemeris table, skylines, site library); it needs no network.

## Limits that apply here

- The sortie thresholds (sunlit ≥ 95 %, dark gap ≤ 6 h, Earth-visible ≥ 90 %, link gap ≤ 6 h) are illustrative, not agency requirements; they are editable in the app, and the verdict moves with them.
- Both sites are grade B points on 20 m pixels: the verdict says nothing about features smaller than 20 m, and the 0.3 km block is a ridge the 20 m product resolves, not a boulder field.
- The centroid's elevation of −88.4 m means it sits in a local depression; a real mission would carry its own local terrain survey, and the verdict could change.
- Mission hindcasts replay recorded events; this page replays a computed future window. It is an illustration of what the compare board shows, not a mission recommendation.
