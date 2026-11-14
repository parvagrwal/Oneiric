import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  HOUR_MS,
  MIN_MS,
  provenanceFooter,
} from '../../engine/index.ts'
import type { Clock } from '../../engine/index.ts'
import './App.css'
import type { ScenarioResult, SiteDefinition, TrackPoint } from './scenario.ts'
import { floorToTenMinutes } from './scenario.ts'
import { timeControlForKey } from './keyboard.ts'

type SitesFile = {
  sites: SiteDefinition[]
}

type ValidationRow = {
  name: string
  n: number
  maxDeg: number
  thresholdDeg: number
}

type WorkerResponse =
  | { type: 'result'; requestId: number; result: ScenarioResult }
  | { type: 'error'; requestId: number; message: string }

type TableBuffer = { year: number; buffer: ArrayBuffer }

type DataState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

const DEFAULT_DATE = '2027-03-01T00:00'
const MIN_DATE = '2024-01-15T00:00'
const MAX_DATE = '2039-12-15T00:00'
const DEFAULT_PRESET = 'sortie'
const HEIGHT_M = 2

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

function parseUtcInput(value: string): number {
  if (!value) return NaN
  const withSeconds = value.length === 16 ? `${value}:00` : value
  const parsed = Date.parse(`${withSeconds}Z`)
  return Number.isFinite(parsed) ? floorToTenMinutes(parsed) : NaN
}

