# Independent check of Oneiric's terrain sunlight against published LOLA illumination figures

Date: 2026-11-15. The Sun and Earth directions were already checked against JPL Horizons, and the skyline geometry against synthetic terrain — but the sunlit fraction over real terrain had never been compared with published figures. This check closes that gap for Connecting Ridge.

## Verdict

**The engine matches published LOLA-based illumination figures at the sub-1-point level.** At the four published Gläser et al. (EPSC 2014) spots on Connecting Ridge, run at the published coordinates and heights, Oneiric's mean visible solar-disc fraction is within 0.15–0.62 percentage points of the published average illumination, its fraction of time with any sunlight is within 0.29–0.65 points of the published time-in-light, the longest dark period agrees within 0.04–0.22 days, and the longest light period within 0.04–0.44 days. All differences are smaller than the published inter-tool spread (~3 points, De Rosa et al. 2012) and smaller than the year-to-year spread caused by the 18.6-year nodal cycle (1.6–2.4 points). The engine is consistently 0.15–0.65 points *below* the published values on both illumination metrics — a small one-sided bias, plausibly from the different averaging window (18.0 years here vs the paper's 19–20 years, dates unstated) and/or the newer LOLA DEM adjustment, but the cause is not isolated.

Two caveats: (1) the match is at the published *spot coordinates*, 50–320 m from Oneiric's own Connecting Ridge point, which sits in a local dip and scores far lower (63.78% vs 87.65% at 2 m) — point illumination at the pole is hyper-local, so this validation does not transfer to other points by proximity; (2) no coordinate-matched published figure exists for any other Oneiric site, so the remaining 32 sites are validated only by the shared method, not by a direct comparison.

## Published figures

Gläser, P., Scholten, F., De Rosa, D., Figuera, R.M., Oberst, J., Mazarico, E., Neumann, G.A., Robinson, M.S. (2014), "Connecting Ridge — A landing site at the lunar south pole with extended illumination", *European Planetary Science Congress 2014*, Vol. 9, EPSC2014-136-1. Full 2-page text read at <https://elib.dlr.de/id/eprint/94242/contents>. Companion journal paper: Gläser et al. 2014, *Icarus* 243, 78–90, DOI 10.1016/j.icarus.2014.08.013.

- **Method (as stated):** horizon method; observer on an adjusted south-polar LOLA DTM, 20 m/pixel; horizon elevation in azimuth steps of 0.5°; the Sun treated as a disc, so partial illumination counts. 1-hour time steps.
- **Window:** the abstract says "19 years exceeding the lunar precessional cycle of 18.6 years"; the Results section and both figure captions say "over 20 years". **No start/end dates are given anywhere.** The comparison therefore cannot reproduce the window exactly; a 19/20-year mean spanning the precession cycle is the closest reproducible target.
- **Definitions (as stated):** two metrics, not to be conflated. Øill ("average illumination") = time-average visible fraction of the solar disk. "% of time in light" = fraction of time with sunlight; the text equates it with "not in complete darkness" ("spot 1 is in light for 92% of the time and consequently only 8% in complete darkness"), i.e. **any part of the disk visible**.
- **Values (table + text, read directly):**

| Spot | Coordinates (as published) | h | Øill (avg illumination) | % of time in light | Longest dark / light |
|---|---|---|---|---|---|
| 1 | 89.4395°S, 222.8066°E | 2 m | **88.1%** | 92% | 4.58 d / 233.87 d |
| 2 | 89.4399°S, 222.8524°E | 2 m | **87.9%** | 92.3% | 4.62 d / 233.87 d |
| 3 | 89.4516°S, 222.7581°E | 10 m | **92.5%** | 95.6% | 3.08 d / 262.42 d |
| 4 | 89.4544°S, 222.8445°E | 10 m | **91.9%** | 95.66% | 3.17 d / 262.42 d |

Spots 3 and 4 are 90 m apart (stated in text). Distances from Oneiric's `connecting-ridge` point (−89.45, 222.69°E): spot 1 = 0.32 km, spot 2 = 0.31 km, spot 3 = 0.05 km, spot 4 = 0.14 km.

