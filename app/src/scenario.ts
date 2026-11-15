import {
  DEG,
  EARTH_RADIUS_KM,
  HOUR_MS,
  MIN_MS,
  PRESET_LABEL,
  PRESETS,
  R_MOON_KM,
  SKY_BINS,
  SKY_BIN_DEG,
  SLIP_STEP_MS,
  SUN_RADIUS_KM,
  decodeSkyline,
  ephemAt,
  ephemSpan,
  makeSkyline,
  meanEarthAzimuth,
  metrics,
  nextClock,
  norm,
  prepareRolling,
  sampleAt,
  series,
  siteFrame,
  skylineAt,
  skylineOrSmooth,
  slip,
  smoothSiteFrame,
  sub,
  verdict,
  verdictSeries,
  viableFromRolling,
  type Clock,
  type EphemTable,
  type Grade,
  type Metrics,
  type Preset,
  type RollingSeries,
  type Sample,
  type Series,
  type Site,
  type Skyline,
  type Slip,
  type Verdict,
  type VerdictName,
} from '../../engine/index.ts';
import { isCustomSite } from './sites.ts';

export const DAY_MS = 86_400_000;
const SERIES_STEP_MIN = 10;
const SERIES_STEP_MS = SERIES_STEP_MIN * MIN_MS;
const DEFAULT_SLIP_EARLY_DAYS = 30;
const DEFAULT_SLIP_LATE_DAYS = 120;
const CACHE_STAY_PAD_DAYS = 14;
export const DAILY_WINDOW_COLUMNS = 120;
export const WEEKLY_WINDOW_COLUMNS = 52;

export interface SiteDefinition {
  id: string;
  name: string;
  label: string;
  lat: number;
  eLon: number;
  source: string;
  sourceUrl: string;
  isCustom?: boolean;
}

/** A stored terrain skyline for one site and height, as shipped with the app, plus what its build record says about it. */
export interface TerrainPayload {
  buffer: ArrayBuffer;
  grade: Grade;
  terrain: string;
  siteElevationM: number;
  heightM: number;
}

export interface ScenarioOptions {
  stayDays?: number;
  rules?: Partial<NonNullable<Preset['rules']>> | null;
  marginDeg?: number;
  slipEarlyDays?: number;
  slipLateDays?: number;
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
  preset: Pick<Preset, 'id' | 'name' | 'stayDays' | 'label'> & { rules: Preset['rules'] };
  marginDeg: number;
  sample: Sample;
  sunAngularRadiusDeg: number;
  earthAngularRadiusDeg: number;
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
  timelineStepHours: number;
}

export interface WindowFinderCell {
  startMs: number;
  verdict: VerdictName;
  rule: string;
}

export interface WindowFinderRow {
  siteId: string;
  grade: Grade;
  terrain: string;
  cells: WindowFinderCell[];
}

export function floorToTenMinutes(tMs: number): number {
  return Math.floor(tMs / SERIES_STEP_MS) * SERIES_STEP_MS;
}

export function floorToUtcDay(tMs: number): number {
  return Math.floor(tMs / DAY_MS) * DAY_MS;
}

function snapStayMs(stayDays: number): number {
  if (!(stayDays > 0 && stayDays <= 366)) throw new RangeError(`stay days out of range: ${stayDays}`);
  return Math.max(6 * HOUR_MS, Math.round((stayDays * DAY_MS) / SERIES_STEP_MS) * SERIES_STEP_MS);
}

export function resolvePreset(presetId: string, options?: ScenarioOptions): Preset {
  const base = PRESETS[presetId];
  if (!base) throw new RangeError(`unsupported stay preset: ${presetId}`);
  const stayDays = options?.stayDays !== undefined ? options.stayDays : base.stayDays;
  if (!(stayDays > 0 && stayDays <= 366)) throw new RangeError(`stay days out of range: ${stayDays}`);

  let rules: Preset['rules'] = base.rules ? { ...base.rules } : null;
  let customized = stayDays !== base.stayDays;

  if (base.rules && options?.rules) {
    const r = options.rules;
    if (r.sunlitMinPct !== undefined && Number.isFinite(r.sunlitMinPct)) {
      if (r.sunlitMinPct !== rules!.sunlitMinPct) customized = true;
      rules!.sunlitMinPct = r.sunlitMinPct;
    }
    if (r.darkGapMaxH !== undefined && Number.isFinite(r.darkGapMaxH)) {
      if (r.darkGapMaxH !== rules!.darkGapMaxH) customized = true;
      rules!.darkGapMaxH = r.darkGapMaxH;
    }
    if (r.earthVisibleMinPct !== undefined && Number.isFinite(r.earthVisibleMinPct)) {
      if (r.earthVisibleMinPct !== rules!.earthVisibleMinPct) customized = true;
      rules!.earthVisibleMinPct = r.earthVisibleMinPct;
    }
    if (r.linkGapMaxH !== undefined && Number.isFinite(r.linkGapMaxH)) {
      if (r.linkGapMaxH !== rules!.linkGapMaxH) customized = true;
      rules!.linkGapMaxH = r.linkGapMaxH;
    }
  }

  return {
    id: base.id,
    name: base.name,
    stayDays,
    rules,
    label: customized ? `custom thresholds — ${PRESET_LABEL}` : base.label,
  };
}

