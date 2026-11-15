// The Earth end of the link: a link is open only when the lunar side clears the terrain horizon AND the Moon
// clears the receiving station's elevation mask.
//
// The rule this file exists to enforce: the station half is never assumed. A station with no elevation calculation
// available reports "station side unknown", and the card says the link is judged on the lunar side alone. Filling
// in a clear sky for a station whose geometry was not computed would turn one honest half into a whole answer that
// was never measured.
import type { Skyline } from './skyline.ts';
import { skylineAt } from './skyline.ts';

export interface Station {
  /** Stable identifier used in share links. */
  id: string;
  /** Network and station name, as published by the operator. */
  name: string;
  /** Provider that publishes the station, for example "NASA DSN" or "ESA ESTRACK". */
  network: string;
  latDeg: number;
  eLonDeg: number;
  /** Minimum Moon elevation the station requires, degrees. */
  maskDeg: number;
  /** Antenna diameter, metres, when the operator publishes one. */
  antennaM?: number;
  /** Where the coordinates and the mask came from. */
  source: string;
}

/** A station the user typed in. Same geometry, no published source. */
export interface CustomStation extends Omit<Station, 'id' | 'network' | 'source'> {
  id: 'custom';
  network: 'custom';
  source: 'entered by hand';
}

export type AnyStation = Station | CustomStation;

/** Which half of the link is being judged. `both` is only ever set when both halves were computed. */
export type LinkBasis = 'both' | 'lunar-only';

export interface LinkState {
  /** True when the lunar side clears the terrain horizon plus the margin. */
  lunarSideClear: boolean;
  /** Earth's centre elevation minus the horizon at its azimuth, degrees. */
  lunarClearanceDeg: number;
  /** Moon elevation at the station, degrees, or null when the station side was not computed. */
  stationMoonElevationDeg: number | null;
  /** True when the Moon is at or above the station mask. Null when not computed. */
  stationSideClear: boolean | null;
  /** True only when every half that is being judged is clear. */
  open: boolean;
  basis: LinkBasis;
  /** One sentence a card can print, naming what was and was not judged. */
  reason: string;
}

export interface LinkInput {
  earthElDeg: number;
  earthAzDeg: number;
  sky: Skyline;
  /** Earth visibility margin above the terrain horizon, degrees (default 0). */
  lunarMarginDeg: number;
  /** Moon altitude at the station, degrees. Null when the caller has no station geometry for this instant. */
  stationMoonElevationDeg: number | null;
  /** The station, or null for "lunar side only". */
  station: AnyStation | null;
}

/** Judge the link at one instant. Pure: the caller supplies the station geometry. */
export function linkState(input: LinkInput): LinkState {
  const horizon = skylineAt(input.sky, input.earthAzDeg).H;
  const lunarClearanceDeg = input.earthElDeg - horizon;
  const lunarSideClear = input.earthElDeg >= horizon + input.lunarMarginDeg;

  const hasStation = input.station !== null;
  const stationGeo = hasStation ? input.stationMoonElevationDeg : null;
  const stationSideClear = hasStation && stationGeo !== null ? stationGeo >= input.station!.maskDeg : null;
  const basis: LinkBasis = stationSideClear === null ? 'lunar-only' : 'both';
  const open = basis === 'both' ? lunarSideClear && stationSideClear === true : lunarSideClear;

  const lunarWords = lunarSideClear
    ? `Earth is ${lunarClearanceDeg.toFixed(2)}° above the terrain horizon`
    : `Earth is ${Math.abs(lunarClearanceDeg).toFixed(2)}° below the terrain horizon`;
  const stationWords = !hasStation
    ? 'no station selected, so only the lunar side is judged'
    : stationSideClear === null
      ? `${input.station!.name}: station geometry not computed for this instant, so only the lunar side is judged`
      : stationSideClear
        ? `${input.station!.name}: Moon ${stationGeo!.toFixed(1)}° up, mask ${input.station!.maskDeg}°, clear`
        : `${input.station!.name}: Moon ${stationGeo!.toFixed(1)}° up, below its ${input.station!.maskDeg}° mask`;
  return {
    lunarSideClear,
    lunarClearanceDeg,
    stationMoonElevationDeg: stationGeo,
    stationSideClear,
    open,
    basis,
    reason: `${open ? 'Link open' : 'Link closed'}: ${lunarWords}; ${stationWords}.`,
  };
}

/** A station carried by the Moon altitude provider. */
export interface MoonAltitudeProvider {
  moonAltitudeDeg(tMs: number, station: AnyStation): number | null;
}

/** Seconds of a stay during which the link is open, judged on both halves when the station geometry exists. */
export interface LinkWindowSample {
  tMs: number;
  open: boolean;
  /** Which halves were judged at this sample. A stay that mixes bases is reported, not smoothed over. */
  basis: LinkBasis;
}
