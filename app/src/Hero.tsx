// Landing hero: the Moon with a mission-control HUD over it. Everything here is navigation and presentation.
// The figures it shows (slip tolerance, verdict, grade, status) are the engine's results for the active card.
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { provenanceFooter, type Grade, type Vec3 } from '../../engine/index.ts';
import { formatHours, formatUtc, slipDaysNumber } from './format.ts';
import { GRADE_LEGEND, gradeColor } from './grade-style.ts';
import { MoonStatic } from './MoonStatic.tsx';
import type { PoseRequest, ZoomRequest } from './MoonGlobe.tsx';
import { MOON_TEXTURE_NAME, MOON_TEXTURE_PAGE, type SurfaceState } from './moon-texture.ts';
import { DAY_MS, type ScenarioResult, type SiteDefinition } from './scenario.ts';
import { formatCoordinates } from './sites.ts';
import { StatusLine, VerdictBadge } from './ui.tsx';

const MoonGlobe = lazy(() => import('./MoonGlobe.tsx'));

export type GlobeMode = 'webgl' | 'static';
export type CameraPreset = 'near-side' | 'south-pole' | 'site';

export interface HeroStats {
  siteCount: number;
  skylineCount: number | null;
  firstYear: number;
  lastYear: number;
  /** First and last landing date the date picker accepts, 'YYYY-MM-DD'. */
  firstPickDate: string;
  lastPickDate: string;
  directionMaxDeg: number | null;
  directionLimitDeg: number | null;
  skylineMaxDeg: number | null;
  skylineLimitDeg: number | null;
}

export interface HeroProps {
  globeMode: GlobeMode;
  onGlobeFailed: () => void;
  sites: SiteDefinition[];
  grades: Map<string, Grade>;
  activeSite: SiteDefinition | undefined;
  activeSiteId: string;
  comparedSiteIds: Set<string>;
  result: ScenarioResult | undefined;
  statusMessage: string | null;
  scrubMinutes: number;
  stayMinutes: number;
  scrubStep: number;
  playing: boolean;
  onScrub: (minutes: number) => void;
  onTogglePlay: () => void;
  sunDir: Vec3 | null;
  earthDir: Vec3 | null;
  stats: HeroStats;
  poseRequest: PoseRequest;
  onCameraPreset: (preset: CameraPreset) => void;
  tourRotates: boolean;
  tourRunning: boolean;
  onPickSite: (siteId: string) => void;
  onOpenBoard: () => void;
  onOpenMethod: () => void;
  onStartTour: () => void;
}

class GlobeBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const HUD_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border border-line-strong bg-raised px-3 font-mono text-xs uppercase tracking-[0.08em] text-ink transition-colors hover:border-signal hover:bg-hover sm:min-h-9';

