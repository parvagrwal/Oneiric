import {
  HOUR_MS,
  MIN_MS,
  PRESETS,
  R_MOON_KM,
  SKY_BINS,
  SKY_BIN_DEG,
  SLIP_STEP_MS,
  decodeSkyline,
  makeSkyline,
  siteFrame,
  smoothSiteFrame,
  skylineOrSmooth,
  skylineAt,
  meanEarthAzimuth,
  metrics,
  nextClock,
  sampleAt,
  verdict,
  series,
  slip,
  viableSeries,
  type Clock,
  type EphemTable,
  type Grade,
  type Metrics,
  type Preset,
  type Sample,
  type Skyline,
  type Slip,
  type Verdict,
} from '../../engine/index.ts';

const DAY_MS = 86_400_000;
const SERIES_STEP_MIN = 10;
const SLIP_DAYS_EACH_SIDE = 14;
const SLIP_START_COUNT = (SLIP_DAYS_EACH_SIDE * 2 * DAY_MS) / SLIP_STEP_MS + 1;

export interface SiteDefinition {
  id: string;
  name: string;
  label: string;
  lat: number;
  eLon: number;
  source: string;
  sourceUrl: string;
}

/** A stored terrain skyline for one site and height, as shipped with the app, plus what its build record says about it. */
export interface TerrainPayload {
  buffer: ArrayBuffer;
  grade: Grade;
  terrain: string;
  siteElevationM: number;
  heightM: number;
}

export interface TrackPoint {
  tMs: number;
  sunAz: number;
  sunEl: number;
  sunF: number;
  earthAz: number;
  earthEl: number;
  earthVis: boolean;
}

export interface ScenarioResult {
  startMs: number;
  stayMs: number;
  preset: Pick<Preset, 'id' | 'name' | 'stayDays' | 'label'>;
  sample: Sample;
  metrics: Metrics;
  slip: Slip;
  verdict: Verdict;
  sunset: Clock;
  earthset: Clock;
  meanEarthAzimuth: number;
  /** Horizon points for drawing. With terrain: every 0.25 degree bin, with the distance to the terrain that sets it. */
  skyline: Array<{ az: number; elevation: number; distanceKm?: number }>;
  track: TrackPoint[];
  timeline: TrackPoint[];
}

export function floorToTenMinutes(tMs: number): number {
  return Math.floor(tMs / (10 * MIN_MS)) * 10 * MIN_MS;
}

function trackPoint(s: ReturnType<typeof series>, tMs: number): TrackPoint {
  const p = s.probe(tMs);
  return {
    tMs,
    sunAz: p.sunAz,
    sunEl: p.sunEl,
    sunF: p.sunF,
    earthAz: p.earthAz,
    earthEl: p.earthEl,
    earthVis: p.earthVis,
  };
}

function presetFor(id: string): Preset {
  const preset = PRESETS[id];
  if (!preset || !preset.rules) throw new RangeError(`unsupported preview stay: ${id}`);
  return preset;
}

function terrainSkyline(terrain: TerrainPayload, heightM: number): Skyline {
  if (terrain.heightM !== heightM) throw new RangeError(`the terrain skyline was built for ${terrain.heightM} m, not ${heightM} m`);
  if (!Number.isFinite(terrain.siteElevationM)) throw new RangeError('the terrain skyline has no site elevation');
  const { H, D } = decodeSkyline(terrain.buffer);
  return makeSkyline({ H, D, grade: terrain.grade, terrain: terrain.terrain, heightM });
}

/**
 * Orchestrates the existing pure engine for the first app scenario.
 * The worker calls this function; it contains no display arithmetic.
 */
export function calculateScenario(
  table: EphemTable,
  site: SiteDefinition,
  requestedStartMs: number,
  presetId: string,
  heightM = 2,
  terrain: TerrainPayload | null = null,
): ScenarioResult {
  const preset = presetFor(presetId);
  const startMs = floorToTenMinutes(requestedStartMs);
  const stayMs = preset.stayDays * DAY_MS;
  const gridStartMs = Math.floor(startMs / SLIP_STEP_MS) * SLIP_STEP_MS;
  const firstStartMs = gridStartMs - SLIP_DAYS_EACH_SIDE * DAY_MS;
  const lastStartMs = firstStartMs + (SLIP_START_COUNT - 1) * SLIP_STEP_MS;
  const seriesEndMs = lastStartMs + stayMs;
  // With a terrain skyline the site sits on the terrain. Without one, the smooth sphere is used and the grade is D.
  const terrainSky = terrain ? terrainSkyline(terrain, heightM) : null;
  const sky = skylineOrSmooth(terrainSky, heightM);
  const frame = terrain && terrainSky
    ? siteFrame(site.lat, site.eLon, R_MOON_KM * 1000 + terrain.siteElevationM + heightM)
    : smoothSiteFrame(site.lat, site.eLon, heightM);
  const siteInput = { frame, sky };
  const calculated = series(table, siteInput, firstStartMs, seriesEndMs, SERIES_STEP_MIN);
  const windowEndMs = startMs + stayMs;
  const windowMetrics = metrics(calculated, startMs, windowEndMs);
  const viable = viableSeries(calculated, preset, firstStartMs, SLIP_START_COUNT);
  const tolerance = slip(viable, firstStartMs, startMs);
  const decision = verdict(windowMetrics, preset, tolerance);
  const track: TrackPoint[] = [];
  for (let tMs = startMs; tMs < windowEndMs; tMs += HOUR_MS) track.push(trackPoint(calculated, tMs));
  const timeline = track.filter((_, index) => index % 6 === 0);

  return {
    startMs,
    stayMs,
    preset: { id: preset.id, name: preset.name, stayDays: preset.stayDays, label: preset.label },
    sample: sampleAt(table, siteInput, startMs),
    metrics: windowMetrics,
    slip: tolerance,
    verdict: decision,
    sunset: nextClock(calculated, 'sunset', startMs, windowEndMs),
    earthset: nextClock(calculated, 'earthset', startMs, windowEndMs),
    meanEarthAzimuth: meanEarthAzimuth(frame),
    skyline: terrainSky
      ? Array.from({ length: SKY_BINS }, (_, bin) => ({ az: (bin + 0.5) * SKY_BIN_DEG, elevation: sky.H[bin], distanceKm: sky.D[bin] / 100 }))
      : Array.from({ length: 181 }, (_, index) => {
        const az = index * 2;
        return { az, elevation: skylineAt(sky, az).H };
      }),
    track,
    timeline,
  };
}
