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
  out=$(npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
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
[ -z "$SURVIVORS" ] && echo "all mutants killed" || { echo "some mutants survived"; exit 1; }