function SlipHook({ result, site, statusMessage }: { result: ScenarioResult | undefined; site: SiteDefinition | undefined; statusMessage: string | null }) {
  const where = site ? site.name : 'loading site';
  if (!result) {
    return (
      <div>
        <p className="hud-eyebrow">Slip tolerance · {where}</p>
        <div className="font-display text-hero font-semibold leading-[0.9] tracking-tight text-faint" aria-hidden="true">
          <span className="animate-pulse">···</span>
          <span className="ml-2 text-[0.32em] font-medium text-faint">d</span>
        </div>
        <p className="mt-3 text-base text-dim" role="status">
          {statusMessage ?? 'Computing this landing from the cached JPL Horizons table…'}
        </p>
      </div>
    );
  }
  const when = `${formatUtc(result.startMs)} UTC`;
  if (!result.preset.rules) {
    return (
      <div>
        <p className="hud-eyebrow">Sunlit over one year · {where} · {when}</p>
        <div className="font-display text-hero font-semibold leading-[0.9] tracking-tight tabular-nums text-ink">
          {result.metrics.sunlitPct.toFixed(1)}
          <span className="ml-2 text-[0.32em] font-medium text-dim">%</span>
        </div>
        <p className="mt-3 text-base text-dim">Annual summary. The one-year stay carries no pass or fail verdict and no slip tolerance.</p>
      </div>
    );
  }
  if (result.slip.viableAtChosen) {
    const days = slipDaysNumber(result.slip.lateDays ?? 0);
    return (
      <div>
        <p className="hud-eyebrow">Slip tolerance · {where} · {when}</p>
        <div className="font-display text-hero font-semibold leading-[0.9] tracking-tight tabular-nums text-ink">
          <span className="text-[0.6em] text-dim">{result.slip.lateCensored ? '≥' : '+'}</span>
          {days}
          <span className="ml-2 text-[0.32em] font-medium text-dim">d</span>
        </div>
        <p className="mt-3 text-base text-ink">
          This landing can slip <strong className="font-semibold">{result.slip.lateCensored ? 'at least ' : ''}{days} days</strong>
          {result.slip.lateCensored ? ' later and still meet every rule (the search stops there).' : ' later and still meet every rule.'}
        </p>
      </div>
    );
  }
  const next = result.slip.nextWindow;
  return (
    <div>
      <p className="hud-eyebrow">Slip tolerance · {where} · {when}</p>
      <div className="font-display text-hero font-semibold leading-[0.9] tracking-tight tabular-nums text-ink">
        0<span className="ml-2 text-[0.32em] font-medium text-dim">d</span>
      </div>
      <p className="mt-3 text-base text-ink">
        Not viable on this date.{' '}
        {next
          ? `The next window opens in ${slipDaysNumber((next.startMs - result.startMs) / DAY_MS)} days and lasts ${next.censored ? 'at least ' : ''}${slipDaysNumber(next.lengthDays)} days.`
          : 'No viable window opens in the next 120 days.'}
      </p>
    </div>
  );
}

function StatCell({ value, unit, label, note, onClick, className = '' }: { value: string; unit?: string; label: string; note: string; onClick?: () => void; className?: string }) {
  const body = (
    <>
      <span className="block font-mono text-xl font-semibold tabular-nums text-ink sm:text-[1.375rem]">
        {value}
        {unit && <span className="ml-1 text-xs font-medium text-dim">{unit}</span>}
      </span>
      <span className="mt-0.5 block font-mono text-2xs uppercase tracking-[0.1em] text-dim">{label}</span>
      <span className="mt-1 block text-xs leading-snug text-faint">{note}</span>
    </>
  );
  const base = `min-h-11 bg-panel/90 px-3 py-2.5 text-left ${className}`;
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <motion.button type="button" className={`${base} transition-colors hover:bg-hover`} whileTap={{ scale: 0.98 }} onClick={onClick}>
      {body}
    </motion.button>
  );
}