function formatUtc(tMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(tMs))
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 24) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} d`
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function clockLabel(clock: Clock, startMs: number): string {
  if (clock.status === 'already') return 'already below the horizon'
  if (clock.status === 'none' || clock.tMs === undefined) return 'not during this stay'
  const deltaHours = (clock.tMs - startMs) / HOUR_MS
  return `${formatHours(deltaHours)} · ${formatUtc(clock.tMs)} UTC`
}

function verdictClass(verdict: ScenarioResult['verdict']['verdict']): string {
  return verdict.toLowerCase().replace('-', '')
}

function nearestTrackPoint(track: TrackPoint[], targetMs: number): TrackPoint | undefined {
  return track.reduce<TrackPoint | undefined>((nearest, point) => {
    if (!nearest) return point
    return Math.abs(point.tMs - targetMs) < Math.abs(nearest.tMs - targetMs) ? point : nearest
  }, undefined)
}

function centeredAzimuth(az: number, center: number): number {
  return ((az - center + 540) % 360) - 180
}

function SkylineCanvas({ result, scrubMinutes }: { result: ScenarioResult; scrubMinutes: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(320, bounds.width)
      const height = Math.max(300, bounds.height)
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const padding = { top: 30, right: 22, bottom: 36, left: 48 }
      const plotWidth = width - padding.left - padding.right
      const plotHeight = height - padding.top - padding.bottom
      const allElevations = [
        ...result.skyline.map((point) => point.elevation),
        ...result.track.flatMap((point) => [point.sunEl, point.earthEl]),
      ]
      const minimum = Math.min(...allElevations) - 0.5
      const maximum = Math.max(...allElevations) + 0.5
      const range = Math.max(3, maximum - minimum)
      const yMin = Math.floor(minimum * 2) / 2
      const yMax = yMin + range
      const toX = (az: number) => padding.left + ((centeredAzimuth(az, result.meanEarthAzimuth) + 180) / 360) * plotWidth
      const toY = (el: number) => padding.top + ((yMax - el) / (yMax - yMin)) * plotHeight

      context.fillStyle = '#101c2f'
      context.fillRect(0, 0, width, height)
      context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'
      context.textBaseline = 'middle'

      for (let elevation = Math.ceil(yMin); elevation <= yMax; elevation++) {
        const y = toY(elevation)
        context.strokeStyle = elevation === 0 ? 'rgba(236, 242, 248, 0.3)' : 'rgba(236, 242, 248, 0.1)'
        context.lineWidth = elevation === 0 ? 1.5 : 1
        context.beginPath()
        context.moveTo(padding.left, y)
        context.lineTo(width - padding.right, y)
        context.stroke()
        context.fillStyle = 'rgba(236, 242, 248, 0.68)'
        context.fillText(`${elevation}°`, 10, y)
      }

      context.strokeStyle = 'rgba(236, 242, 248, 0.18)'
      context.lineWidth = 1
      for (const azimuth of [-180, -90, 0, 90, 180]) {
        const x = padding.left + ((azimuth + 180) / 360) * plotWidth
        context.beginPath()
        context.moveTo(x, padding.top)
        context.lineTo(x, height - padding.bottom)
        context.stroke()
        context.fillStyle = 'rgba(236, 242, 248, 0.68)'
        context.textAlign = azimuth === -180 ? 'left' : azimuth === 180 ? 'right' : 'center'
        context.fillText(azimuth === 0 ? 'Earth mean direction' : `${azimuth > 0 ? '+' : ''}${azimuth}°`, x, height - 16)
      }

      context.beginPath()
      result.skyline.forEach((point, index) => {
        const x = toX(point.az)
        const y = toY(point.elevation)
        if (index === 0 || Math.abs(x - toX(result.skyline[index - 1].az)) > plotWidth / 2) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.lineTo(width - padding.right, height - padding.bottom)
      context.lineTo(padding.left, height - padding.bottom)
      context.closePath()
      context.fillStyle = 'rgba(208, 185, 137, 0.17)'
      context.fill()

      context.beginPath()
      result.skyline.forEach((point, index) => {
        const x = toX(point.az)
        const y = toY(point.elevation)
        if (index === 0 || Math.abs(x - toX(result.skyline[index - 1].az)) > plotWidth / 2) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.strokeStyle = '#e7c98d'
      context.lineWidth = 2
      context.stroke()

      const drawBodyTrack = (
        getAz: (point: TrackPoint) => number,
        getEl: (point: TrackPoint) => number,
        hidden: (point: TrackPoint) => boolean,
        colour: string,
      ) => {
        for (let index = 1; index < result.track.length; index++) {
          const previous = result.track[index - 1]
          const point = result.track[index]
          const previousX = toX(getAz(previous))
          const x = toX(getAz(point))
          if (Math.abs(x - previousX) > plotWidth / 2) continue
          context.beginPath()
          context.moveTo(previousX, toY(getEl(previous)))
          context.lineTo(x, toY(getEl(point)))
          context.strokeStyle = colour
          context.lineWidth = 2
          context.setLineDash(hidden(point) ? [5, 5] : [])
          context.stroke()
        }
        context.setLineDash([])
      }

      drawBodyTrack((point) => point.sunAz, (point) => point.sunEl, (point) => point.sunF < 0.01, '#f7c948')
      drawBodyTrack((point) => point.earthAz, (point) => point.earthEl, (point) => !point.earthVis, '#6ed6e8')

      const target = nearestTrackPoint(result.track, result.startMs + scrubMinutes * MIN_MS)
      if (target) {
        const marker = (az: number, elevation: number, colour: string) => {
          context.beginPath()
          context.arc(toX(az), toY(elevation), 5, 0, Math.PI * 2)
          context.fillStyle = colour
          context.fill()
          context.strokeStyle = '#101c2f'
          context.lineWidth = 2
          context.stroke()
        }
        marker(target.sunAz, target.sunEl, '#f7c948')
        marker(target.earthAz, target.earthEl, '#6ed6e8')
      }

      context.textAlign = 'left'
      context.fillStyle = '#f7c948'
      context.fillText('Sun', padding.left, 14)
      context.fillStyle = '#6ed6e8'
      context.fillText('Earth', padding.left + 42, 14)
      context.fillStyle = '#e7c98d'
      context.fillText('smooth horizon', padding.left + 92, 14)
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [result, scrubMinutes])

  return (
    <div className="skyline-frame">
      <canvas ref={canvasRef} role="img" aria-label="Skyline view showing the smooth horizon with the Sun and Earth tracks" />
      <div className="skyline-caption">
        <span>Skyline view · azimuth centered on mean Earth direction</span>
        <span>Exaggeration 1× · hidden portions dashed</span>
      </div>
    </div>
  )
}

function Timeline({ result, scrubMinutes }: { result: ScenarioResult; scrubMinutes: number }) {
  const targetMs = result.startMs + scrubMinutes * MIN_MS
  return (
    <div className="timeline-wrap">
      <div className="timeline-head">
        <span>Stay timeline</span>
        <span>Sunlight and Earth link, sampled every 6 hours</span>
      </div>
      <div className="timeline" role="img" aria-label="Timeline of sunlight and Earth visibility during the selected stay">
        {result.timeline.map((point) => {
          const dark = point.sunF < 0.01
          const noLink = !point.earthVis
          const active = Math.abs(point.tMs - targetMs) < 3 * HOUR_MS
          return (
            <div
              className={`timeline-cell ${dark ? 'is-dark' : 'is-lit'} ${noLink ? 'is-hidden' : 'is-linked'} ${active ? 'is-active' : ''}`}
              key={point.tMs}
              title={`${formatUtc(point.tMs)} UTC · Sun ${formatPercent(point.sunF * 100)} · Earth ${point.earthVis ? 'visible' : 'hidden'}`}
            />
          )
        })}
      </div>
      <div className="timeline-legend" aria-hidden="true">
        <span><i className="legend-swatch lit" /> Sunlit</span>
        <span><i className="legend-swatch dark" /> Dark</span>
        <span><i className="legend-swatch link" /> Earth visible</span>
        <span><i className="legend-swatch no-link" /> Earth hidden</span>
      </div>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <small>{note}</small>}
    </div>
  )
}

function App() {
  const [sites, setSites] = useState<SiteDefinition[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState('connecting-ridge')
  const [dateTime, setDateTime] = useState(DEFAULT_DATE)
  const [presetId, setPresetId] = useState(DEFAULT_PRESET)
  const [sitesState, setSitesState] = useState<DataState>({ kind: 'loading' })
  const [ephemState, setEphemState] = useState<DataState>({ kind: 'idle' })
  const [tables, setTables] = useState<TableBuffer[]>([])
  const [validation, setValidation] = useState<ValidationRow | null>(null)
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [calculationState, setCalculationState] = useState<DataState>({ kind: 'idle' })
  const [scrubMinutes, setScrubMinutes] = useState(0)
  const [playing, setPlaying] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)
  const bufferCache = useRef(new Map<number, ArrayBuffer>())

  useEffect(() => {
    let active = true
    fetch(dataUrl('data/sites.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`site list returned ${response.status}`)
        return response.json() as Promise<SitesFile>
      })
      .then((payload) => {
        if (!active) return
        setSites(payload.sites)
        setSitesState({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        if (!active) return
        setSitesState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    fetch(dataUrl('data/validation.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`validation data returned ${response.status}`)
        return response.json() as Promise<{ rows: ValidationRow[] }>
      })
      .then((payload) => setValidation(payload.rows[0] ?? null))
      .catch(() => setValidation(null))
  }, [])

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0]
  const selectedYear = Number(dateTime.slice(0, 4))
  const dateRangeError = !Number.isInteger(selectedYear) || selectedYear < 2024 || selectedYear > 2039
    ? 'Choose a date from January 2024 through December 2039 so the surrounding cached years are available.'
    : null

  useEffect(() => {
    if (!Number.isInteger(selectedYear) || selectedYear < 2024 || selectedYear > 2039) return
    let active = true
    const years = [selectedYear - 1, selectedYear, selectedYear + 1]
    Promise.all(years.map(async (year) => {
      const cached = bufferCache.current.get(year)
      if (cached) return { year, buffer: cached }
      const response = await fetch(dataUrl(`data/ephem/${year}.bin`))
      if (!response.ok) throw new Error(`ephemeris ${year} returned ${response.status}`)
      const buffer = await response.arrayBuffer()
      bufferCache.current.set(year, buffer)
      return { year, buffer }
    }))
      .then((loaded) => {
        if (!active) return
        setTables(loaded)
        setEphemState({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        if (!active) return
        setTables([])
        setEphemState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      active = false
    }
  }, [selectedYear])

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestRef.current) return
      if (message.type === 'error') {
        setResult(null)
        setCalculationState({ kind: 'error', message: message.message })
      } else {
        setResult(message.result)
        setCalculationState({ kind: 'ready' })
      }
    }
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!selectedSite || tables.length === 0 || ephemState.kind !== 'ready') return
    const startMs = parseUtcInput(dateTime)
    if (!Number.isFinite(startMs)) return
    const worker = workerRef.current
    if (!worker) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setCalculationState({ kind: 'loading' })
    setResult(null)
    worker.postMessage({
      type: 'calculate',
      requestId,
      tables,
      site: selectedSite,
      startMs,
      presetId,
      heightM: HEIGHT_M,
    })
  }, [dateTime, ephemState.kind, presetId, selectedSite, tables])

  useEffect(() => {
    if (!playing || !result) return undefined
    const stayMinutes = result.stayMs / MIN_MS
    const timer = window.setInterval(() => {
      setScrubMinutes((current) => (current + 10 > stayMinutes ? 0 : current + 10))
    }, 220)
    return () => window.clearInterval(timer)
  }, [playing, result])

  const handleDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPlaying(false)
    setScrubMinutes(0)
    invalidateCalculation()
    const nextValue = event.target.value
    const nextYear = Number(nextValue.slice(0, 4))
    if (nextYear !== selectedYear) {
      setTables([])
      setEphemState({ kind: 'loading' })
    }
    setResult(null)
    setDateTime(nextValue)
  }

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setPlaying(false)
    setScrubMinutes(0)
    invalidateCalculation()
    setPresetId(event.target.value)
  }

  const resetScrub = () => {
    setPlaying(false)
    setScrubMinutes(0)
  }

  const invalidateCalculation = () => {
    requestRef.current += 1
    setResult(null)
  }

  const applyTimeControl = (key: string): boolean => {
    if (!result) return false
    const action = timeControlForKey(key, scrubMinutes, result.stayMs / MIN_MS)
    if (!action) return false
    if (action.type === 'toggle-play') {
      setPlaying((current) => !current)
    } else {
      setPlaying(false)
      setScrubMinutes(action.minutes)
    }
    return true
  }

  const handleViewKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (applyTimeControl(event.key)) event.preventDefault()
  }

  const handleScrubKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (applyTimeControl(event.key)) event.preventDefault()
  }

  const dateInputError = Number.isFinite(parseUtcInput(dateTime)) ? null : 'Choose a valid UTC date and time.'
  const statusMessage = dateRangeError
    ?? dateInputError
    ?? (ephemState.kind === 'error' ? ephemState.message : null)
    ?? (calculationState.kind === 'error' ? calculationState.message : null)

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="./" aria-label="Oneiric home">ONEIRIC<span> / lunar windows</span></a>
        <span className="topbar-note">UTC · cached ephemeris · no login</span>
      </header>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">Site × date navigator</p>
            <h1>Find the window before the landing date moves.</h1>
            <p className="intro-copy">Compare one lunar landing window at a time. JPL Horizons supplies the cached Sun and Earth positions; the calculation engine turns them into a sunlight and Earth-link view.</p>
          </div>
          <div className="proof-card" aria-live="polite">
            <span className="proof-kicker">Direction check</span>
            {validation ? (
              <strong>{validation.maxDeg.toFixed(4)}° max error <small>· {validation.n.toLocaleString()} comparisons</small></strong>
            ) : (
              <strong>Loading the recorded check</strong>
            )}
            <span>JPL Horizons · limit 0.02° · see the validation record</span>
          </div>
        </section>

        <section className="scenario-bar" aria-label="Scenario controls">
          <label>
            <span>Landing date and time</span>
            <input type="datetime-local" value={dateTime} min={MIN_DATE} max={MAX_DATE} step={600} onChange={handleDateChange} />
            <small>UTC</small>
          </label>
          <label>
            <span>Stay length</span>
            <select value={presetId} onChange={handlePresetChange}>
              <option value="sortie">6.5-day sortie</option>
              <option value="lander">One-lunar-day lander · 14 days</option>
            </select>
            <small>Illustrative preset, not an agency requirement</small>
          </label>
          <div className="control-readout">
            <span>Observer height</span>
            <strong>{HEIGHT_M} m</strong>
            <small>Smooth sphere preview</small>
          </div>
        </section>

        <div className="workspace-grid">
          <aside className="site-panel" aria-label="Site list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Choose a site</p>
                <h2>Draft site library</h2>
              </div>
              <span className="site-count">{sites.length || '—'}</span>
            </div>
            {sitesState.kind === 'loading' && <p className="muted">Loading coordinates…</p>}
            {sitesState.kind === 'error' && <p className="error-text">{sitesState.message}</p>}
            <div className="site-list">
              {sites.map((site) => (
                <button
                  className={`site-button ${site.id === selectedSite?.id ? 'selected' : ''}`}
                  key={site.id}
                  type="button"
                  aria-pressed={site.id === selectedSite?.id}
                  onClick={() => {
                    invalidateCalculation()
                    setSelectedSiteId(site.id)
                    resetScrub()
                  }}
                >
                  <span>
                    <strong>{site.name}</strong>
                    <small>{site.lat.toFixed(2)}° {site.lat < 0 ? 'S' : 'N'} · {site.eLon.toFixed(2)}° E</small>
                  </span>
                  <b> D </b>
                </button>
              ))}
            </div>
            <p className="panel-note">Coordinates are the supplied draft library. <a href={selectedSite?.sourceUrl} target="_blank" rel="noreferrer">Open map hand-off ↗</a></p>
          </aside>

          <section className="scenario-area" aria-live="polite">
            {statusMessage && <div className="status-banner error-text">{statusMessage}</div>}
            {!statusMessage && !result && (
              <div className="status-card">
                <span className="spinner" aria-hidden="true" />
                <strong>{calculationState.kind === 'loading' ? 'Calculating the selected window…' : 'Preparing the scenario…'}</strong>
                <span>Sun and Earth positions stay in the worker, away from the interface.</span>
              </div>
            )}
            {result && selectedSite && (
              <>
                <article className="scenario-card">
                  <div className="scenario-card-head">
                    <div>
                      <p className="eyebrow">Selected scenario</p>
                      <h2>{selectedSite.name}</h2>
                      <p className="coordinates">{selectedSite.lat.toFixed(4)}° {selectedSite.lat < 0 ? 'S' : 'N'} · {selectedSite.eLon.toFixed(4)}° E · {formatUtc(result.startMs)} UTC</p>
                    </div>
                    <div className={`verdict-badge ${verdictClass(result.verdict.verdict)}`}>
                      <span>{result.verdict.verdict}</span>
                      <small>Grade {result.verdict.grade}</small>
                    </div>
                  </div>
                  <p className="decision-rule">{result.verdict.rule}</p>
                  <p className="preset-note">{result.verdict.presetLabel}</p>
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
                  <dl className="metric-grid">
                    <Metric label="Sunlit" value={formatPercent(result.metrics.sunlitPct)} note="visible disc average" />
                    <Metric label="Longest dark gap" value={formatHours(result.metrics.longestDarkGapH)} />
                    <Metric label="Earth visible" value={formatPercent(result.metrics.earthVisiblePct)} />
                    <Metric label="Longest link gap" value={formatHours(result.metrics.longestLinkGapH)} />
                    <Metric label="Sun + Earth overlap" value={formatPercent(result.metrics.overlapPct)} />
                    <Metric label="Slip later" value={result.slip.viableAtChosen && result.slip.lateDays !== null ? `${result.slip.lateDays.toFixed(1)} d` : 'next window below'} note="6-hour start grid" />
                  </dl>
                  <p className="provenance">{provenanceFooter(result.verdict.grade, result.verdict.terrain)}</p>
                </article>

                <section
                  className="view-card"
                  tabIndex={0}
                  aria-label="Skyline time controls. Use arrow keys to step by ten minutes, Home and End to jump, or Space to play and pause."
                  aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End Space"
                  onKeyDown={handleViewKeyDown}
                >
                  <div className="view-card-head">
                    <div>
                      <p className="eyebrow">Skyline view</p>
                      <h2>Where the bodies meet the horizon</h2>
                    </div>
                    <div className="view-time">{formatUtc(result.startMs + scrubMinutes * MIN_MS)} UTC</div>
                  </div>
                  <SkylineCanvas result={result} scrubMinutes={scrubMinutes} />
                  <Timeline result={result} scrubMinutes={scrubMinutes} />
                  <div className="scrub-controls">
                    <button type="button" className="play-button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? 'Pause time-lapse' : 'Play time-lapse'}>
                      {playing ? 'Pause' : 'Play'}
                    </button>
                    <input
                      aria-label="Scrub through the selected stay"
                      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End Space"
                      type="range"
                      min="0"
                      max={result.stayMs / MIN_MS}
                      step="10"
                      value={scrubMinutes}
                      onKeyDown={handleScrubKeyDown}
                      onChange={(event) => {
                        setPlaying(false)
                        setScrubMinutes(Number(event.target.value))
                      }}
                    />
                    <span>{formatHours(scrubMinutes / 60)} into stay</span>
                    <small className="keyboard-hint">Keys: ← / → 10 min · Home / End jump · Space play</small>
                  </div>
                  <p className="provenance">{provenanceFooter(result.verdict.grade, result.verdict.terrain)}</p>
                </section>
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="site-footer">
        <span>Oneiric · a working smooth-sphere preview</span>
        <span>JPL Horizons ephemeris · no terrain is used in Grade D</span>
      </footer>
    </div>
  )
}

export default App
