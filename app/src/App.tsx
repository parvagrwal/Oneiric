import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  HOUR_MS,
  MIN_MS,
  PRESETS,
  heightOptions,
  provenanceFooter,
  type Clock,
  type Grade,
  type Vec3,
} from '../../engine/index.ts';
import { SkylineCanvas } from './SkylineCanvas.tsx';
import { WindowFinder } from './WindowFinder.tsx';
import { MethodDrawer, type ValidationRowData, type PendingRow } from './MethodDrawer.tsx';
import { shapeBUrl } from './horizons-url.ts';
import { timeControlForKey } from './keyboard.ts';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AUTOPILOT_SCENARIO, AUTOPILOT_STEPS, autopilotStepAt } from './autopilot-script.ts';
import { EPHEMERIS_FIRST_YEAR, EPHEMERIS_LAST_YEAR } from './coverage.ts';
import { formatHours, formatPercent, formatSlipDays, formatUtc } from './format.ts';
import { NEAR_SIDE_POSE, SOUTH_POLE_POSE, poseForSite } from './globe-math.ts';
import { Hero, type CameraPreset, type GlobeMode, type HeroStats } from './Hero.tsx';
import type { PoseRequest } from './MoonGlobe.tsx';
import { TopBar, type SectionId } from './TopBar.tsx';
import { TourOverlay } from './TourOverlay.tsx';
import { StatusLine, VerdictBadge } from './ui.tsx';
import { webglAvailable } from './webgl.ts';
import {
  DAILY_WINDOW_COLUMNS,
  DAY_MS,
  WEEKLY_WINDOW_COLUMNS,
  floorToTenMinutes,
  floorToUtcDay,
  resolvePreset,
  type ScenarioOptions,
  type ScenarioResult,
  type SiteDefinition,
  type TerrainPayload,
  type WindowFinderRow,
} from './scenario.ts';
import { formatCoordinates, groupSites, parseCustomSite } from './sites.ts';
import { heightHelpText, heightOptionLabel } from './heights-ui.ts';
import {
  MAX_COMPARE_CARDS,
  MAX_DATE_UTC,
  MIN_DATE_UTC,
  parseUrlState,
  serializeUrlState,
  type AppUrlState,
  type PresetId,
  type WindowFinderSpan,
} from './url-state.ts';
import type { WorkerResponse } from './worker-protocol.ts';

type SitesFile = {
  sites: SiteDefinition[];
};

type SkylineEntry = {
  siteId: string;
  heightM: number;
  grade: Grade;
  terrain: string;
  siteElevationM: number;
  file: string;
};

/** The key a stored skyline is filed under: one entry per site and height, never one per site. */
const terrainKey = (siteId: string, heightM: number): string => `${siteId}:${heightM}`;

type HorizonsCheckEntry = {
  id: string;
  name: string;
  n: number;
  maxDeg: number;
  rmsDeg: number;
  cachedDate: string | null;
};

type DataState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

function parseUtcInput(value: string): number {
  if (!value) return NaN;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const parsed = Date.parse(`${withSeconds}Z`);
  return Number.isFinite(parsed) ? floorToTenMinutes(parsed) : NaN;
}

function msToDateTimeInput(tMs: number): string {
  return new Date(floorToTenMinutes(tMs)).toISOString().slice(0, 16);
}

function msToDateInput(tMs: number): string {
  return new Date(floorToUtcDay(tMs)).toISOString().slice(0, 10);
}

function sanitizeFilenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function compactUtcStamp(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatEnergy(value: number): string {
  return `${value.toFixed(1)} kWh/m²`;
}

function clockLabel(clock: Clock, startMs: number): string {
  if (clock.status === 'already') return 'already below the horizon';
  if (clock.status === 'none' || clock.tMs === undefined) return 'not during this stay';
  const deltaHours = (clock.tMs - startMs) / HOUR_MS;
  return `${formatHours(deltaHours)} · ${formatUtc(clock.tMs)} UTC`;
}

function eclipseSummary(result: ScenarioResult): { value: string; note?: string } {
  const list = result.metrics.eclipses;
  if (list.length === 0) return { value: 'None', note: 'during this stay' };
  const first = list[0];
  const peak = `${Math.round(first.maxObscuration * 100)}% max cover`;
  const span = `${formatUtc(first.startMs)} – ${formatUtc(first.endMs)} UTC`;
  return {
    value: list.length === 1 ? `1 (${peak})` : `${list.length} (up to ${peak})`,
    note: list.length === 1 ? span : `First: ${span}`,
  };
}

function Timeline({ result, scrubMinutes }: { result: ScenarioResult; scrubMinutes: number }) {
  const targetMs = result.startMs + scrubMinutes * MIN_MS;
  const halfCellMs = (result.timelineStepHours * HOUR_MS) / 2;
  const stepLabel = result.timelineStepHours >= 24
    ? `every ${result.timelineStepHours / 24} days`
    : `every ${result.timelineStepHours} hours`;
  return (
    <div className="timeline-wrap">
      <div className="timeline-head">
        <span>Stay timeline</span>
        <span>Sunlight and Earth link, sampled {stepLabel}</span>
      </div>
      <div className="timeline" role="img" aria-label="Timeline of sunlight and Earth visibility during the selected stay">
        {result.timeline.map((point) => {
          const dark = point.sunF < 0.01;
          const noLink = !point.earthVis;
          const active = Math.abs(point.tMs - targetMs) <= halfCellMs;
          return (
            <div
              className={`timeline-cell ${dark ? 'is-dark' : 'is-lit'} ${noLink ? 'is-hidden' : 'is-linked'} ${active ? 'is-active' : ''}`}
              key={point.tMs}
              title={`${formatUtc(point.tMs)} UTC · Sun ${formatPercent(point.sunF * 100)} · Earth ${point.earthVis ? 'visible' : 'hidden'}`}
            />
          );
        })}
      </div>
      <div className="timeline-legend" aria-hidden="true">
        <span><i className="legend-swatch lit" /> Sunlit</span>
        <span><i className="legend-swatch dark" /> Dark</span>
        <span><i className="legend-swatch link" /> Earth visible</span>
        <span><i className="legend-swatch no-link" /> Earth hidden</span>
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <small>{note}</small>}
    </div>
  );
}

// The map library is large, so it loads after the first screen is usable.
const MapView = lazy(() => import('./MapView.tsx').then((module) => ({ default: module.MapView })));

function scrollToSection(id: SectionId): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

function clampDateString(dateTime: string): string {
  const ms = parseUtcInput(dateTime);
  const minMs = parseUtcInput(MIN_DATE_UTC);
  const maxMs = parseUtcInput(MAX_DATE_UTC);
  if (!Number.isFinite(ms)) return dateTime;
  return msToDateTimeInput(Math.max(minMs, Math.min(maxMs, ms)));
}

