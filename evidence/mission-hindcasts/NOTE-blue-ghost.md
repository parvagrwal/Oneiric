# Why the Blue Ghost sunset is the closest hindcast

The Blue Ghost sunset replays at 20:53:45 UTC on 16 Mar 2025, which is +2.48 h from the 18:25 UTC reference, against a ±3 h limit. It passes, but the margin is the thinnest of the six hindcasts. The thinness is explained by the check's own conditions, not by an engine error:

1. **The horizon is a smooth sphere, not terrain.** Blue Ghost landed at Mare Crisium (18.5623°N, 61.8103°E), outside the south-polar LOLA rasters, so this hindcast runs at grade D: a smooth sphere with no terrain. Real terrain at the site — crater rims and ridges the smooth sphere cannot see — shifts the actual sunset by up to hours. The two eclipse checks at the same site pass tightly (totality fraction 0.0000 at 07:30 UTC; Sun back at 08:36:52 UTC inside the allowed 08:10–08:50 window), which shows the direction engine is right and the sunset offset lives in the horizon, not the ephemeris.
2. **The reference is itself approximate.** The 18:25 UTC reference is inferred, not recorded: Firefly's last contact was 23:25 UTC, "about 5 h after sunset". The word "about" carries its own uncertainty, which the ±3 h limit absorbs.
3. **Sunset is defined differently on each side.** The engine's sunset is when the visible solar disc fraction crosses the dark threshold (last light). The mission's "sunset" is when the lander's power dropped. The two definitions differ by tens of minutes at a low Sun.

The check passes and stays in the results with this explanation, as fixed before the run: a missed tolerance would stay in the results with its explanation instead of being tuned away.
