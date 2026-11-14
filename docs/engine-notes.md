# Engine notes

Definitions the method page will state. All times are UTC.

- **Site:** position `(R + z + h) * unit(lat, lon)` with `R` = 1,737.4 km, `z` the terrain height (0 on a smooth sphere) and `h` the array height.
- **Skyline:** 1,440 bins of 0.25° of azimuth. Bin `i` is centred on `(i + 0.5) * 0.25°`. Elevation is interpolated linearly between bin centres and wraps at 360°. The distance comes from the nearer bin.
- **Smooth sphere:** every bin holds `-acos(R / (R + h))`: -0.087° at 2 m and -0.194° at 10 m.
- **Series:** step `k` stands for the interval `[t0 + k * step, t0 + (k + 1) * step)`. Percentages average the steps. Gap lengths use step runs, with each edge inside the window refined to 1 minute by bisection. A gap that touches the window edge is cut at the edge.
- **Eclipse:** an interval where Earth's disc covers some of the 64 solar sample points, whatever the terrain. Start and end are refined to 1 minute. The largest cover is taken over the 10-minute samples.
- **Energy:** `1361 W/m² * (1 AU / d)² * f * cos(incidence)`, summed over steps, in kWh/m². Three geometries: a vertical array that follows the Sun, a vertical array at a fixed facing (best of eight compass directions), and a horizontal deck.
- **Slip tolerance:** viability is evaluated every 6 hours. Days late and days early are the unbroken viable run after and before the chosen start. The chosen start snaps down to the 6-hour grid. A run that reaches the edge of the evaluated range is marked as at least that long.