export function Hero(props: HeroProps) {
  const {
    globeMode,
    onGlobeFailed,
    sites,
    grades,
    activeSite,
    activeSiteId,
    comparedSiteIds,
    result,
    statusMessage,
    scrubMinutes,
    stayMinutes,
    scrubStep,
    playing,
    onScrub,
    onTogglePlay,
    sunDir,
    earthDir,
    stats,
    poseRequest,
    onCameraPreset,
    tourRotates,
    tourRunning,
    onPickSite,
    onOpenBoard,
    onOpenMethod,
    onStartTour,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [surface, setSurface] = useState<SurfaceState>('loading');
  const [globeReady, setGlobeReady] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [wheelZoom, setWheelZoom] = useState(false);
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest>({ factor: 1, nonce: 0 });
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  // Pause the render loop when the hero is scrolled away or the tab is hidden.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.02 });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => setTabVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const handleSurface = useCallback((state: SurfaceState) => setSurface(state), []);
  const handleReady = useCallback(() => setGlobeReady(true), []);
  const handleInteract = useCallback(() => setTouched(true), []);
  const handlePick = useCallback(
    (siteId: string) => {
      setTouched(true);
      onPickSite(siteId);
    },
    [onPickSite],
  );

  const is3d = globeMode === 'webgl';
  const hovered = hoveredId ? sites.find((site) => site.id === hoveredId) : undefined;
  const hoveredGrade = hovered ? (hovered.isCustom ? 'D' : (grades.get(hovered.id) ?? 'D')) : undefined;
  const clampedScrub = Math.min(scrubMinutes, stayMinutes);

  const surfaceText = !is3d
    ? 'Site chart · south pole at the centre, 0° longitude up · not to scale'
    : !globeReady
      ? 'Loading the 3D Moon…'
      : surface === 'ready'
        ? `Surface picture: ${MOON_TEXTURE_NAME}`
        : surface === 'loading'
          ? 'Loading the surface picture…'
          : 'Surface picture unavailable · plain shaded sphere';

  const chip = (
    <p className="hud-chip" role="status">
      {is3d && (!globeReady || surface === 'loading') && <span className="spinner" aria-hidden="true" />}
      {hovered
        ? `${hovered.name} · ${formatCoordinates(hovered.lat, hovered.eLon, 2)} · grade ${hoveredGrade} · click to load`
        : surfaceText}
    </p>
  );

  return (
    <section
      id="globe"
      aria-label="Moon view and current scenario"
      className={`hero-backdrop relative isolate overflow-hidden border-b border-line ${is3d ? 'lg:h-[calc(100svh-var(--topbar-h))] lg:min-h-[680px]' : ''}`}
    >
      {/* Globe stage */}
      <div
        ref={stageRef}
        className={`relative mx-auto ${is3d ? 'h-[46svh] min-h-[300px] w-full lg:absolute lg:inset-x-0 lg:top-0 lg:bottom-[150px] lg:h-auto' : 'h-[320px] w-full max-w-[420px] p-3 lg:absolute lg:inset-y-0 lg:left-1/2 lg:h-auto lg:max-w-none lg:w-[min(30vw,460px)] lg:-translate-x-1/2 lg:p-6'} ${hovered ? 'cursor-pointer' : is3d ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={() => setWheelZoom(true)}
        onPointerLeave={() => setWheelZoom(false)}
      >
        {/* The chart is the loading state: it is on screen from the first render and fades out when the globe is drawing. */}
        {(!is3d || !globeReady) && (
          <div className={`absolute inset-0 flex items-center justify-center p-4 lg:p-10 ${is3d ? 'opacity-60' : ''}`}>
            <MoonStatic
              sites={sites}
              grades={grades}
              activeSiteId={activeSiteId}
              comparedSiteIds={comparedSiteIds}
              sunDir={sunDir}
              earthDir={earthDir}
              onPickSite={handlePick}
            />
          </div>
        )}
        {is3d && (
          <GlobeBoundary onError={onGlobeFailed}>
            <Suspense fallback={null}>
              <motion.div className="absolute inset-0" initial={false} animate={{ opacity: globeReady ? 1 : 0 }} transition={{ duration: 0.5 }}>
                <MoonGlobe
                  sites={sites}
                  grades={grades}
                  activeSiteId={activeSiteId}
                  comparedSiteIds={comparedSiteIds}
                  sunDir={sunDir}
                  earthDir={earthDir}
                  poseRequest={poseRequest}
                  zoomRequest={zoomRequest}
                  autoRotate={tourRotates || (!touched && !tourRunning && !reducedMotion)}
                  wheelZoom={wheelZoom}
                  running={onScreen && tabVisible}
                  onPickSite={handlePick}
                  onHoverSite={setHoveredId}
                  onUserInteract={handleInteract}
                  onSurface={handleSurface}
                  onReady={handleReady}
                  onContextLost={onGlobeFailed}
                />
              </motion.div>
            </Suspense>
          </GlobeBoundary>
        )}

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center lg:hidden">{chip}</div>
      </div>

      {/* HUD */}
      <div className={`pointer-events-none relative z-10 grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,450px)_minmax(0,1fr)_minmax(0,340px)] lg:gap-4 lg:p-5 ${is3d ? 'lg:absolute lg:inset-0 lg:grid-rows-[minmax(0,1fr)_auto]' : ''}`}>
        {/* Hook */}
        <motion.div
          className="pointer-events-auto self-start rounded-sm lg:border lg:border-line lg:bg-void/85 lg:p-4 lg:backdrop-blur-md"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <SlipHook result={result} site={activeSite} statusMessage={statusMessage} />
          <h1 className="mt-5 max-w-[26ch] font-display text-2xl font-semibold leading-tight tracking-tight text-ink">
            Compare lunar landing sites and dates before a slip flips the verdict.
          </h1>
          <p className="mt-2 max-w-[52ch] text-base text-dim">
            Sunlight for power and a line of sight to Earth, from JPL Horizons positions measured against each site's horizon: LOLA terrain skylines at the south-polar sites, a smooth sphere elsewhere. Every figure names its source and its fidelity grade.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <motion.button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-ink px-4 font-mono text-sm font-semibold uppercase tracking-[0.06em] text-void hover:bg-white"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={onOpenBoard}
            >
              Open the compare board <span aria-hidden="true">↓</span>
            </motion.button>
            <motion.button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-line-strong bg-raised/90 px-4 font-mono text-sm uppercase tracking-[0.06em] text-ink hover:border-signal"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              aria-pressed={tourRunning}
              onClick={onStartTour}
            >
              <span aria-hidden="true">▶</span> Autopilot · 30 s tour
            </motion.button>
          </div>
        </motion.div>

        <div className="hidden items-end justify-center lg:flex">{chip}</div>

        {/* Scenario and view panels */}
        <motion.div
          className="pointer-events-auto flex flex-col gap-3 self-start"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="hud-panel">
            <div className="hud-panel-head">
              <span>Scenario</span>
              <span>{result ? `${result.preset.name} · ${result.preset.stayDays} d` : 'computing'}</span>
            </div>
            <div className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-display text-lg font-semibold leading-tight text-ink">{activeSite?.name ?? 'Loading site…'}</p>
                {activeSite && (
                  <p className="mt-1 font-mono text-xs text-dim">{formatCoordinates(activeSite.lat, activeSite.eLon, 4)}</p>
                )}
                {result && <p className="font-mono text-xs text-dim">{formatUtc(result.startMs)} UTC</p>}
              </div>
              {result && <VerdictBadge verdict={result.verdict.verdict} grade={result.verdict.grade} compact />}
            </div>
            {result ? (
              <div className="border-t border-line p-3">
                <StatusLine result={result} scrubMinutes={clampedScrub} />
                <p className="mt-2.5 text-base leading-snug text-ink sm:text-sm">{result.verdict.rule}</p>
                <p className="mt-1.5 font-mono text-2xs leading-relaxed text-faint">
                  {result.verdict.presetLabel} · {provenanceFooter(result.verdict.grade, result.verdict.terrain)}
                </p>
              </div>
            ) : (
              <p className="flex items-center gap-2 border-t border-line p-3 text-base text-dim sm:text-sm" role="status">
                <span className="spinner" aria-hidden="true" /> {statusMessage ?? 'Calculating in the background…'}
              </p>
            )}
          </div>

          <div className="hud-panel">
            <div className="hud-panel-head">
              <span>View</span>
              <span>{is3d ? 'drag to rotate' : 'static chart'}</span>
            </div>
            <div className="p-3">
              {is3d ? (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button type="button" className={HUD_BUTTON} onClick={() => { setTouched(true); onCameraPreset('south-pole'); }}>South pole</button>
                    <button type="button" className={HUD_BUTTON} onClick={() => { setTouched(true); onCameraPreset('near-side'); }}>Near side</button>
                    <button type="button" className={HUD_BUTTON} onClick={() => { setTouched(true); onCameraPreset('site'); }}>This site</button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
                    <p className="text-xs leading-snug text-faint">Click the globe, then scroll to zoom. Click a marker to load that site.</p>
                    <button type="button" className={`${HUD_BUTTON} min-w-11 sm:min-w-9`} aria-label="Zoom in" onClick={() => { setTouched(true); setZoomRequest((z) => ({ factor: 0.78, nonce: z.nonce + 1 })); }}>+</button>
                    <button type="button" className={`${HUD_BUTTON} min-w-11 sm:min-w-9`} aria-label="Zoom out" onClick={() => { setTouched(true); setZoomRequest((z) => ({ factor: 1.28, nonce: z.nonce + 1 })); }}>−</button>
                  </div>
                </>
              ) : (
                <p className="text-base leading-snug text-dim sm:text-sm">
                  The 3D Moon needs WebGL, which is not available here. The chart, the compare board, and every figure work without it.
                </p>
              )}
              <ul className="mt-2.5 grid gap-1 font-mono text-2xs text-dim">
                {GRADE_LEGEND.map((entry) => (
                  <li key={entry.grade} className="flex items-center gap-2">
                    <i className="inline-block size-2 rounded-full" style={{ background: gradeColor(entry.grade) }} aria-hidden="true" />
                    <span className="text-ink">Grade {entry.grade}</span> {entry.text}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs leading-snug text-faint">
                Sun and Earth pointers: cached JPL Horizons table (MOON_ME) at the scrubbed time, seen from the Moon's centre.
              </p>
              {is3d && (
                <p className="mt-1 text-2xs leading-snug text-faint">
                  Picture:{' '}
                  <a className="underline decoration-line-strong underline-offset-2 hover:text-ink" href={MOON_TEXTURE_PAGE} target="_blank" rel="noreferrer">
                    {MOON_TEXTURE_NAME}
                  </a>
                  . Shown for orientation; never used in a calculation.
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Time and numbers */}
        <motion.div
          className="pointer-events-auto flex flex-col gap-2 lg:col-span-3"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="hud-panel flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5">
            <button
              type="button"
              className={`${HUD_BUTTON} min-w-[5.5rem]`}
              onClick={onTogglePlay}
              aria-label={playing ? 'Pause the time-lapse' : 'Play the time-lapse through the stay'}
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <input
              className="hud-range min-w-[140px] flex-1"
              aria-label="Scrub through the stay. Shared with the compare board."
              type="range"
              min={0}
              max={stayMinutes}
              step={scrubStep}
              value={clampedScrub}
              onChange={(event) => onScrub(Number(event.target.value))}
            />
            <span className="font-mono text-xs tabular-nums text-dim">
              T+{formatHours(clampedScrub / 60)}
              {result && <> · {formatUtc(result.startMs + clampedScrub * 60_000)} UTC</>}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line md:grid-cols-5">
            <StatCell value={stats.siteCount ? String(stats.siteCount) : '—'} label="sites" note="Each coordinate cites its published source." onClick={onOpenBoard} />
            <StatCell value={String(stats.lastYear - stats.firstYear + 1)} unit="yr" label="of Sun and Earth positions" note={`Hourly, ${stats.firstYear}–${stats.lastYear}, cached from JPL Horizons. Landing dates from ${stats.firstPickDate} to ${stats.lastPickDate}.`} />
            <StatCell value={stats.skylineCount === null ? '—' : String(stats.skylineCount)} label="sites with terrain skylines" note="Site horizons built from LOLA elevation data, grades B and C." />
            <StatCell
              value={stats.directionMaxDeg === null ? '—' : stats.directionMaxDeg.toFixed(5)}
              unit="°"
              label="direction error, max"
              note={`Sun and Earth directions against JPL Horizons. Limit ${stats.directionLimitDeg ?? 0.02}°.`}
              onClick={onOpenMethod}
            />
            <StatCell
              value={stats.skylineMaxDeg === null ? '—' : stats.skylineMaxDeg.toFixed(5)}
              unit="°"
              label="skyline error, max"
              note={`Skyline maths on synthetic terrain with a known answer. Limit ${stats.skylineLimitDeg ?? 0.01}°.`}
              onClick={onOpenMethod}
              className="col-span-2 md:col-span-1"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
