# Engine notes

Definitions the method page will state. All times are UTC.

- **Site:** position `(R + z + h) * unit(lat, lon)` with `R` = 1,737.4 km, `z` the terrain height (0 on a smooth sphere) and `h` the array height.
- **Skyline:** 1,440 bins of 0.25° of azimuth. Bin `i` is centred on `(i + 0.5) * 0.25°`. Elevation is interpolated linearly between bin centres and wraps at 360°. The distance comes from the nearer bin.
- **Smooth sphere:** every bin holds `-acos(R / (R + h))`: -0.087° at 2 m and -0.194° at 10 m.
- **Series:** step `k` stands for the interval `[t0 + k * step, t0 + (k + 1) * step)`. Percentages average the steps. Gap lengths use step runs, with each edge inside the window refined to 1 minute by bisection. A gap that touches the window edge is cut at the edge.
- **Eclipse:** an interval where Earth's disc covers some of the 64 solar sample points, whatever the terrain. Start and end are refined to 1 minute. The largest cover is taken over the 10-minute samples.
- **Energy:** `1361 W/m² * (1 AU / d)² * f * cos(incidence)`, summed over steps, in kWh/m². Three geometries: a vertical array that follows the Sun, a vertical array at a fixed facing (best of eight compass directions), and a horizontal deck.
- **Slip tolerance:** viability is evaluated every 6 hours. Days late and days early are the unbroken viable run after and before the chosen start. The chosen start snaps down to the 6-hour grid. A run that reaches the edge of the evaluated range is marked as at least that long.
- **Map projection:** south polar stereographic on the 1,737.4 km sphere: `r = 2R * tan(45° + lat/2)`, `x = r * sin(lon)`, `y = r * cos(lon)`. Raster row 0 is at the largest `y`. Heights are metres above the sphere. The reader takes pixel size, origin and no-data value from the file and refuses a file that disagrees.
- **Terrain skyline:** rays start one fine pixel from the site and follow a great circle. At distance `s` along the ground, with `t = s / R`, terrain of height `z` has elevation `atan2((R + z) * cos t - r0, (R + z) * sin t)`, where `r0` is the observer radius. Heights are interpolated bilinearly. A bin holds the highest of its 4 rays, and the distance at which that ray found it.
- **Where a ray ends:** at 450 km, where no raster has data, or, once past the point where the rasters' highest terrain could still touch the horizon, when that highest terrain would sit below the horizon already found.
- **Stored skyline:** 8,640 bytes per site and height: 1,440 little-endian 32-bit elevations in degrees, then 1,440 little-endian 16-bit distances in units of 10 m. A record beside it holds the SHA-256 of the file and of each 10° block, so a changed file is reported with the azimuth range that changed.
