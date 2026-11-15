// The Moon's altitude as seen from an Earth station, for the Earth end of the link.
//
// This is the one place the app consults an external ephemeris library directly, because the shipped Moon-centred
// table holds directions as seen from the Moon's centre and cannot answer a question asked from Earth. What it
// computes, and what it does not:
//   - topocentric altitude of the Moon's centre at the station, from the station's geodetic coordinates;
//   - airless: no refraction. A station mask is an elevation angle above the true horizon, so adding refraction
//     would move the Moon up by about half a degree near the horizon and quietly open links that are shut;
//   - the Moon's centre only. Parallax is included by the library's topocentric mode; the Moon's angular radius
//     (about 0.26 degrees) is not added or subtracted, so a result within a quarter degree of the mask is
//     reported as marginal rather than rounded to open or shut.
//
// The library is a dependency of the app only. Nothing in engine/ or pipeline/ imports it, so every number in a
// card that does not need Earth geometry is still produced by the pure engine.
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';
import type { AnyStation } from '../../engine/index.ts';

/** True when the altitude is close enough to the mask that the Moon's own radius decides the answer. */
export const MARGINAL_DEG = 0.26;

export interface StationMoonAltitude {
  /** Topocentric, airless altitude of the Moon's centre, degrees. */
  altitudeDeg: number;
  /** True when the Moon's disc, not its centre, decides whether the mask is cleared. */
  discDecides: boolean;
}

/** The Moon's altitude above a station's true horizon at an instant. Null when the instant is not a number. */
export function stationMoonAltitude(tMs: number, station: Pick<AnyStation, 'latDeg' | 'eLonDeg' | 'maskDeg'>): StationMoonAltitude | null {
  if (!Number.isFinite(tMs)) return null;
  const date = new Date(tMs);
  const observer = new Observer(station.latDeg, station.eLonDeg, 0);
  const moon = Equator(Body.Moon, date, observer, true, true);
  const horizontal = Horizon(date, observer, moon.ra, moon.dec, 'airless');
  const altitudeDeg = horizontal.altitude;
  return { altitudeDeg, discDecides: Math.abs(altitudeDeg - station.maskDeg) < MARGINAL_DEG };
}

/** The signature `earthLinkSummary` takes, so the summary stays free of the library. */
export const moonAltitudeForStations = (tMs: number, station: AnyStation): number | null =>
  stationMoonAltitude(tMs, station)?.altitudeDeg ?? null;
