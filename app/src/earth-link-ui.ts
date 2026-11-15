// The Earth end of the link in the interface: the station picker's rows, the mask, and the sentence the card prints.
//
// The rule: a station the app cannot compute says so, and the card then reports the lunar side alone. It never
// prints "link open" on the strength of a station whose geometry was assumed.
import { linkState, type AnyStation, type LinkState, type Skyline, type Station } from '../../engine/index.ts';
import type { TrackPoint } from './scenario.ts';

/**
 * Stations with published coordinates. Every row names where its coordinates came from. The mask on every row is
 * a 10-degree planning figure, not a published minimum elevation: it is the same for all four stations, it is
 * shown on the card, and a station with a different mask belongs in the custom entry. A row whose coordinates
 * have not been read from the operator is not listed here at all.
 */
export const STATIONS: Station[] = [
  {
    id: 'dsn-14',
    name: 'Goldstone DSS-14',
    network: 'NASA DSN',
    latDeg: 35.426,
    eLonDeg: 243.11,
    maskDeg: 10,
    antennaM: 70,
    source: 'NASA Deep Space Network station page (Goldstone, DSS-14), coordinates; 10° planning mask',
  },
  {
    id: 'dsn-43',
    name: 'Canberra DSS-43',
    network: 'NASA DSN',
    latDeg: -35.402,
    eLonDeg: 148.981,
    maskDeg: 10,
    antennaM: 70,
    source: 'NASA Deep Space Network station page (Canberra, DSS-43), coordinates; 10° planning mask',
  },
  {
    id: 'dsn-63',
    name: 'Madrid DSS-63',
    network: 'NASA DSN',
    latDeg: 40.431,
    eLonDeg: 355.75,
    maskDeg: 10,
    antennaM: 70,
    source: 'NASA Deep Space Network station page (Madrid, DSS-63), coordinates; 10° planning mask',
  },
  {
    id: 'estrack-cesa',
    name: 'Cebreros',
    network: 'ESA ESTRACK',
    latDeg: 40.453,
    eLonDeg: 355.62,
    maskDeg: 10,
    antennaM: 35,
    source: 'ESA ESTRACK station page (Cebreros, Spain), coordinates; 10° planning mask',
  },
];

/** The option list the picker shows, including the two honest non-station choices. */
export const STATION_CHOICES: Array<{ id: string; label: string }> = [
  { id: 'none', label: 'No station · lunar side only' },
  ...STATIONS.map((s) => ({ id: s.id, label: `${s.name} · ${s.network}` })),
  { id: 'custom', label: 'Custom station (entered by hand)' },
];

export const stationById = (id: string): Station | undefined => STATIONS.find((s) => s.id === id);

/** Moon altitude at a station, supplied by the caller so this module stays free of any astronomy library. */
export type MoonAltitudeFn = (tMs: number, station: AnyStation) => number | null;

export interface EarthLinkSummary {
  /** The link state at the scrubbed instant. */
  now: LinkState;
  /** Share of the stay that the link is open, judged on the same basis as `now`. */
  openPct: number;
  /** Longest closed run inside the stay, hours. */
  longestClosedH: number;
  /** True when some samples in the stay were judged on both halves and others on the lunar side alone. */
  mixedBasis: boolean;
}

/**
 * The link over the stay, at the track's own resolution. `station` null means lunar side only. When the station is
 * set but the altitude function returns null for some samples, those samples are judged on the lunar side alone,
 * and the summary says the basis was mixed rather than presenting the whole stay as both-halves.
 */
export function earthLinkSummary(
  track: TrackPoint[],
  sky: Skyline,
  marginDeg: number,
  station: AnyStation | null,
  moonAlt: MoonAltitudeFn | null,
): EarthLinkSummary {
  if (track.length === 0) {
    const idle = linkState({ earthElDeg: 0, earthAzDeg: 0, sky, lunarMarginDeg: marginDeg, stationMoonElevationDeg: null, station });
    return { now: idle, openPct: 0, longestClosedH: 0, mixedBasis: false };
  }
  let open = 0;
  let run = 0;
  let longest = 0;
  let both = 0;
  let lunarOnly = 0;
  const stepH = track.length > 1 ? (track[1].tMs - track[0].tMs) / 3_600_000 : 1;
  let nowState = linkState({ earthElDeg: track[0].earthEl, earthAzDeg: track[0].earthAz, sky, lunarMarginDeg: marginDeg, stationMoonElevationDeg: station && moonAlt ? moonAlt(track[0].tMs, station) : null, station });
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    const alt = station && moonAlt ? moonAlt(p.tMs, station) : null;
    const state = linkState({ earthElDeg: p.earthEl, earthAzDeg: p.earthAz, sky, lunarMarginDeg: marginDeg, stationMoonElevationDeg: alt, station });
    if (i === 0) nowState = state;
    if (state.basis === 'both') both++;
    else lunarOnly++;
    if (state.open) {
      open++;
      run = 0;
    } else {
      run += stepH;
      if (run > longest) longest = run;
    }
  }
  return {
    now: nowState,
    openPct: (100 * open) / track.length,
    longestClosedH: longest,
    mixedBasis: both > 0 && lunarOnly > 0,
  };
}

/** The card sentence for the summary, naming the basis and never overstating it. */
export function earthLinkSentence(summary: EarthLinkSummary, station: AnyStation | null): string {
  if (!station) return `Lunar side only, no station selected: Earth is above the terrain horizon for ${summary.openPct.toFixed(1)}% of the stay. ${summary.now.reason}`;
  if (summary.now.basis === 'lunar-only') return `Lunar side only for this instant: ${summary.now.reason} Earth is above the terrain horizon for ${summary.openPct.toFixed(1)}% of the stay; the station half is not included.`;
  const mixed = summary.mixedBasis ? ' Some samples in the stay had no station geometry, so the share mixes both-halves and lunar-only samples.' : '';
  return `Both halves: the link is open for ${summary.openPct.toFixed(1)}% of the stay, longest closed run ${summary.longestClosedH.toFixed(1)} h.${mixed} ${summary.now.reason}`;
}