function App() {
  const [urlState, setUrlState] = useState<AppUrlState>(() =>
    parseUrlState(typeof window !== 'undefined' ? window.location.search : ''),
  );
  const [librarySites, setLibrarySites] = useState<SiteDefinition[]>([]);
  const [sitesState, setSitesState] = useState<DataState>({ kind: 'loading' });
  const [ephemState, setEphemState] = useState<DataState>({ kind: 'idle' });
  const [validationRows, setValidationRows] = useState<ValidationRowData[]>([]);
  const [validationPending, setValidationPending] = useState<PendingRow[]>([]);
  const [horizonsCheck, setHorizonsCheck] = useState<Map<string, HorizonsCheckEntry> | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  // Every stored skyline, keyed by site and height. One map per height is what lets the selector offer a height
  // only when a file for it exists, and fall back to the smooth sphere when it does not.
  const [skylineIndex, setSkylineIndex] = useState<SkylineEntry[] | null>(null);
  const [skylinePayloads, setSkylinePayloads] = useState<Map<string, TerrainPayload> | null>(null);
  const [skylinesReady, setSkylinesReady] = useState(false);

  const [cardResults, setCardResults] = useState<Map<string, ScenarioResult>>(new Map());
  const [compareState, setCompareState] = useState<DataState>({ kind: 'idle' });
  const [matrixRows, setMatrixRows] = useState<Map<string, WindowFinderRow>>(new Map());
  const [matrixProgress, setMatrixProgress] = useState<{
    done: number;
    total: number;
    computing: boolean;
    error: string | null;
  }>({ done: 0, total: 0, computing: false, error: null });

  const [scrubMinutes, setScrubMinutes] = useState(0);
  const [playing, setPlaying] = useState(false);
  // 3D view and tour state. Presentation only: none of it reaches a verdict, a metric, or a grade.
  const [globeMode, setGlobeMode] = useState<GlobeMode>(() => (webglAvailable() ? 'webgl' : 'static'));
  const [poseRequest, setPoseRequest] = useState<PoseRequest>({ pose: NEAR_SIDE_POSE, nonce: 0 });
  const [directions, setDirections] = useState<{ sun: Vec3 | null; earth: Vec3 | null }>({ sun: null, earth: null });
  const directionsReqRef = useRef(0);
  const [tourRunning, setTourRunning] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const tourAppliedRef = useRef(-1);
  const tourSitePoseRef = useRef<PoseRequest['pose']>(SOUTH_POLE_POSE);
  const [rulesOpen, setRulesOpen] = useState(false);
  const exportReqRef = useRef(0);
  const pendingExportsRef = useRef(new Map<number, string>());
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState('');

  // Custom coordinate form state
  const [customOpen, setCustomOpen] = useState(false);
  const [customLat, setCustomLat] = useState('');
  const [customLon, setCustomLon] = useState('');
  const [customName, setCustomName] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const compareReqRef = useRef(0);
  const matrixReqRef = useRef(0);
  const loadedYearsRef = useRef(new Set<number>());
  const bufferCacheRef = useRef(new Map<number, ArrayBuffer>());

  // Sync URL on state change
  useEffect(() => {
    const query = serializeUrlState(urlState);
    const nextUrl = `${window.location.pathname}${query}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [urlState]);

  // Listen to browser Back/Forward
  useEffect(() => {
    const onPopState = () => setUrlState(parseUrlState(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Load site library
  useEffect(() => {
    let active = true;
    fetch(dataUrl('data/sites.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`site list returned ${response.status}`);
        return response.json() as Promise<SitesFile>;
      })
      .then((payload) => {
        if (!active) return;
        setLibrarySites(payload.sites);
        const loadedIds = new Set(payload.sites.map((s) => s.id));
        setUrlState((prev) => {
          const customIds = new Set(prev.customSites.map((s) => s.id));
          const validCards = prev.cards.filter((c) => loadedIds.has(c.siteId) || customIds.has(c.siteId));
          if (validCards.length === prev.cards.length) return prev;
          return {
            ...prev,
            cards: validCards.length > 0 ? validCards : [{ siteId: payload.sites[0]?.id ?? 'connecting-ridge' }],
            activeCardIndex: 0,
          };
        });
        setSitesState({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSitesState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  // Load recorded validation results (the page only renders them; it never computes a pass)
  useEffect(() => {
    fetch(dataUrl('data/validation.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`validation data returned ${response.status}`);
        return response.json() as Promise<{ rows: ValidationRowData[]; pending?: PendingRow[] }>;
      })
      .then((payload) => {
        setValidationRows(Array.isArray(payload.rows) ? payload.rows : []);
        setValidationPending(Array.isArray(payload.pending) ? payload.pending : []);
      })
      .catch(() => {
        setValidationRows([]);
        setValidationPending([]);
      });
  }, []);

  // Load the cached per-site Horizons check (sites without a cached query are never given a number)
  useEffect(() => {
    let active = true;
    fetch(dataUrl('data/horizons-check.json'))
      .then((response) => (response.ok ? response.json() : { sites: [] as HorizonsCheckEntry[] }))
      .then((payload: { sites?: HorizonsCheckEntry[] }) => {
        if (!active) return;
        setHorizonsCheck(new Map((payload.sites ?? []).map((entry) => [entry.id, entry])));
      })
      .catch(() => {
        if (active) setHorizonsCheck(new Map());
      });
    return () => {
      active = false;
    };
  }, []);

  // Start Web Worker
  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const workerYears = loadedYearsRef.current;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'compare-result') {
        if (message.requestId !== compareReqRef.current) return;
        setCardResults(new Map(message.cards.map((item) => [item.slotKey, item.result])));
        setCompareState({ kind: 'ready' });
      } else if (message.type === 'compare-error') {
        if (message.requestId !== compareReqRef.current) return;
        setCompareState({ kind: 'error', message: message.message });
      } else if (message.type === 'matrix-chunk') {
        if (message.requestId !== matrixReqRef.current) return;
        setMatrixRows((prev) => {
          const next = new Map(prev);
          for (const row of message.rows) next.set(row.siteId, row);
          return next;
        });
        setMatrixProgress({
          done: message.done,
          total: message.total,
          computing: message.done < message.total,
          error: null,
        });
      } else if (message.type === 'matrix-done') {
        if (message.requestId !== matrixReqRef.current) return;
        setMatrixProgress((prev) => ({ ...prev, computing: false }));
      } else if (message.type === 'matrix-error') {
        if (message.requestId !== matrixReqRef.current) return;
        setMatrixProgress((prev) => ({ ...prev, computing: false, error: message.message }));
      } else if (message.type === 'directions-result') {
        if (message.requestId !== directionsReqRef.current) return;
        setDirections({ sun: message.sun, earth: message.earth });
      } else if (message.type === 'export-series-result') {
        const filename = pendingExportsRef.current.get(message.requestId);
        if (!filename) return;
        pendingExportsRef.current.delete(message.requestId);
        downloadBlob(filename, new Blob([message.csv], { type: 'text/csv;charset=utf-8' }));
        setExportNote('CSV download started');
        window.setTimeout(() => setExportNote(null), 2600);
      } else if (message.type === 'export-series-error') {
        pendingExportsRef.current.delete(message.requestId);
        setExportNote(`CSV export failed: ${message.message}`);
        window.setTimeout(() => setExportNote(null), 5000);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      workerYears.clear();
    };
  }, []);

  // Load the skyline index and every stored skyline, at every height, then hand them to the Worker once.
  // A height missing from the index is not an error: it is offered in the selector as unavailable, and any
  // request for it runs the smooth sphere, labelled grade D. A file listed in the index but not present is
  // counted and reported, because that is a broken build rather than a height not built yet.
  useEffect(() => {
    let active = true;
    fetch(dataUrl('data/skylines/index.json'))
      .then((response) => {
        if (!response.ok) return { skylines: [] as SkylineEntry[] };
        return response.json() as Promise<{ skylines: SkylineEntry[] }>;
      })
      .then(async (payload) => {
        if (!active) return;
        const entries = payload.skylines;
        setSkylineIndex(entries);
        const loaded = await Promise.all(
          entries.map(async (entry) => {
            try {
              const resp = await fetch(dataUrl(`data/skylines/${entry.file}`));
              if (!resp.ok) return null;
              const buffer = await resp.arrayBuffer();
              const terrainPayload: TerrainPayload = {
                buffer,
                grade: entry.grade,
                terrain: entry.terrain,
                siteElevationM: entry.siteElevationM,
                heightM: entry.heightM,
              };
              return { siteId: entry.siteId, key: terrainKey(entry.siteId, entry.heightM), payload: terrainPayload };
            } catch {
              return null;
            }
          }),
        );
        if (!active) return;
        const valid = loaded.filter((item): item is { siteId: string; key: string; payload: TerrainPayload } => item !== null);
        setSkylinePayloads(new Map(valid.map((item) => [item.key, item.payload])));
        workerRef.current?.postMessage({
          type: 'set-skylines',
          skylines: valid.map((item) => ({ siteId: item.siteId, payload: item.payload })),
        });
        setSkylinesReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSkylineIndex([]);
        setSkylinePayloads(new Map());
        setSkylinesReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const validation = useMemo(
    () => validationRows.find((row) => row.id === 'sun-earth-direction') ?? null,
    [validationRows],
  );
  const engineCommit = useMemo(
    () => validationRows.find((row) => row.engineCommit)?.engineCommit ?? 'unknown',
    [validationRows],
  );

  const horizonsChipText = useCallback((site: SiteDefinition): string => {
    if (site.isCustom) return 'Horizons check: not cached for custom coordinates';
    if (horizonsCheck === null) return 'Horizons check: loading…';
    const entry = horizonsCheck.get(site.id);
    if (!entry) return 'Horizons check: not cached for this site';
    const date = entry.cachedDate ?? 'date unknown';
    return `Horizons check: max ${entry.maxDeg.toFixed(4)}° · cached ${date} · ${entry.n.toLocaleString()} epochs · this site only`;
  }, [horizonsCheck]);

  const allSites = useMemo(() => {
    const map = new Map<string, SiteDefinition>();
    for (const custom of urlState.customSites) map.set(custom.id, custom);
    for (const site of librarySites) map.set(site.id, site);
    return Array.from(map.values());
  }, [librarySites, urlState.customSites]);

  const siteById = useMemo(() => new Map(allSites.map((s) => [s.id, s])), [allSites]);

  // Grade shown next to a site: the grade of the skyline at the height now on screen. A site with terrain at
  // 2 m but not at 10 m reads D at 10 m, because that is what the card will compute.
  const skylineGrades = useMemo(() => {
    const grades = new Map<string, Grade>();
    if (skylineIndex) {
      for (const entry of skylineIndex) {
        if (entry.heightM !== urlState.heightM) continue;
        grades.set(entry.siteId, entry.grade);
      }
    }
    return grades;
  }, [skylineIndex, urlState.heightM]);

  // The entries whose skyline file actually loaded. A file listed in the index but absent or unreadable is not
  // counted, so the selector never promises terrain the app does not have in hand.
  const loadedEntries = useMemo(
    () => (skylineIndex ?? []).filter((entry) => skylinePayloads?.has(terrainKey(entry.siteId, entry.heightM))),
    [skylineIndex, skylinePayloads],
  );
  const unloadedFiles = useMemo(() => {
    if (!skylinesReady || !skylineIndex) return [];
    return skylineIndex
      .filter((entry) => !skylinePayloads?.has(terrainKey(entry.siteId, entry.heightM)))
      .map((entry) => entry.file);
  }, [skylinesReady, skylineIndex, skylinePayloads]);

  // The heights the selector offers, each marked with whether any stored skyline loaded at it.
  const heights = useMemo(() => heightOptions(loadedEntries, urlState.heightM), [loadedEntries, urlState.heightM]);
  const heightEntry = useMemo(() => {
    const map = new Map<string, SkylineEntry>();
    for (const entry of loadedEntries) map.set(terrainKey(entry.siteId, entry.heightM), entry);
    return map;
  }, [loadedEntries]);

  const effectivePreset = useMemo(
    () =>
      resolvePreset(urlState.presetId, {
        stayDays: urlState.stayDays,
        rules: urlState.ruleOverrides,
        marginDeg: urlState.marginDeg,
      }),
    [urlState.marginDeg, urlState.presetId, urlState.ruleOverrides, urlState.stayDays],
  );

  const scenarioOptions: ScenarioOptions = useMemo(
    () => ({
      stayDays: urlState.stayDays,
      rules: urlState.ruleOverrides,
      marginDeg: urlState.marginDeg,
    }),
    [urlState.marginDeg, urlState.ruleOverrides, urlState.stayDays],
  );

  const globalStartMs = parseUtcInput(urlState.dateTime);
  const matrixStartDayMs = useMemo(() => {
    const parsed = Date.parse(`${urlState.windowStartDate}T00:00:00Z`);
    return Number.isFinite(parsed) ? floorToUtcDay(parsed) : floorToUtcDay(globalStartMs || Date.UTC(2027, 2, 1));
  }, [globalStartMs, urlState.windowStartDate]);

  // Determine all ephemeris years needed across compare cards + Window Finder
  const neededYearsKey = useMemo(() => {
    const times: number[] = [];
    if (Number.isFinite(globalStartMs)) times.push(globalStartMs);
    for (const card of urlState.cards) {
      if (card.dateTime) {
        const ms = parseUtcInput(card.dateTime);
        if (Number.isFinite(ms)) times.push(ms);
      }
    }
    if (Number.isFinite(matrixStartDayMs)) times.push(matrixStartDayMs);
    if (times.length === 0) return '';
    const stayBufferMs = Math.max(urlState.stayDays, 14) * DAY_MS;
    const wfSpanMs = (urlState.windowSpan === 'weekly' ? WEEKLY_WINDOW_COLUMNS * 7 : DAILY_WINDOW_COLUMNS) * DAY_MS;
    const minMs = Math.min(...times) - 35 * DAY_MS;
    const maxMs = Math.max(...times, matrixStartDayMs + wfSpanMs) + stayBufferMs + 130 * DAY_MS;
    const minY = Math.max(2023, new Date(minMs).getUTCFullYear());
    const maxY = Math.min(2040, new Date(maxMs).getUTCFullYear());
    const years: number[] = [];
    for (let y = minY; y <= maxY; y++) years.push(y);
    return years.join(',');
  }, [globalStartMs, matrixStartDayMs, urlState.cards, urlState.stayDays, urlState.windowSpan]);

  useEffect(() => {
    if (!neededYearsKey) return undefined;
    const years = neededYearsKey.split(',').map(Number);
    const missing = years.filter((y) => !loadedYearsRef.current.has(y));
    if (missing.length === 0) {
      setEphemState({ kind: 'ready' });
      return undefined;
    }
    let active = true;
    setEphemState({ kind: 'loading' });
    Promise.all(
      missing.map(async (year) => {
        const cached = bufferCacheRef.current.get(year);
        if (cached) return { year, buffer: cached };
        const response = await fetch(dataUrl(`data/ephem/${year}.bin`));
        if (!response.ok) throw new Error(`ephemeris ${year} returned ${response.status}`);
        const buffer = await response.arrayBuffer();
        bufferCacheRef.current.set(year, buffer);
        return { year, buffer };
      }),
    )
      .then((loaded) => {
        if (!active) return;
        workerRef.current?.postMessage({ type: 'set-ephem', tables: loaded });
        for (const item of loaded) loadedYearsRef.current.add(item.year);
        setEphemState({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEphemState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, [neededYearsKey]);

  const resolvedSlots = useMemo(() => {
    return urlState.cards.flatMap((card, idx) => {
      const site = siteById.get(card.siteId);
      const effectiveDate = card.dateTime ?? urlState.dateTime;
      const startMs = parseUtcInput(effectiveDate);
      if (!site || !Number.isFinite(startMs)) return [];
      const year = Number(effectiveDate.slice(0, 4));
      if (!Number.isInteger(year) || year < 2024 || year > 2039) return [];
      return [{ index: idx, slotKey: `${idx}:${site.id}:${startMs}`, card, site, startMs, effectiveDate }];
    });
  }, [siteById, urlState.cards, urlState.dateTime]);

  // Dispatch Compare board calculation
  useEffect(() => {
    if (ephemState.kind !== 'ready' || !skylinesReady || resolvedSlots.length === 0) return;
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = compareReqRef.current + 1;
    compareReqRef.current = requestId;
    setCompareState({ kind: 'loading' });
    worker.postMessage({
      type: 'compare',
      requestId,
      slots: resolvedSlots.map((s) => ({ slotKey: s.slotKey, site: s.site, startMs: s.startMs })),
      presetId: urlState.presetId,
      heightM: urlState.heightM,
      options: scenarioOptions,
    });
  }, [ephemState.kind, neededYearsKey, resolvedSlots, scenarioOptions, skylinesReady, urlState.heightM, urlState.presetId]);

  // Dispatch Window Finder calculation (does NOT re-run when only a card's date changes inside the visible range)
  useEffect(() => {
    if (ephemState.kind !== 'ready' || !skylinesReady || allSites.length === 0) return;
    if (!effectivePreset.rules) {
      matrixReqRef.current += 1;
      return;
    }
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = matrixReqRef.current + 1;
    matrixReqRef.current = requestId;
    setMatrixRows(new Map());
    setMatrixProgress({ done: 0, total: allSites.length, computing: true, error: null });
    worker.postMessage({
      type: 'matrix',
      requestId,
      sites: allSites,
      matrixStartDayMs,
      span: urlState.windowSpan,
      presetId: urlState.presetId,
      heightM: urlState.heightM,
      options: scenarioOptions,
    });
  }, [
    allSites,
    effectivePreset.rules,
    ephemState.kind,
    matrixStartDayMs,
    neededYearsKey,
    scenarioOptions,
    skylinesReady,
    urlState.heightM,
    urlState.presetId,
    urlState.windowSpan,
  ]);

  const stayMinutes = Math.round(urlState.stayDays * 1440);

  // Play time-lapse timer
  useEffect(() => {
    if (!playing) return undefined;
    const step = tourRunning
      ? Math.max(10, Math.round(stayMinutes / 600) * 10)
      : stayMinutes > 60 * 1440 ? 360 : 10;
    const timer = window.setInterval(() => {
      setScrubMinutes((current) => (current + step > stayMinutes ? 0 : current + step));
    }, 200);
    return () => window.clearInterval(timer);
  }, [playing, stayMinutes, tourRunning]);

  const resetScrub = useCallback(() => {
    setPlaying(false);
    setScrubMinutes(0);
  }, []);

  const ensureWindowCoversDate = useCallback(
    (nextDateTime: string, currentWindowStart: string, span: WindowFinderSpan): string => {
      const nextMs = parseUtcInput(nextDateTime);
      const winMs = Date.parse(`${currentWindowStart}T00:00:00Z`);
      if (!Number.isFinite(nextMs) || !Number.isFinite(winMs)) return nextDateTime.slice(0, 10);
      const spanMs = (span === 'weekly' ? WEEKLY_WINDOW_COLUMNS * 7 : DAILY_WINDOW_COLUMNS) * DAY_MS;
      const dayMs = floorToUtcDay(nextMs);
      if (dayMs < winMs || dayMs >= winMs + spanMs) {
        return msToDateInput(dayMs);
      }
      return currentWindowStart;
    },
    [],
  );

  const handleGlobalDateChange = (nextValue: string) => {
    resetScrub();
    setUrlState((prev) => ({
      ...prev,
      dateTime: nextValue,
      windowStartDate: ensureWindowCoversDate(nextValue, prev.windowStartDate, prev.windowSpan),
    }));
  };

  const shiftGlobalDateDays = (deltaDays: number) => {
    const baseMs = Number.isFinite(globalStartMs) ? globalStartMs : Date.UTC(2027, 2, 1);
    const shifted = clampDateString(msToDateTimeInput(baseMs + deltaDays * DAY_MS));
    handleGlobalDateChange(shifted);
  };

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextPreset = event.target.value as PresetId;
    resetScrub();
    setUrlState((prev) => ({
      ...prev,
      presetId: nextPreset,
      stayDays: PRESETS[nextPreset].stayDays,
      ruleOverrides: {},
    }));
  };

  // Changing the observer height changes which stored skyline each site may use. It never changes a stored
  // skyline: a height with no file falls to the smooth sphere at grade D, and the card labels it so.
  const handleHeightChange = (heightM: number) => {
    if (!Number.isFinite(heightM) || heightM < 0) return;
    resetScrub();
    setUrlState((prev) => ({ ...prev, heightM }));
  };

  const handleStayChange = (event: ChangeEvent<HTMLInputElement>) => {
    const val = Number(event.target.value);
    if (!Number.isFinite(val) || val < 0.5 || val > 365) return;
    resetScrub();
    setUrlState((prev) => ({ ...prev, stayDays: Math.round(val * 2) / 2 }));
  };

  const updateRuleOverride = (
    key: keyof AppUrlState['ruleOverrides'],
    raw: string,
    min: number,
    max: number,
  ) => {
    const val = Number(raw);
    if (!Number.isFinite(val) || val < min || val > max) return;
    setUrlState((prev) => ({
      ...prev,
      ruleOverrides: { ...prev.ruleOverrides, [key]: Math.round(val * 10) / 10 },
    }));
  };

  const resetRulesToDefault = () => {
    setUrlState((prev) => ({
      ...prev,
      stayDays: PRESETS[prev.presetId].stayDays,
      marginDeg: 0,
      ruleOverrides: {},
    }));
  };

  const selectSiteIntoActiveCard = (siteId: string) => {
    resetScrub();
    setUrlState((prev) => {
      const existingIdx = prev.cards.findIndex((c) => c.siteId === siteId && !c.dateTime);
      if (existingIdx >= 0) {
        return { ...prev, activeCardIndex: existingIdx };
      }
      const nextCards = prev.cards.map((card, i) =>
        i === prev.activeCardIndex ? { ...card, siteId } : card,
      );
      return { ...prev, cards: nextCards };
    });
  };

  const toggleCompareSite = (siteId: string) => {
    resetScrub();
    setUrlState((prev) => {
      const existingIdx = prev.cards.findIndex((c) => c.siteId === siteId);
      if (existingIdx >= 0) {
        if (prev.cards.length <= 1) return prev;
        const nextCards = prev.cards.filter((_, i) => i !== existingIdx);
        return {
          ...prev,
          cards: nextCards,
          activeCardIndex: Math.min(nextCards.length - 1, prev.activeCardIndex),
        };
      }
      if (prev.cards.length >= MAX_COMPARE_CARDS) {
        const nextCards = prev.cards.map((c, i) => (i === prev.activeCardIndex ? { siteId } : c));
        return { ...prev, cards: nextCards };
      }
      const nextCards = [...prev.cards, { siteId }];
      return { ...prev, cards: nextCards, activeCardIndex: nextCards.length - 1 };
    });
  };

  const duplicateCardWithSlip = (cardIndex: number, slipDays = 21) => {
    setUrlState((prev) => {
      if (prev.cards.length >= MAX_COMPARE_CARDS) return prev;
      const source = prev.cards[cardIndex];
      const baseMs = parseUtcInput(source.dateTime ?? prev.dateTime);
      const nextDate = Number.isFinite(baseMs)
        ? clampDateString(msToDateTimeInput(baseMs + slipDays * DAY_MS))
        : prev.dateTime;
      const nextCards = [...prev.cards, { siteId: source.siteId, dateTime: nextDate }];
      return { ...prev, cards: nextCards, activeCardIndex: nextCards.length - 1 };
    });
  };

  const setCardDateOverride = (cardIndex: number, dateTime: string | undefined) => {
    setUrlState((prev) => ({
      ...prev,
      cards: prev.cards.map((card, i) => (i === cardIndex ? { siteId: card.siteId, dateTime } : card)),
    }));
  };

  const removeCard = (cardIndex: number) => {
    setUrlState((prev) => {
      if (prev.cards.length <= 1) return prev;
      const nextCards = prev.cards.filter((_, i) => i !== cardIndex);
      return {
        ...prev,
        cards: nextCards,
        activeCardIndex: Math.min(nextCards.length - 1, prev.activeCardIndex),
      };
    });
  };

  const handleAddCustomCoordinate = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseCustomSite(customLat, customLon, customName);
    if (!parsed.ok) {
      setCustomError(parsed.error);
      return;
    }
    setCustomError(null);
    setCustomLat('');
    setCustomLon('');
    setCustomName('');
    resetScrub();
    setUrlState((prev) => {
      const nextCustom = prev.customSites.some((s) => s.id === parsed.site.id)
        ? prev.customSites.map((s) => (s.id === parsed.site.id ? parsed.site : s))
        : [...prev.customSites, parsed.site];
      const canAppend = prev.cards.length < MAX_COMPARE_CARDS && !prev.cards.some((c) => c.siteId === parsed.site.id);
      const nextCards = canAppend
        ? [...prev.cards, { siteId: parsed.site.id }]
        : prev.cards.map((c, i) => (i === prev.activeCardIndex ? { siteId: parsed.site.id } : c));
      const nextActive = canAppend ? nextCards.length - 1 : prev.activeCardIndex;
      return {
        ...prev,
        customSites: nextCustom,
        cards: nextCards,
        activeCardIndex: nextActive,
      };
    });
  };

  const handleSelectWindowScenario = useCallback(
    (siteId: string, dayStartMs: number, addCard: boolean) => {
      resetScrub();
      const nextDate = clampDateString(msToDateTimeInput(dayStartMs));
      setUrlState((prev) => {
        if (addCard && prev.cards.length < MAX_COMPARE_CARDS) {
          const nextCards = [...prev.cards, { siteId, dateTime: nextDate }];
          return { ...prev, cards: nextCards, activeCardIndex: nextCards.length - 1 };
        }
        const existingIdx = prev.cards.findIndex((c) => c.siteId === siteId && !c.dateTime);
        const targetIdx = existingIdx >= 0 ? existingIdx : prev.activeCardIndex;
        const nextCards = prev.cards.map((card, i) =>
          i === targetIdx ? { siteId } : card,
        );
        return {
          ...prev,
          dateTime: nextDate,
          cards: nextCards,
          activeCardIndex: targetIdx,
        };
      });
    },
    [resetScrub],
  );

  const handleShare = async () => {
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareNote('Scenario link copied');
    } catch {
      window.prompt('Copy scenario link:', shareUrl);
      setShareNote('Scenario link ready');
    }
    window.setTimeout(() => setShareNote(null), 2600);
  };

  const handleExportCsv = (slot: (typeof resolvedSlots)[number], result: ScenarioResult) => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = exportReqRef.current + 1;
    exportReqRef.current = requestId;
    const stem = `oneiric-${sanitizeFilenamePart(slot.site.id)}-${compactUtcStamp(result.startMs)}`;
    pendingExportsRef.current.set(requestId, `${stem}.csv`);
    worker.postMessage({
      type: 'export-series',
      requestId,
      site: slot.site,
      startMs: slot.startMs,
      presetId: urlState.presetId,
      heightM: urlState.heightM,
      options: scenarioOptions,
    });
  };

  const handleExportJson = (slot: (typeof resolvedSlots)[number], result: ScenarioResult) => {
    const site = slot.site;
    const stem = `oneiric-${sanitizeFilenamePart(site.id)}-${compactUtcStamp(result.startMs)}`;
    const cached = horizonsCheck?.get(site.id) ?? null;
    const payload = {
      tool: 'Oneiric',
      exportedAtUtc: new Date().toISOString(),
      site: {
        id: site.id,
        name: site.name,
        label: site.label,
        lat: site.lat,
        eLon: site.eLon,
        source: site.source,
        sourceUrl: site.sourceUrl,
        custom: Boolean(site.isCustom),
      },
      scenario: {
        startUtc: new Date(result.startMs).toISOString(),
        stayDays: urlState.stayDays,
        heightM: urlState.heightM,
        marginDeg: result.marginDeg,
        preset: {
          id: result.preset.id,
          name: result.preset.name,
          stayDays: result.preset.stayDays,
          rules: result.preset.rules,
          label: result.preset.label,
        },
      },
      result: {
        verdict: result.verdict.verdict,
        decidingRule: result.verdict.rule,
        grade: result.verdict.grade,
        terrain: result.verdict.terrain,
        metrics: {
          sunlitPct: result.metrics.sunlitPct,
          longestDarkGapH: result.metrics.longestDarkGapH,
          earthVisiblePct: result.metrics.earthVisiblePct,
          longestLinkGapH: result.metrics.longestLinkGapH,
          overlapPct: result.metrics.overlapPct,
          eclipses: result.metrics.eclipses.map((eclipse) => ({
            startUtc: new Date(eclipse.startMs).toISOString(),
            endUtc: new Date(eclipse.endMs).toISOString(),
            maxObscuration: eclipse.maxObscuration,
          })),
          energyKWhM2: result.metrics.energyKWhM2,
          fixedVerticalBestFacingDeg: result.metrics.fixedVerticalBestFacingDeg,
        },
        slip: result.slip,
      },
      datasets: {
        ephemeris: 'JPL Horizons, hourly 2023-2040, MOON_ME frame (mean Earth and pole), east-positive longitude, 1,737.4 km sphere, linear interpolation',
        terrain: result.verdict.terrain,
        grade: result.verdict.grade,
        engineCommit,
      },
      reproduce: {
        sun: shapeBUrl(site, 'sun', result.startMs, urlState.stayDays),
        earth: shapeBUrl(site, 'earth', result.startMs, urlState.stayDays),
        note: 'These Horizons queries return the directions the direction check compares against the cached table. The figures on screen are computed from the cached hourly table, never from a live call.',
      },
      horizonsCheck: cached
        ? {
            maxDeg: cached.maxDeg,
            rmsDeg: cached.rmsDeg,
            n: cached.n,
            cachedDate: cached.cachedDate,
            note: 'Recomputed from the cached Horizons site query; present only because a cached query exists for this site.',
          }
        : null,
    };
    downloadBlob(`${stem}.json`, new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json;charset=utf-8' }));
    setExportNote('JSON download started');
    window.setTimeout(() => setExportNote(null), 2600);
  };

  const applyTimeControl = (key: string): boolean => {
    const action = timeControlForKey(key, scrubMinutes, stayMinutes);
    if (!action) return false;
    if (action.type === 'toggle-play') {
      setPlaying((current) => !current);
    } else {
      setPlaying(false);
      setScrubMinutes(action.minutes);
    }
    return true;
  };

  const handleViewKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (applyTimeControl(event.key)) event.preventDefault();
  };

  const handleScrubKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (applyTimeControl(event.key)) event.preventDefault();
  };

  const filteredSites = useMemo(() => {
    const q = siteFilter.trim().toLowerCase();
    if (!q) return allSites;
    return allSites.filter(
      (s) =>
        s.name.toLowerCase().includes(q)
        || s.label.toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q),
    );
  }, [allSites, siteFilter]);

  const siteGroups = useMemo(() => groupSites(filteredSites), [filteredSites]);

  const comparedSiteIds = useMemo(
    () => new Set(urlState.cards.map((c) => c.siteId)),
    [urlState.cards],
  );

  const activeCard = urlState.cards[urlState.activeCardIndex] ?? urlState.cards[0];
  const activeSiteId = activeCard?.siteId ?? 'connecting-ridge';

  const selectedYear = Number(urlState.dateTime.slice(0, 4));
  const dateRangeError = !Number.isInteger(selectedYear) || selectedYear < 2024 || selectedYear > 2039
    ? 'Choose a date from January 2024 through December 2039 so the surrounding cached years are available.'
    : null;
  const dateInputError = Number.isFinite(globalStartMs) ? null : 'Choose a valid UTC date and time.';

  const statusMessage = dateRangeError
    ?? dateInputError
    ?? (ephemState.kind === 'error' ? ephemState.message : null)
    ?? (compareState.kind === 'error' ? compareState.message : null);

  const isRulesCustomized =
    urlState.stayDays !== PRESETS[urlState.presetId].stayDays
    || urlState.marginDeg !== 0
    || Object.keys(urlState.ruleOverrides).length > 0;

  const activeSlot = resolvedSlots.find((slot) => slot.index === urlState.activeCardIndex) ?? resolvedSlots[0];
  const activeResult = activeSlot ? cardResults.get(activeSlot.slotKey) : undefined;
  const activeSite = activeSlot?.site ?? siteById.get(activeSiteId);
  const clampedScrub = Math.min(scrubMinutes, stayMinutes);
  const scrubStep = stayMinutes > 60 * 1440 ? 360 : 10;
  const instantMs = activeSlot ? activeSlot.startMs + clampedScrub * MIN_MS : null;

  // Ask the engine where the Sun and Earth are at the selected instant. Used by the Moon view only.
  useEffect(() => {
    if (ephemState.kind !== 'ready' || instantMs === null) return;
    const worker = workerRef.current;
    if (!worker) return;
    directionsReqRef.current += 1;
    worker.postMessage({ type: 'directions', requestId: directionsReqRef.current, tMs: instantMs });
  }, [ephemState.kind, instantMs, neededYearsKey]);

  const skylineCheck = validationRows.find((row) => row.id === 'skyline-synthetic') ?? null;
  const heroStats: HeroStats = {
    siteCount: librarySites.length,
    skylineCount: skylineIndex ? skylineGrades.size : null,
    firstYear: EPHEMERIS_FIRST_YEAR,
    lastYear: EPHEMERIS_LAST_YEAR,
    firstPickDate: MIN_DATE_UTC.slice(0, 10),
    lastPickDate: MAX_DATE_UTC.slice(0, 10),
    directionMaxDeg: validation?.maxDeg ?? null,
    directionLimitDeg: validation?.thresholdDeg ?? null,
    skylineMaxDeg: skylineCheck?.maxDeg ?? null,
    skylineLimitDeg: skylineCheck?.thresholdDeg ?? null,
  };

  const flyTo = (pose: PoseRequest['pose']) => setPoseRequest((prev) => ({ pose, nonce: prev.nonce + 1 }));

  const handleCameraPreset = (preset: CameraPreset) => {
    if (preset === 'south-pole') flyTo(SOUTH_POLE_POSE);
    else if (preset === 'near-side') flyTo(NEAR_SIDE_POSE);
    else if (activeSite) flyTo(poseForSite(activeSite.lat, activeSite.eLon));
  };

  // A marker click loads that site into the active card through the same URL state as the site list.
  const handleGlobePick = (siteId: string) => {
    selectSiteIntoActiveCard(siteId);
    const site = siteById.get(siteId);
    if (site) flyTo(poseForSite(site.lat, site.eLon));
  };

  const stopTour = useCallback(() => {
    setTourRunning(false);
    setPlaying(false);
  }, []);

  // One tour step: camera, scroll position, time-lapse, and the 21-day slip at the end.
  const applyTourStep = useCallback((index: number) => {
    const step = AUTOPILOT_STEPS[index];
    if (!step) return;
    tourAppliedRef.current = index;
    setTourStep(index);
    const pose =
      step.camera === 'near-side' ? NEAR_SIDE_POSE
      : step.camera === 'south-pole' ? SOUTH_POLE_POSE
      : step.camera === 'site' ? tourSitePoseRef.current
      : null;
    if (pose) setPoseRequest((prev) => ({ pose, nonce: prev.nonce + 1 }));
    setPlaying(step.playTime);
    if (!step.playTime) setScrubMinutes(0);
    scrollToSection(step.scrollTo === 'hero' ? 'globe' : 'board');
    const slipDays = step.slipDays;
    if (slipDays) {
      setUrlState((prev) => {
        if (prev.cards.length !== 1) return prev;
        const baseMs = parseUtcInput(prev.cards[0].dateTime ?? prev.dateTime);
        if (!Number.isFinite(baseMs)) return prev;
        const dateTime = clampDateString(msToDateTimeInput(baseMs + slipDays * DAY_MS));
        return { ...prev, cards: [...prev.cards, { siteId: prev.cards[0].siteId, dateTime }], activeCardIndex: 1 };
      });
    }
  }, []);

  // The tour loads one sample scenario with the default rules, then moves the camera and the clock on a script.
  const startTour = () => {
    setUrlState((prev) => ({
      ...prev,
      dateTime: AUTOPILOT_SCENARIO.dateTime,
      presetId: AUTOPILOT_SCENARIO.presetId,
      stayDays: PRESETS[AUTOPILOT_SCENARIO.presetId].stayDays,
      marginDeg: 0,
      ruleOverrides: {},
      cards: [{ siteId: AUTOPILOT_SCENARIO.siteId }],
      activeCardIndex: 0,
      windowStartDate: AUTOPILOT_SCENARIO.dateTime.slice(0, 10),
    }));
    const tourSite = siteById.get(AUTOPILOT_SCENARIO.siteId);
    if (tourSite) tourSitePoseRef.current = poseForSite(tourSite.lat, tourSite.eLon);
    setScrubMinutes(0);
    applyTourStep(0);
    setTourRunning(true);
  };

  // Tour clock. Any click, key press, scroll, or touch hands control back at once.
  useEffect(() => {
    if (!tourRunning) return undefined;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const index = autopilotStepAt((performance.now() - startedAt) / 1000);
      if (index < 0) stopTour();
      else if (index !== tourAppliedRef.current) applyTourStep(index);
    }, 200);
    const passive = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', stopTour, true);
    window.addEventListener('keydown', stopTour, true);
    window.addEventListener('wheel', stopTour, passive);
    window.addEventListener('touchstart', stopTour, passive);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', stopTour, true);
      window.removeEventListener('keydown', stopTour, true);
      window.removeEventListener('wheel', stopTour, passive);
      window.removeEventListener('touchstart', stopTour, passive);
    };
  }, [tourRunning, stopTour, applyTourStep]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="app-shell">
      <TopBar
        site={activeSite}
        result={activeResult}
        scrubMinutes={clampedScrub}
        instantMs={instantMs}
        onNavigate={scrollToSection}
        onOpenMethod={() => setMethodOpen(true)}
      />

      <main>
        <Hero
          globeMode={globeMode}
          onGlobeFailed={() => setGlobeMode('static')}
          sites={allSites}
          grades={skylineGrades}
          activeSite={activeSite}
          activeSiteId={activeSiteId}
          comparedSiteIds={comparedSiteIds}
          result={activeResult}
          statusMessage={statusMessage}
          scrubMinutes={clampedScrub}
          stayMinutes={stayMinutes}
          scrubStep={scrubStep}
          playing={playing}
          onScrub={(minutes) => {
            setPlaying(false);
            setScrubMinutes(minutes);
          }}
          onTogglePlay={() => setPlaying((current) => !current)}
          sunDir={directions.sun}
          earthDir={directions.earth}
          stats={heroStats}
          poseRequest={poseRequest}
          onCameraPreset={handleCameraPreset}
          tourRotates={tourRunning && tourStep === 0}
          tourRunning={tourRunning}
          onPickSite={handleGlobePick}
          onOpenBoard={() => scrollToSection('board')}
          onOpenMethod={() => setMethodOpen(true)}
          onStartTour={startTour}
        />

        <section className="scenario-bar" aria-label="Scenario controls">
          <div className="scenario-bar-row">
            <div className="bar-field">
              <label htmlFor="landing-utc-input">Landing date and time (UTC)</label>
              <input
                id="landing-utc-input"
                type="datetime-local"
                value={urlState.dateTime}
                min={MIN_DATE_UTC}
                max={MAX_DATE_UTC}
                step={600}
                onChange={(e) => handleGlobalDateChange(e.target.value)}
              />
              <div className="quick-slip-row" role="group" aria-label="Quick date shift">
                <button type="button" onClick={() => shiftGlobalDateDays(-7)}>−7 d</button>
                <button type="button" onClick={() => shiftGlobalDateDays(7)}>+7 d</button>
                <button type="button" onClick={() => shiftGlobalDateDays(21)}>+21 d slip</button>
              </div>
            </div>

            <div className="bar-field">
              <label htmlFor="preset-select">Requirements preset</label>
              <select id="preset-select" value={urlState.presetId} onChange={handlePresetChange}>
                <option value="sortie">6.5-day sortie</option>
                <option value="lander">One-lunar-day lander · 14 days</option>
                <option value="year">One-year stay · annual figures</option>
              </select>
              <small>Illustrative, not agency requirements</small>
            </div>

            <div className="bar-field bar-field-compact">
              <label htmlFor="stay-days-input">Stay (days)</label>
              <input
                id="stay-days-input"
                type="number"
                min={0.5}
                max={365}
                step={0.5}
                value={urlState.stayDays}
                onChange={handleStayChange}
              />
              <small>0.5 d steps</small>
            </div>

            <div className="bar-field bar-field-compact">
              <label htmlFor="height-select">Observer height</label>
              <select
                id="height-select"
                value={String(urlState.heightM)}
                onChange={(e) => handleHeightChange(Number(e.target.value))}
              >
                {heights.map((option) => (
                  <option key={option.heightM} value={String(option.heightM)}>
                    {heightOptionLabel(option)}
                  </option>
                ))}
              </select>
              <small>{heightHelpText(heights.find((h) => h.heightM === urlState.heightM), skylinesReady, urlState.heightM)}</small>
            </div>

            <div className="bar-actions">
              <button
                type="button"
                className={`secondary-bar-btn ${rulesOpen || isRulesCustomized ? 'is-highlighted' : ''}`}
                aria-expanded={rulesOpen}
                onClick={() => setRulesOpen((open) => !open)}
              >
                {isRulesCustomized ? 'Rules (edited)' : 'Edit rules'}
              </button>
              <button type="button" className="share-btn" onClick={handleShare}>
                {shareNote ?? 'Share link'}
              </button>
            </div>
          </div>

          {rulesOpen && (
            <div className="rules-editor" aria-label="Editable requirement thresholds">
              <div className="rules-editor-head">
                <span>
                  Editable thresholds · <strong>illustrative, not agency requirements</strong> · MARGINAL when rules pass with under 3 days of late slip
                </span>
                <button
                  type="button"
                  className="reset-rules-btn"
                  disabled={!isRulesCustomized}
                  onClick={resetRulesToDefault}
                >
                  Reset preset defaults
                </button>
              </div>
              {effectivePreset.rules ? (
                <div className="rules-grid">
                  <label>
                    <span>Min sunlit (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={effectivePreset.rules.sunlitMinPct}
                      onChange={(e) => updateRuleOverride('sunlitMinPct', e.target.value, 0, 100)}
                    />
                  </label>
                  <label>
                    <span>Max dark gap (h)</span>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={0.5}
                      value={effectivePreset.rules.darkGapMaxH}
                      onChange={(e) => updateRuleOverride('darkGapMaxH', e.target.value, 0, 1000)}
                    />
                  </label>
                  <label>
                    <span>Min Earth visible (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={effectivePreset.rules.earthVisibleMinPct}
                      onChange={(e) => updateRuleOverride('earthVisibleMinPct', e.target.value, 0, 100)}
                    />
                  </label>
                  <label>
                    <span>Max link gap (h)</span>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={0.5}
                      value={effectivePreset.rules.linkGapMaxH}
                      onChange={(e) => updateRuleOverride('linkGapMaxH', e.target.value, 0, 1000)}
                    />
                  </label>
                  <label>
                    <span>Earth horizon margin (°)</span>
                    <input
                      type="number"
                      min={-5}
                      max={45}
                      step={0.5}
                      value={urlState.marginDeg}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= -5 && v <= 45) {
                          setUrlState((prev) => ({ ...prev, marginDeg: Math.round(v * 10) / 10 }));
                        }
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="rules-grid">
                  <p className="rules-year-note">
                    The one-year stay reports annual illumination, energy, link availability, and the longest dark period without pass/fail thresholds.
                  </p>
                  <label>
                    <span>Earth horizon margin (°)</span>
                    <input
                      type="number"
                      min={-5}
                      max={45}
                      step={0.5}
                      value={urlState.marginDeg}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= -5 && v <= 45) {
                          setUrlState((prev) => ({ ...prev, marginDeg: Math.round(v * 10) / 10 }));
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="workspace-grid">
          <aside className="site-panel" aria-label="Site library and custom coordinates">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Site library</p>
                <h2>{allSites.length || '—'} sites</h2>
              </div>
              <button
                type="button"
                className="custom-toggle-btn"
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((open) => !open)}
              >
                {customOpen ? 'Close' : '+ Custom lat/lon'}
              </button>
            </div>

            {customOpen && (
              <form className="custom-coord-form" onSubmit={handleAddCustomCoordinate}>
                <p className="custom-form-note">
                  Custom coordinates use a smooth-sphere horizon (no terrain) and are always labelled <strong>Grade D</strong>.
                </p>
                <div className="custom-coord-row">
                  <label>
                    <span>Latitude (°N, −S)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. -85.5"
                      value={customLat}
                      onChange={(e) => setCustomLat(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Longitude (°E, −W)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 31.2"
                      value={customLon}
                      onChange={(e) => setCustomLon(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  <span>Label (optional)</span>
                  <input
                    type="text"
                    placeholder="e.g. Candidate ridge point"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </label>
                {customError && <p className="error-text custom-error">{customError}</p>}
                <button type="submit" className="play-button custom-submit-btn">
                  Add Grade D point
                </button>
              </form>
            )}

            <div className="site-filter-box">
              <label htmlFor="site-search-input" className="sr-only">Filter sites by name</label>
              <input
                id="site-search-input"
                type="search"
                placeholder="Filter sites…"
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
              />
            </div>

            {sitesState.kind === 'loading' && <p className="muted">Loading coordinates…</p>}
            {sitesState.kind === 'error' && <p className="error-text">{sitesState.message}</p>}

            <div className="site-groups">
              {siteGroups.map((group) => (
                <div className="site-group" key={group.key}>
                  <div className="site-group-head">
                    <h3>{group.title}</h3>
                    {group.note && <p>{group.note}</p>}
                  </div>
                  <div className="site-list">
                    {group.sites.map((site) => {
                      const inCompareIdx = urlState.cards.findIndex((c) => c.siteId === site.id);
                      const inCompare = inCompareIdx >= 0;
                      const isActive = site.id === activeSiteId;
                      // Grade at the height on screen, not at the height the site happens to have a file for.
                      const entry = site.isCustom ? undefined : heightEntry.get(terrainKey(site.id, urlState.heightM));
                      const grade = entry?.grade ?? 'D';
                      const terrainTitle = entry
                        ? `${entry.terrain}, observer at ${urlState.heightM} m (Grade ${entry.grade})`
                        : `Smooth sphere, no terrain at ${urlState.heightM} m (Grade D)`;
                      return (
                        <div className={`site-row ${isActive ? 'is-active' : ''} ${inCompare ? 'is-compared' : ''}`} key={site.id}>
                          <button
                            className="site-button"
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => selectSiteIntoActiveCard(site.id)}
                          >
                            <span>
                              <strong>{site.name}</strong>
                              <small>{formatCoordinates(site.lat, site.eLon, 2)}</small>
                            </span>
                            <b title={terrainTitle}>{grade}</b>
                          </button>
                          <button
                            type="button"
                            className={`compare-slot-btn ${inCompare ? 'is-in' : ''}`}
                            aria-label={inCompare ? `Remove ${site.name} from compare board` : `Add ${site.name} to compare board`}
                            title={inCompare ? (urlState.cards.length > 1 ? 'Remove from compare board' : 'At least one card stays open') : 'Compare side by side (up to 4)'}
                            disabled={inCompare && urlState.cards.length <= 1}
                            onClick={() => toggleCompareSite(site.id)}
                          >
                            {inCompare ? `#${inCompareIdx + 1}` : '+'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className="panel-note">
              Every library coordinate cites its published source. Grades B and C use LOLA south-pole rasters; Grade D uses the smooth sphere.
            </p>
          </aside>

          <div className="main-column">
            <section id="board" className="compare-section" aria-label="Compare board" aria-live="polite">
              <div className="compare-board-bar">
                <div>
                  <span className="compare-count-pill">
                    Compare board · {urlState.cards.length} of {MAX_COMPARE_CARDS} cards
                  </span>
                  <span className="compare-hint">
                    Click a card to make it the target for site-list and Window Finder clicks, or press <strong>+</strong> beside any site to add up to four cards.
                  </span>
                </div>
                <div className="scrub-controls global-scrub">
                  <button
                    type="button"
                    className="play-button"
                    onClick={() => setPlaying((current) => !current)}
                    aria-label={playing ? 'Pause skyline time-lapse' : 'Play skyline time-lapse'}
                  >
                    {playing ? 'Pause' : 'Play'}
                  </button>
                  <input
                    aria-label="Scrub through the stay across compared cards"
                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End Space"
                    type="range"
                    min="0"
                    max={stayMinutes}
                    step={stayMinutes > 60 * 1440 ? 360 : 10}
                    value={Math.min(scrubMinutes, stayMinutes)}
                    onKeyDown={handleScrubKeyDown}
                    onChange={(event) => {
                      setPlaying(false);
                      setScrubMinutes(Number(event.target.value));
                    }}
                  />
                  <span>{formatHours(Math.min(scrubMinutes, stayMinutes) / 60)} into stay</span>
                </div>
              </div>

              {statusMessage && <div className="status-banner error-text">{statusMessage}</div>}

              {!statusMessage && resolvedSlots.length === 0 && (
                <div className="status-card">
                  <span className="spinner" aria-hidden="true" />
                  <strong>Preparing the compare board…</strong>
                  <span>Loading site library and cached JPL Horizons tables.</span>
                </div>
              )}

              <div className={`compare-grid cards-${Math.min(4, Math.max(1, resolvedSlots.length))}`}>
                {resolvedSlots.map((slot) => {
                  const result = cardResults.get(slot.slotKey);
                  const isActiveSlot = slot.index === urlState.activeCardIndex;
                  const compact = resolvedSlots.length > 1;
                  const eclipses = result ? eclipseSummary(result) : null;

                  return (
                    <motion.article
                      className={`scenario-card ${isActiveSlot ? 'is-active-slot' : ''}`}
                      key={`${slot.index}-${slot.site.id}`}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      tabIndex={0}
                      aria-label={`${slot.site.name} scenario card. Focus and use arrow keys to step time by ten minutes, or Space to play and pause.`}
                      onKeyDown={handleViewKeyDown}
                      onClick={() => {
                        if (urlState.activeCardIndex !== slot.index) {
                          setUrlState((prev) => ({ ...prev, activeCardIndex: slot.index }));
                        }
                      }}
                    >
                      <div className="card-slot-toolbar" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`slot-focus-btn ${isActiveSlot ? 'is-active' : ''}`}
                          onClick={() => setUrlState((prev) => ({ ...prev, activeCardIndex: slot.index }))}
                        >
                          {isActiveSlot ? `Card ${slot.index + 1} · Active` : `Card ${slot.index + 1} · Target`}
                        </button>
                        <div className="slot-actions">
                          {slot.card.dateTime ? (
                            <>
                              <input
                                type="datetime-local"
                                aria-label={`Custom UTC landing date for card ${slot.index + 1}`}
                                className="card-date-input"
                                value={slot.card.dateTime}
                                min={MIN_DATE_UTC}
                                max={MAX_DATE_UTC}
                                step={600}
                                onChange={(e) => setCardDateOverride(slot.index, e.target.value)}
                              />
                              <button
                                type="button"
                                className="card-mini-btn"
                                onClick={() => setCardDateOverride(slot.index, undefined)}
                              >
                                Sync to bar
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="card-mini-btn"
                              onClick={() => setCardDateOverride(slot.index, urlState.dateTime)}
                              title="Give this card its own landing date while keeping other cards at the bar date"
                            >
                              Pin date
                            </button>
                          )}
                          {urlState.cards.length < MAX_COMPARE_CARDS && (
                            <button
                              type="button"
                              className="card-mini-btn"
                              onClick={() => duplicateCardWithSlip(slot.index, 21)}
                              title="Duplicate this site onto a new card shifted 21 days later"
                            >
                              +21 d card
                            </button>
                          )}
                          {urlState.cards.length > 1 && (
                            <button
                              type="button"
                              className="card-mini-btn is-remove"
                              aria-label={`Remove card ${slot.index + 1}`}
                              onClick={() => removeCard(slot.index)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      {!result ? (
                        <div className="card-loading">
                          <span className="spinner" aria-hidden="true" />
                          <strong>Calculating {slot.site.name}…</strong>
                          <span>Running pure engine in Web Worker</span>
                        </div>
                      ) : (
                        <>
                          <div className="scenario-card-head">
                            <div>
                              <h2>{slot.site.name}</h2>
                              {slot.site.label !== slot.site.name && (
                                <p className="site-sub-label">{slot.site.label}</p>
                              )}
                              <p className="coordinates">
                                {formatCoordinates(slot.site.lat, slot.site.eLon, 4)} · {formatUtc(result.startMs)} UTC ·{' '}
                                <a
                                  href={slot.site.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {slot.site.source} ↗
                                </a>
                              </p>
                            </div>
                            <VerdictBadge verdict={result.verdict.verdict} grade={result.verdict.grade} />
                          </div>

                          <StatusLine result={result} scrubMinutes={clampedScrub} />
                          <p className="decision-rule">{result.verdict.rule}</p>
                          <p className="preset-note">
                            {result.preset.name} ({result.preset.stayDays} d) · {result.verdict.presetLabel}
                          </p>

                          <div className="slip-banner">
                            {!result.preset.rules ? (
                              <div className="slip-annual">
                                <span>Slip tolerance</span>
                                <strong>One-year summary — no pass/fail window</strong>
                              </div>
                            ) : result.slip.viableAtChosen ? (
                              <div className="slip-viable-grid">
                                <div>
                                  <span>Slip later</span>
                                  <strong>
                                    {result.slip.lateCensored ? '≥ ' : '+'}
                                    {formatSlipDays(result.slip.lateDays ?? 0)}
                                  </strong>
                                  <small>unbroken viable starts (6 h grid)</small>
                                </div>
                                <div>
                                  <span>Slip earlier</span>
                                  <strong>
                                    {result.slip.earlyCensored ? '≥ ' : '−'}
                                    {formatSlipDays(result.slip.earlyDays ?? 0)}
                                  </strong>
                                  <small>earlier viable starts (6 h grid)</small>
                                </div>
                              </div>
                            ) : (
                              <div className="slip-next-window" onClick={(e) => e.stopPropagation()}>
                                <div>
                                  <span>Not viable at chosen start · Next viable window</span>
                                  {result.slip.nextWindow ? (
                                    <strong>
                                      Opens {formatUtc(result.slip.nextWindow.startMs)} UTC (in{' '}
                                      {formatSlipDays((result.slip.nextWindow.startMs - result.startMs) / DAY_MS)}) · lasts{' '}
                                      {result.slip.nextWindow.censored ? 'at least ' : ''}
                                      {formatSlipDays(result.slip.nextWindow.lengthDays)}
                                    </strong>
                                  ) : (
                                    <strong>No viable window in the next 120 days</strong>
                                  )}
                                </div>
                                {result.slip.nextWindow && (
                                  <button
                                    type="button"
                                    className="jump-window-btn"
                                    onClick={() => {
                                      const nextStr = clampDateString(msToDateTimeInput(result.slip.nextWindow!.startMs));
                                      if (slot.card.dateTime) setCardDateOverride(slot.index, nextStr);
                                      else handleGlobalDateChange(nextStr);
                                    }}
                                  >
                                    Load window
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="clock-grid">
                            <div className="clock-card">
                              <span>Next sunset</span>
                              <strong>{clockLabel(result.sunset, result.startMs)}</strong>
                            </div>
                            <div className="clock-card">
                              <span>Next Earthset</span>
                              <strong>{clockLabel(result.earthset, result.startMs)}</strong>
                            </div>
                          </div>

                          <div className="card-skyline-head">
                            <span>Scrubbed instant</span>
                            <span>
                              {formatUtc(result.startMs + Math.min(scrubMinutes, stayMinutes) * MIN_MS)} UTC
                            </span>
                          </div>
                          <SkylineCanvas
                            result={result}
                            scrubMinutes={Math.min(scrubMinutes, stayMinutes)}
                            compact={compact}
                          />
                          <Timeline result={result} scrubMinutes={Math.min(scrubMinutes, stayMinutes)} />

                          <dl className="metric-grid">
                            <Metric
                              label="Sunlit"
                              value={formatPercent(result.metrics.sunlitPct)}
                              note="64-point solar disc"
                            />
                            <Metric
                              label={result.preset.id === 'year' ? 'Longest night' : 'Longest dark gap'}
                              value={formatHours(result.metrics.longestDarkGapH)}
                              note="bisected to 1 min"
                            />
                            <Metric
                              label="Earth visible"
                              value={formatPercent(result.metrics.earthVisiblePct)}
                              note={`margin ${result.marginDeg >= 0 ? '+' : ''}${result.marginDeg}°`}
                            />
                            <Metric
                              label="Longest link gap"
                              value={formatHours(result.metrics.longestLinkGapH)}
                              note="bisected to 1 min"
                            />
                            <Metric
                              label="Sun + Earth overlap"
                              value={formatPercent(result.metrics.overlapPct)}
                              note="lit and linked"
                            />
                            <Metric
                              label="Eclipses by Earth"
                              value={eclipses?.value ?? 'None'}
                              note={eclipses?.note}
                            />
                            <Metric
                              label="Energy · tracking vertical"
                              value={formatEnergy(result.metrics.energyKWhM2.sunTrackingVertical)}
                              note="follows Sun azimuth"
                            />
                            <Metric
                              label="Energy · fixed vertical"
                              value={formatEnergy(result.metrics.energyKWhM2.fixedVertical)}
                              note={`best facing ${result.metrics.fixedVerticalBestFacingDeg}°`}
                            />
                            <Metric
                              label="Energy · horizontal deck"
                              value={formatEnergy(result.metrics.energyKWhM2.horizontalDeck)}
                              note="flat deck"
                            />
                          </dl>

                          <p className="provenance">
                            {provenanceFooter(result.verdict.grade, result.verdict.terrain)}
                          </p>
                          <p className="horizons-chip">{horizonsChipText(slot.site)}</p>
                          <div className="export-row" aria-label="Export this scenario">
                            <button type="button" className="export-btn" onClick={() => handleExportCsv(slot, result)}>
                              CSV · 10-minute series
                            </button>
                            <button type="button" className="export-btn" onClick={() => handleExportJson(slot, result)}>
                              JSON · scenario and sources
                            </button>
                            {exportNote && <small className="export-note" role="status">{exportNote}</small>}
                          </div>
                        </>
                      )}
                    </motion.article>
                  );
                })}
              </div>
            </section>

            <motion.div
              id="windows"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 0.35 }}
            >
            <WindowFinder
              sites={allSites}
              skylineGrades={skylineGrades}
              rowsBySiteId={matrixRows}
              matrixStartDayMs={matrixStartDayMs}
              selectedDateMs={Number.isFinite(globalStartMs) ? globalStartMs : matrixStartDayMs}
              comparedSiteIds={comparedSiteIds}
              activeSiteId={activeSiteId}
              span={urlState.windowSpan}
              stayDays={urlState.stayDays}
              hasRules={Boolean(effectivePreset.rules)}
              progress={matrixProgress}
              onChangeSpan={(nextSpan) => setUrlState((prev) => ({ ...prev, windowSpan: nextSpan }))}
              onShiftWindowStart={(deltaDays) => {
                const shiftedMs = matrixStartDayMs + deltaDays * DAY_MS;
                const minMs = Date.parse(`${MIN_DATE_UTC}:00Z`);
                const maxMs = Date.parse(`${MAX_DATE_UTC}:00Z`);
                const clampedMs = Math.max(minMs, Math.min(maxMs, shiftedMs));
                setUrlState((prev) => ({ ...prev, windowStartDate: msToDateInput(clampedMs) }));
              }}
              onAlignWindowStart={() =>
                setUrlState((prev) => ({ ...prev, windowStartDate: prev.dateTime.slice(0, 10) }))
              }
              onSelectScenario={handleSelectWindowScenario}
              onSwitchToSortie={() =>
                setUrlState((prev) => ({
                  ...prev,
                  presetId: 'sortie',
                  stayDays: PRESETS.sortie.stayDays,
                  ruleOverrides: {},
                }))
              }
            />
            </motion.div>

            <motion.div
              id="map"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 0.35 }}
            >
            <Suspense
              fallback={
                <div className="status-card" role="status">
                  <span className="spinner" aria-hidden="true" />
                  <strong>Loading the south-polar map…</strong>
                </div>
              }
            >
              <MapView
                sites={allSites}
                skylineGrades={skylineGrades}
                onPickSite={selectSiteIntoActiveCard}
              />
            </Suspense>
            </motion.div>
          </div>
        </div>
      </main>

      <footer className="site-footer">
        <span>Oneiric · lunar landing site × date comparison</span>
        <span>JPL Horizons ephemeris (MOON_ME) · LOLA polar skylines (Grades B, C) · Smooth sphere (Grade D, no terrain)</span>
        <span>Moon picture on the globe: NASA SVS CGI Moon Kit · shown for orientation, never used in a calculation</span>
        <button type="button" className="footer-link" onClick={() => setMethodOpen(true)}>
          Method and checks
        </button>
      </footer>

      {methodOpen && (
        <MethodDrawer
          rows={validationRows}
          pending={validationPending}
          heights={heights}
          observedHeightM={urlState.heightM}
          unloadedSkylineFiles={unloadedFiles}
          onClose={() => setMethodOpen(false)}
        />
      )}

      <AnimatePresence>{tourRunning && <TourOverlay stepIndex={tourStep} />}</AnimatePresence>
    </div>
    </MotionConfig>
  );
}

export default App;