Secondary context (not the comparison target): Mazarico et al. 2011, *Icarus* 211, 1066–1081, DOI 10.1016/j.icarus.2010.10.030; Barker et al. 2021, *Planetary and Space Science* 203, 105119 (exact 2024–2026 window; 1st-percentile ensemble bounds 67–71% at 1 m and 83–89% at 5 m — the engine's 2 m value at spot 2 over that window, 87.74%, falls between them, toward the top, as expected for an intermediate height at a maximum point); De Rosa et al. 2012, *Planetary and Space Science* 74, 224–246 (two independent tools agree to <4 points on the same points — the published inter-tool spread used as the agreement bar here). Nothing coordinate-matched was found for Haworth, Slater Plain, Nobile, Mons Mouton, or Malapert.

## How the engine was driven

Skylines for the four published spots were built with the pipeline's own builder (PGDA 20 m remote + local 80 m/240 m), all grade B, 0 rays at a raster edge. The driver (`illumination-check.ts` in this folder) uses the engine's own code path (`series` + per-step definitions) and reports five definitions of "sunlit" from the same samples: **meanDisc** (mean visible fraction of the solar disc, the engine's `sunlitPct`), **anyDisc** (% of steps with any part of the disc visible), **halfDisc** (≥ half the disc), **centreAbove** (Sun's centre above the terrain horizon), **fullDisc** (≥ 99% of the disc); **darkGap** is the longest run with sunF < 0.01, **lightAny** the longest run with sunF > 0. Step resolution 10 min, no 1-minute refinement.

**Driver validation:** the driver reproduces the height-report number exactly — Connecting Ridge, 2 m, 6.5-day sortie from 2027-03-01: meanDisc 36.78%, dark gap 23.17 h. Step sensitivity for a 365-day window (10-min vs 30-min vs 60-min steps) differs by ≤ 0.05 points on every definition. Ephemeris coverage 2023–2040 (hourly Horizons tables); the longest window available is 18.0 years (2023-01-01 + 6575 d), 0.6 years short of a full 18.6-year nodal cycle.

**Engine runs** (18-year window, 10-min steps, 946,800 samples each; full outputs in `runs/`):

| Spot | h | meanDisc | anyDisc | halfDisc | centreAbove | fullDisc | darkGap | lightAny |
|---|---|---|---|---|---|---|---|---|
| 1 | 2 m | 87.48% | 91.35% | 87.77% | 87.74% | 82.92% | 115.17 h (4.80 d) | 233.72 d |
| 2 | 2 m | 87.65% | 91.83% | 87.85% | 87.82% | 82.65% | 113.00 h (4.71 d) | 233.83 d |
| 3 | 10 m | 92.35% | 95.31% | 92.59% | 92.59% | 88.65% | 75.67 h (3.15 d) | 261.98 d |
| 4 | 10 m | 91.56% | 95.34% | 91.83% | 91.82% | 86.85% | 77.00 h (3.21 d) | 261.98 d |

Annual meanDisc range across 2023–2039 (nodal-cycle spread): spot 1: 85.92–88.18% (2.26 pts); spot 2: 85.97–88.35% (2.38 pts); spot 3: 91.31–92.93% (1.62 pts); spot 4: 90.36–92.09% (1.73 pts). Annual means dip around 2031–2034 (nodal minimum). A 19/20-year mean over different dates than 2023–2040 therefore plausibly differs by ~0.5 points from the 18-year mean purely from window placement.

## Comparison

Definition mapping (established from the paper's own wording): published Øill ↔ engine **meanDisc** (both are the time-average visible fraction of the solar disc); published "% of time in light" ↔ engine **anyDisc** (both are the fraction of time with any part of the Sun visible, i.e. not in complete darkness). The paper's "longest continuous periods in darkness and light" ↔ engine darkGap (sunF < 0.01) and lightAny (sunF > 0). Note the paper never states its darkness threshold explicitly; the engine's <1%-of-disc threshold is the closest stated equivalent, and the agreement below suggests the thresholds are effectively the same.

| Spot | Øill: published → engine (Δ) | In light: published → engine (Δ) | Longest dark: published → engine (Δ) | Longest light: published → engine (Δ) |
|---|---|---|---|---|
| 1 (2 m) | 88.1% → 87.48% (**−0.62**) | 92% → 91.35% (**−0.65**) | 4.58 d → 4.80 d (+0.22 d) | 233.87 d → 233.72 d (−0.15 d) |
| 2 (2 m) | 87.9% → 87.65% (**−0.25**) | 92.3% → 91.83% (**−0.47**) | 4.62 d → 4.71 d (+0.09 d) | 233.87 d → 233.83 d (−0.04 d) |
| 3 (10 m) | 92.5% → 92.35% (**−0.15**) | 95.6% → 95.31% (**−0.29**) | 3.08 d → 3.15 d (+0.07 d) | 262.42 d → 261.98 d (−0.44 d) |
| 4 (10 m) | 91.9% → 91.56% (**−0.34**) | 95.66% → 95.34% (**−0.32**) | 3.17 d → 3.21 d (+0.04 d) | 262.42 d → 261.98 d (−0.44 d) |

**Reading:** every illumination difference is under 0.7 points; every duration difference is under half a day. The published inter-tool spread on the same quantity is ~3 points (De Rosa et al. 2012, Table 4, two independent tools on identical points), and the nodal-cycle annual spread is 1.6–2.4 points. The engine's agreement is well inside both. The differences are one-sided (engine lower on illumination, longer on dark, shorter on light), consistent with a small systematic offset; candidate causes, not isolated: (a) the averaging window (18.0 years, 2023–2040, vs the paper's 19–20 years with unstated dates — the 2023–2040 window includes the 2031–2034 nodal minimum); (b) the DEM (Gläser used the 2014-era adjusted LOLA DTM; Oneiric uses the current PGDA product-90 20 m DEM, Barker et al. 2023 adjustment); (c) the disc treatment (Gläser divides the disc horizontally at the horizon elevation at the disc centre's azimuth; Oneiric samples 64 points over the disc against the horizon at each sample's azimuth). Step size is excluded as a cause (≤ 0.05 points, measured).

## What does NOT match — and why that is not an engine error

**Oneiric's own Connecting Ridge point is not the Gläser spots.** At Oneiric's `connecting-ridge` point (−89.45, 222.69°E), the engine gives, over the same 18-year window: 0 m meanDisc 30.86% / anyDisc 33.61%; 2 m meanDisc 63.78% / anyDisc 69.61%. That is ~24 points below the published spot values at 2 m. The cause is the point, not the engine: the Oneiric point sits in a local dip (skyline horizon −2.85° to +0.90° at 2 m; blocking terrain 20–330 m away), while the four Gläser spots 50–320 m away sit on the crest with max horizon below 0°. A 2 m mast at the Oneiric point buys +32.92 points (30.86% → 63.78%); the same mast at the published spots buys far less because they are already exposed. **Never quote the published 88–92% figures as Oneiric's own Connecting Ridge result.** The honest statement is that the engine reproduces the published figures *at the published coordinates*, and that Oneiric's own reference point scores lower because it is a different point.

**Shackleton rim: Oneiric's point is permanently dark in the engine.** At `shackleton-rim` (−89.78, 204.27°E), the engine gives 0.00% sunlit at both 0 m and 2 m over the full 18-year window (dark gap = the whole window). The skyline explains it: horizon 3.20–10.92° at 0 m and 1.93–8.08° at 2 m, with blocking terrain 30–100 m away in *every* direction — the point sits in a local hollow ~5–20 m below its immediate surroundings at the 20 m DEM scale, and the Sun at that latitude never rises above ~1.76°. Published high-illumination figures for the Shackleton rim (e.g. Speyerer & Robinson's ~94%) refer to points on the rim crest; De Rosa's SR1 RoI centre is 0.16 km from Oneiric's point but is a region centre, not a max-illumination point, and carries no per-point value. **No coordinate-matched published comparison is possible at Shackleton rim from the sources found.** Whether Oneiric's Shackleton point is a genuinely dark hollow or a mis-placed coordinate from the site library is not resolved here — it needs a DEM neighbourhood check and is flagged for follow-up, not for submission claims. Do not claim the engine is validated at Shackleton rim.

## Files

- Report: `evidence/illumination-check/report.md` (this file)
- Driver: `evidence/illumination-check/illumination-check.ts` (run from a work copy with the four spot skylines built by `pipeline/build-skylines.ts` from the published coordinates; the spots are not library sites and their skylines are not shipped)
- Engine outputs: `evidence/illumination-check/runs/` (4 spot runs + the Connecting Ridge and Shackleton rim runs)
- Receipt: `evidence/illumination-check/receipt.json`