function terrainSkyline(terrain: TerrainPayload, heightM: number): Skyline {
  if (terrain.heightM !== heightM) throw new RangeError(`the terrain skyline was built for ${terrain.heightM} m, not ${heightM} m`);
  if (!Number.isFinite(terrain.siteElevationM)) throw new RangeError('the terrain skyline has no site elevation');
  const { H, D } = decodeSkyline(terrain.buffer);
  return makeSkyline({ H, D, grade: terrain.grade, terrain: terrain.terrain, heightM });
}

interface ResolvedSite {
  siteInput: Site;
  hasTerrain: boolean;
}

function resolveSiteInput(
  site: SiteDefinition,
  heightM: number,
  marginDeg: number,
  terrain: TerrainPayload | null,
): ResolvedSite {
  // Custom coordinates always use the smooth sphere at Grade D, never a library site's terrain skyline.
  const usableTerrain = isCustomSite(site) ? null : terrain;
  const terrainSky = usableTerrain ? terrainSkyline(usableTerrain, heightM) : null;
  const sky = skylineOrSmooth(terrainSky, heightM);
  const frame = usableTerrain && terrainSky
    ? siteFrame(site.lat, site.eLon, R_MOON_KM * 1000 + usableTerrain.siteElevationM + heightM)
    : smoothSiteFrame(site.lat, site.eLon, heightM);
  return {
    siteInput: { frame, sky, marginDeg },
    hasTerrain: Boolean(terrainSky),
  };
}

interface CachedEntry {
  resolved: ResolvedSite;
  t0Ms: number;
  t1Ms: number;
  series: Series;
  rolling: RollingSeries;
}

/**
 * Per-site 10-minute series + rolling prefix-sum cache shared by Compare board cards, slip tolerance, and Window Finder.
 */
export class SiteSeriesCache {
  private table: EphemTable;
  private entries = new Map<string, CachedEntry>();

  constructor(table: EphemTable) {
    this.table = table;
  }

  get ephemTable(): EphemTable {
    return this.table;
  }

  setTable(table: EphemTable): void {
    this.table = table;
  }

  clear(): void {
    this.entries.clear();
  }

  ensure(
    site: SiteDefinition,
    heightM: number,
    marginDeg: number,
    terrain: TerrainPayload | null,
    reqStartMs: number,
    reqEndMs: number,
  ): CachedEntry {
    const usableTerrain = isCustomSite(site) ? null : terrain;
    const terrainTag = usableTerrain
      ? `${usableTerrain.grade}:${usableTerrain.terrain}:${usableTerrain.siteElevationM}:${usableTerrain.buffer.byteLength}`
      : 'D';
    const key = `${site.id}|${site.lat}|${site.eLon}|${heightM}|${marginDeg}|${terrainTag}`;
    const alignedStart = floorToTenMinutes(reqStartMs);
    const alignedEnd = Math.ceil(reqEndMs / SERIES_STEP_MS) * SERIES_STEP_MS;
    const existing = this.entries.get(key);
    if (existing && existing.t0Ms <= alignedStart && existing.t1Ms >= alignedEnd) {
      // Re-validate non-cached invariants if caller supplied damaged terrain on direct calls.
      return existing;
    }
    const resolved = resolveSiteInput(site, heightM, marginDeg, usableTerrain);
    const s = series(this.table, resolved.siteInput, alignedStart, alignedEnd, SERIES_STEP_MIN);
    const rolling = prepareRolling(s);
    const created: CachedEntry = {
      resolved,
      t0Ms: alignedStart,
      t1Ms: alignedEnd,
      series: s,
      rolling,
    };
    this.entries.set(key, created);
    return created;
  }
}

