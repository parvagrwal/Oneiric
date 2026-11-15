import { HOUR_MS } from './constants.ts';
import type { Vec3 } from './vec.ts';

/** One row per hour: [ux, uy, uz, sunRangeKm, ex, ey, ez, earthRangeKm] (Float32).
 *  u is the unit vector from the Moon's centre to the Sun, e the same for Earth, in MOON_ME. */
export const ROW = 8;

export interface EphemTable {
  /** year -> rows; each year holds every hour from Jan 1 00:00 UTC to the next Jan 1 00:00 UTC inclusive. */
  years: Map<number, Float32Array>;
}

export interface Bodies {
  sun: Vec3; // km, from the Moon's centre
  earth: Vec3;
}

function locate(table: EphemTable, tMs: number) {
  if (!Number.isFinite(tMs)) throw new RangeError(`time not finite: ${tMs}`);
  const year = new Date(tMs).getUTCFullYear();
  for (const y of [year, year - 1]) {
    const data = table.years.get(y);
    if (!data) continue;
    const hours = (tMs - Date.UTC(y, 0, 1)) / HOUR_MS;
    const i = Math.floor(hours);
    const rows = data.length / ROW;
    // The very last row (next Jan 1 00:00 UTC) is reachable only exactly, where no neighbour is needed.
    if (i >= 0 && (i + 2 <= rows || (i === rows - 1 && hours === i))) return { data, i, w: hours - i };
  }
  throw new RangeError(`time ${new Date(tMs).toISOString()} is outside the ephemeris table`);
}

/** Sun and Earth vectors at time tMs (UTC ms): linear interpolation of the full vectors between hourly rows. */
export function ephemAt(table: EphemTable, tMs: number): Bodies {
  const { data, i, w } = locate(table, tMs);
  const a = i * ROW;
  const b = w === 0 ? a : a + ROW;
  const vec = (o: number): Vec3 => {
    const k0 = data[a + o + 3];
    const k1 = data[b + o + 3];
    const x0 = data[a + o] * k0, y0 = data[a + o + 1] * k0, z0 = data[a + o + 2] * k0;
    const x1 = data[b + o] * k1, y1 = data[b + o + 1] * k1, z1 = data[b + o + 2] * k1;
    return [x0 + (x1 - x0) * w, y0 + (y1 - y0) * w, z0 + (z1 - z0) * w];
  };
  return { sun: vec(0), earth: vec(4) };
}

/** Build a table from per-year binary buffers (as written by the pipeline). */
export function tableFromBuffers(buffers: Map<number, ArrayBuffer>): EphemTable {
  const years = new Map<number, Float32Array>();
  for (const [y, buf] of buffers) {
    if (buf.byteLength === 0 || buf.byteLength % (ROW * 4) !== 0)
      throw new Error(`ephemeris buffer for ${y} is empty or holds a partial row (${buf.byteLength} bytes)`);
    years.set(y, new Float32Array(buf));
  }
  return { years };
}

/** Contiguous UTC millisecond span [minMs, maxMs] of loaded years in `table` that contains `nearMs`. */
export function ephemSpan(table: EphemTable, nearMs: number): { minMs: number; maxMs: number } {
  locate(table, nearMs);
  const year = new Date(nearMs).getUTCFullYear();
  const anchor = table.years.has(year) ? year : year - 1;
  let minY = anchor;
  let maxY = anchor;
  while (table.years.has(minY - 1)) minY--;
  while (table.years.has(maxY + 1)) maxY++;
  const maxData = table.years.get(maxY)!;
  const maxRows = maxData.length / ROW;
  return {
    minMs: Date.UTC(minY, 0, 1),
    maxMs: Date.UTC(maxY, 0, 1) + (maxRows - 1) * HOUR_MS,
  };
}
