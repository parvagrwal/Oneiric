// Build the JPL Horizons "shape B" site query that returns the Sun or Earth az/el as seen from a surface point.
// The app computes from the cached hourly table; this URL reproduces positions the direction check compares against.
// Encoding matches pipeline/horizons.ts: values are single-quoted, then encodeURIComponent is applied.
import type { SiteDefinition } from './scenario.ts';

export type Body = 'sun' | 'earth';

const COMMAND: Record<Body, string> = { sun: '10', earth: '399' };
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

function horizonsUtc(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 16).replace('T', ' ');
}

/** Shape-B URL for a stay window. Datetimes are UTC, longitude is east-positive, height 0 km. */
export function shapeBUrl(site: SiteDefinition, body: Body, startMs: number, stayDays: number): string {
  const endMs = startMs + Math.round(stayDays * 86_400_000);
  const params: Record<string, string> = {
    COMMAND: COMMAND[body],
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `${site.eLon},${site.lat},0`,
    START_TIME: horizonsUtc(startMs),
    STOP_TIME: horizonsUtc(endMs),
    STEP_SIZE: '10 m',
    QUANTITIES: '4',
    APPARENT: 'AIRLESS',
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    EXTRA_PREC: 'YES',
  };
  const parts = ['format=text'];
  for (const [k, v] of Object.entries(params)) parts.push(`${k}=${encodeURIComponent(`'${v}'`)}`);
  return `${API}?${parts.join('&')}`;
}