function trackPointFromSeries(s: Series, idx: number): TrackPoint {
  return {
    tMs: s.t0Ms + idx * s.stepMs,
    sunAz: s.sunAz[idx],
    sunEl: s.sunEl[idx],
    sunF: s.sunF[idx],
    earthAz: s.earthAz[idx],
    earthEl: s.earthEl[idx],
    earthVis: s.earthVis[idx] === 1,
  };
}

const EMPTY_SLIP: Slip = {
  viableAtChosen: false,
  lateDays: null,
  earlyDays: null,
  lateCensored: false,
  earlyCensored: false,
  nextWindow: null,
};

export function calculateScenarioWithCache(
  cache: SiteSeriesCache,
  site: SiteDefinition,
  requestedStartMs: number,
  presetId: string,
  heightM = 2,
  terrain: TerrainPayload | null = null,
  options?: ScenarioOptions,
): ScenarioResult {
  const preset = resolvePreset(presetId, options);
  const marginDeg = options?.marginDeg ?? 0;
  const startMs = floorToTenMinutes(requestedStartMs);
  const stayMs = snapStayMs(preset.stayDays);
  const windowEndMs = startMs + stayMs;
  const table = cache.ephemTable;
  const spanBounds = ephemSpan(table, startMs);
  if (windowEndMs > spanBounds.maxMs) {
    throw new RangeError(`stay end ${new Date(windowEndMs).toISOString()} is outside the ephemeris table`);
  }

  let firstStartMs = startMs;
  let slipCount = 0;
  let reqStartMs = startMs;
  let reqEndMs = windowEndMs;

  if (preset.rules) {
    const earlyDays = options?.slipEarlyDays ?? DEFAULT_SLIP_EARLY_DAYS;
    const lateDays = options?.slipLateDays ?? DEFAULT_SLIP_LATE_DAYS;
    const gridStartMs = Math.floor(startMs / SLIP_STEP_MS) * SLIP_STEP_MS;
    const minGridStartMs = Math.ceil(spanBounds.minMs / SLIP_STEP_MS) * SLIP_STEP_MS;
    const maxGridStartMs = Math.floor((spanBounds.maxMs - stayMs) / SLIP_STEP_MS) * SLIP_STEP_MS;
    firstStartMs = Math.max(minGridStartMs, gridStartMs - earlyDays * DAY_MS);
    const lastStartMs = Math.min(maxGridStartMs, gridStartMs + lateDays * DAY_MS);
    slipCount = Math.max(1, Math.floor((lastStartMs - firstStartMs) / SLIP_STEP_MS) + 1);
    reqStartMs = Math.min(startMs, firstStartMs);
    const paddedStayMs = Math.max(stayMs, CACHE_STAY_PAD_DAYS * DAY_MS);
    reqEndMs = Math.min(spanBounds.maxMs, Math.max(windowEndMs, lastStartMs + paddedStayMs));
  }

  const cached = cache.ensure(site, heightM, marginDeg, terrain, reqStartMs, reqEndMs);
  const calculated = cached.series;
  const { siteInput, hasTerrain } = cached.resolved;
  const { frame, sky } = siteInput;

  const windowMetrics = metrics(calculated, startMs, windowEndMs);
  const tolerance = preset.rules
    ? slip(viableFromRolling(cached.rolling, preset, firstStartMs, slipCount, SLIP_STEP_MS), firstStartMs, startMs, SLIP_STEP_MS)
    : EMPTY_SLIP;
  const decision = verdict(windowMetrics, preset, tolerance);

  const longStay = preset.stayDays > 60;
  const trackStepHours = longStay ? 6 : 1;
  const timelineStepHours = longStay ? 48 : 6;
  const trackStepIndices = Math.round((trackStepHours * HOUR_MS) / calculated.stepMs);
  const timelineEvery = Math.max(1, Math.round(timelineStepHours / trackStepHours));
  const iStart = Math.round((startMs - calculated.t0Ms) / calculated.stepMs);
  const iEnd = Math.round((windowEndMs - calculated.t0Ms) / calculated.stepMs);

  const track: TrackPoint[] = [];
  for (let idx = iStart; idx < iEnd; idx += trackStepIndices) {
    track.push(trackPointFromSeries(calculated, idx));
  }
  const timeline = track.filter((_, index) => index % timelineEvery === 0);

  const bodiesAtStart = ephemAt(table, startMs);
  const sunDistKm = norm(sub(bodiesAtStart.sun, frame.r0));
  const earthDistKm = norm(sub(bodiesAtStart.earth, frame.r0));
  const sunAngularRadiusDeg = Math.asin(Math.min(1, SUN_RADIUS_KM / sunDistKm)) / DEG;
  const earthAngularRadiusDeg = Math.asin(Math.min(1, EARTH_RADIUS_KM / earthDistKm)) / DEG;

  return {
    startMs,
    stayMs,
    preset: { id: preset.id, name: preset.name, stayDays: preset.stayDays, label: preset.label, rules: preset.rules },
    marginDeg,
    sample: sampleAt(table, siteInput, startMs),
    sunAngularRadiusDeg,
    earthAngularRadiusDeg,
    metrics: windowMetrics,
    slip: tolerance,
    verdict: decision,
    sunset: nextClock(calculated, 'sunset', startMs, windowEndMs),
    earthset: nextClock(calculated, 'earthset', startMs, windowEndMs),
    meanEarthAzimuth: meanEarthAzimuth(frame),
    skyline: hasTerrain
      ? Array.from({ length: SKY_BINS }, (_, bin) => ({
        az: (bin + 0.5) * SKY_BIN_DEG,
        elevation: sky.H[bin],
        distanceKm: sky.D[bin] / 100,
      }))
      : Array.from({ length: 181 }, (_, index) => {
        const az = index * 2;
        return { az, elevation: skylineAt(sky, az).H };
      }),
    track,
    timeline,
    timelineStepHours,
  };
}

