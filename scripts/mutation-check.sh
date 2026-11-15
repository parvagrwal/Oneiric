#!/bin/bash
# Engine mutation check: change exactly one element of the engine, run the tests, and require at least one failure.
# A mutant that survives means the tests are missing a check. The engine is restored after every mutant.
cd "$(dirname "$0")/.."
ORIG=$(mktemp -d)
cp -r engine "$ORIG/engine"
trap 'rm -rf engine && cp -r "$ORIG/engine" engine && rm -rf "$ORIG"' EXIT
SURVIVORS=""
mut() { # name file python-replace-old python-replace-new
  cp $ORIG/engine/$2 engine/$2
  python3 - "$2" "$3" "$4" <<'PY'
import sys
f,old,new=sys.argv[1:4]; p='engine/'+f; s=open(p).read()
assert old in s, ('pattern missing', old)
open(p,'w').write(s.replace(old,new,1))
PY
  out=$(npx vitest run --bail 1 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  fails=$(echo "$out" | grep -E "^\s+Tests" | sed 's/^ *//')
  if echo "$fails" | grep -q failed; then echo "KILLED    $1 ($fails)"; else echo "SURVIVED  $1 ($fails)"; SURVIVORS=1; fi
  cp $ORIG/engine/$2 engine/$2
}
mut "east vector sign flipped" frame.ts "const east: Vec3 = [-Math.sin(l), Math.cos(l), 0];" "const east: Vec3 = [Math.sin(l), -Math.cos(l), 0];"
mut "azimuth atan2 arguments swapped" frame.ts "Math.atan2(dot(d, f.east), dot(d, f.north))" "Math.atan2(dot(d, f.north), dot(d, f.east))"
mut "direction from Moon centre instead of site" frame.ts "unit(sub(body, f.r0))" "unit(body)"
mut "no interpolation between hourly rows" ephemeris.ts "const b = w === 0 ? a : a + ROW;" "const b = a;"
mut "silent extrapolation outside table" ephemeris.ts "throw new RangeError(\`time \${new Date(tMs).toISOString()} is outside the ephemeris table\`);" "return { data: table.years.values().next().value!, i: 0, w: 0 };"
mut "dark threshold 0.01 -> 0.02 (dark counts 1 sample)" constants.ts "DARK_BELOW = 0.01" "DARK_BELOW = 0.02"
mut "Earth disc radius ignored (point Earth)" sunlight.ts "const rhoE = angRadius(EARTH_RADIUS_KM, norm(ve));" "const rhoE = 0;"
mut "sky elevation test uses > H + 1 degree" sunlight.ts "el >= skylineAt(sky, az).H)" "el >= skylineAt(sky, az).H + 1)"
mut "skyline lookup does not wrap at 360" skyline.ts "const i1 = (i0 + 1) % SKY_BINS;" "const i1 = Math.min(i0 + 1, SKY_BINS - 1);"
mut "MARGINAL limit 3 -> 2 days" requirements.ts "MARGINAL_SLIP_DAYS = 3" "MARGINAL_SLIP_DAYS = 2"
mut "failed rule no longer beats MARGINAL (slip checked first)" requirements.ts "  if (failed.length) return" "  if (failed.length && (sl.lateDays ?? 0) >= 3) return"
mut "slip run crosses a gap" requirements.ts "while (j + 1 < viable.length && viable[j + 1]) j++;" "while (j + 1 < viable.length && (viable[j + 1] || viable[j + 2])) j++;"
mut "smooth data allowed to carry terrain grade" skyline.ts "if (a.grade !== 'D' && looksSmooth) throw" "if (false) throw"
mut "verdict without grade allowed" requirements.ts "if (!m.grade || !m.terrain) throw" "if (false) throw"
mut "gap not clipped to window" metrics.ts "if (i > i0) start = refine((t) => probeFlag(s.probe(t)), start - s.stepMs, start);" "start = refine((t) => probeFlag(s.probe(t)), start - s.stepMs, start);"
mut "solar disc radius 10x" constants.ts "SUN_RADIUS_KM = 695700" "SUN_RADIUS_KM = 6957000"
mut "fixed array stuck on north (no best-of-8)" metrics.ts "for (let k = 1; k < FACINGS.length; k++) if (fixed[k] > fixed[bestK]) bestK = k;" "for (let k = 1; k < FACINGS.length; k++) if (false) bestK = k;"
mut "verdict uses early slip instead of late" requirements.ts "const late = sl.viableAtChosen ? sl.lateDays! : 0;" "const late = sl.viableAtChosen ? sl.earlyDays! : 0;"
mut "Earth visibility ignores its margin" sunlight.ts "return el >= skylineAt(sky, az).H + marginDeg;" "return el >= skylineAt(sky, az).H;"
mut "ray samples mirrored east to west" terrain.ts "const x = k * py;" "const x = -k * py;"
mut "ray samples with map axes swapped" terrain.ts "const y = k * px;" "const y = k * py;"
mut "site projected with x and y swapped" terrain.ts "return { x: r * Math.sin(lonDeg * DEG), y: r * Math.cos(lonDeg * DEG) };" "return { x: r * Math.cos(lonDeg * DEG), y: r * Math.sin(lonDeg * DEG) };"
mut "curvature left out of terrain elevation" terrain.ts "Math.atan2(radiusM * cosT - siteRadiusM, radiusM * sinT)" "Math.atan2(radiusM - siteRadiusM, radiusM * sinT)"
mut "ray step 0.5 -> 7 pixels (crest stepped over)" terrain.ts "opts.stepPixels ?? 0.5" "opts.stepPixels ?? 7"
mut "one ray per bin instead of four" terrain.ts "opts.subRays ?? 4" "opts.subRays ?? 1"
mut "terrain height at the site left out of the observer radius" terrain.ts "const siteRadiusM = R_M + siteElevationM + heightM;" "const siteRadiusM = R_M + heightM;"
mut "array height left out of the observer radius" terrain.ts "const siteRadiusM = R_M + siteElevationM + heightM;" "const siteRadiusM = R_M + siteElevationM;"
mut "ray stopped before the highest shell's tangent point" terrain.ts "if (siteRadiusM * cosT < topRadiusM && elevation(topRadiusM, cosT, sinT) < best) break;" "if (elevation(topRadiusM, cosT, sinT) < best) break;"
mut "blocking distance never recorded" terrain.ts "if (el > best) { best = el; bestDistM = s; }" "if (el > best) { best = el; }"
mut "raster lookup shifted half a pixel" terrain.ts "const cx = (xM - g.xEdgeM) / g.pixelM - 0.5;" "const cx = (xM - g.xEdgeM) / g.pixelM;"
mut "raster rows read bottom-up" terrain.ts "const cy = (g.yEdgeM - yM) / g.pixelM - 0.5;" "const cy = (yM - g.yEdgeM) / g.pixelM - 0.5;"
mut "fine raster used beyond its distance limit" terrain.ts "if (s >= tiers[t].maxDistM) continue;" "if (false) continue;"
mut "incomplete 20 m near field still graded B" terrain.ts "if (tiers[0].dem.pixelM <= 20 && built.nearFieldComplete) return 'B';" "if (tiers[0].dem.pixelM <= 20) return 'B';"
mut "stored skyline decoded big-endian" terrain.ts "H[i] = view.getFloat32(i * 4, true);" "H[i] = view.getFloat32(i * 4, false);"
mut "heights that cannot be metres accepted" terrain.ts "if (zMaxM > 12_000 || zMinM < -12_000) throw" "if (false) throw"
mut "rolling prefix sum ignores window start" metrics.ts "const sumF = prefixSunF[i1] - prefixSunF[i0];" "const sumF = prefixSunF[i1];"
mut "rolling gap not clipped to window start" metrics.ts "if (i > winStart) {" "if (r.rStart > 0) {"
[ -z "$SURVIVORS" ] && echo "all mutants killed" || { echo "some mutants survived"; exit 1; }
