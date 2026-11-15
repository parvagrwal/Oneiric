# Landing-circle points

The 100 m landing circle is eight points around a centre, one every 45°, north first then clockwise. The landing-error report prints nine rows: the centre plus the eight circle points.

## The skyline id for a circle point

A circle point's skyline, if one is ever built, is looked up by id in `app/public/data/skylines/index.json`:

```text
<centreId>~circle-<azDeg>
```

`<centreId>` is the centre site's id, and `<azDeg>` is the point's azimuth from the centre in degrees, with no trailing zeros (0, 45, 90, 135, 180, 225, 270, 315). The lookup also requires the skyline's height to match the observer height exactly, the same rule as for a site skyline (see `docs/observer-height.md`).

The centre's own site skyline is not counted as a circle-point skyline: the lookup uses the circle id, not the site id, so the centre needs its own `~circle-0` file to count as computed. Note that the centre and the north point both carry azimuth 0, so they share the `~circle-0` id; no file exists yet, so the collision has no effect today.

## Current state

No circle-point skyline exists in the shipped index. `npm run landing-report` reports every circle point as having no stored skyline, and the share of the circle that keeps the centre verdict as not computed. Nothing is interpolated from the centre.