/**
 * Orchestrates the pure engine for one scenario.
 * Used directly by tests and via SiteSeriesCache in the Web Worker; contains no display arithmetic.
 */
export function calculateScenario(
  table: EphemTable,
  site: SiteDefinition,
  requestedStartMs: number,
  presetId: string,
  heightM = 2,
  terrain: TerrainPayload | null = null,
  options?: ScenarioOptions,
): ScenarioResult {
  return calculateScenarioWithCache(
    new SiteSeriesCache(table),
    site,
    requestedStartMs,
    presetId,
    heightM,
    terrain,
    options,
  );
}

/**
 * Compute one site row of the Window Finder (daily 120 columns or weekly 52 columns, each starting at 00:00 UTC).
 */
export function calculateWindowFinderRow(
  cache: SiteSeriesCache,
  site: SiteDefinition,
  matrixStartDayMs: number,
  span: 'daily' | 'weekly',
  presetId: string,
  heightM = 2,
  terrain: TerrainPayload | null = null,
  options?: ScenarioOptions,
): WindowFinderRow {
  const preset = resolvePreset(presetId, options);
  const marginDeg = options?.marginDeg ?? 0;
  const stayMs = snapStayMs(preset.stayDays);
  const day0Ms = floorToUtcDay(matrixStartDayMs);
  const colStepMs = span === 'weekly' ? 7 * DAY_MS : DAY_MS;
  const maxCols = span === 'weekly' ? WEEKLY_WINDOW_COLUMNS : DAILY_WINDOW_COLUMNS;
  const spanBounds = ephemSpan(cache.ephemTable, day0Ms);

  const colStartsMs: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    const colMs = day0Ms + c * colStepMs;
    if (colMs >= spanBounds.minMs && colMs + stayMs <= spanBounds.maxMs) {
      colStartsMs.push(colMs);
    }
  }

  if (colStartsMs.length === 0) {
    const resolved = resolveSiteInput(site, heightM, marginDeg, terrain);
    return {
      siteId: site.id,
      grade: resolved.siteInput.sky.grade,
      terrain: resolved.siteInput.sky.terrain,
      cells: [],
    };
  }

  const minGridMs = Math.ceil(spanBounds.minMs / SLIP_STEP_MS) * SLIP_STEP_MS;
  const firstStartMs = Math.max(minGridMs, colStartsMs[0] - DEFAULT_SLIP_EARLY_DAYS * DAY_MS);
  const lastColMs = colStartsMs[colStartsMs.length - 1];
  const paddedStayMs = Math.max(stayMs, CACHE_STAY_PAD_DAYS * DAY_MS);
  const reqEndMs = Math.min(
    spanBounds.maxMs,
    lastColMs + DEFAULT_SLIP_EARLY_DAYS * DAY_MS + paddedStayMs,
  );

  const cached = cache.ensure(site, heightM, marginDeg, terrain, firstStartMs, reqEndMs);
  const verdicts = verdictSeries(cached.rolling, preset, firstStartMs, colStartsMs, SLIP_STEP_MS);

  return {
    siteId: site.id,
    grade: cached.series.grade,
    terrain: cached.series.terrain,
    cells: colStartsMs.map((startMs, index) => ({
      startMs,
      verdict: verdicts[index].verdict,
      rule: verdicts[index].rule,
    })),
  };
}
