import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Grade } from '../../engine/index.ts';
import {
  DAILY_WINDOW_COLUMNS,
  DAY_MS,
  WEEKLY_WINDOW_COLUMNS,
  floorToUtcDay,
  type SiteDefinition,
  type WindowFinderCell,
  type WindowFinderRow,
} from './scenario.ts';
import type { WindowFinderSpan } from './url-state.ts';

const GO_HEX = '#009e73';
const MARGINAL_HEX = '#e69f00';
const NOGO_HEX = '#d55e00';

const LABEL_WIDTH = 224;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 24;
const RIGHT_PAD = 12;
const BOTTOM_PAD = 10;

function formatShortDay(tMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  }).format(new Date(tMs));
}

function formatIsoDay(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 10);
}

export interface WindowFinderProps {
  sites: SiteDefinition[];
  skylineGrades: Map<string, Grade>;
  rowsBySiteId: Map<string, WindowFinderRow>;
  matrixStartDayMs: number;
  selectedDateMs: number;
  comparedSiteIds: Set<string>;
  activeSiteId: string;
  span: WindowFinderSpan;
  stayDays: number;
  hasRules: boolean;
  progress: { done: number; total: number; computing: boolean; error: string | null };
  onChangeSpan: (span: WindowFinderSpan) => void;
  onShiftWindowStart: (deltaDays: number) => void;
  onAlignWindowStart: () => void;
  onSelectScenario: (siteId: string, dayStartMs: number, addCard: boolean) => void;
  onSwitchToSortie: () => void;
}

export function WindowFinder({
  sites,
  skylineGrades,
  rowsBySiteId,
  matrixStartDayMs,
  selectedDateMs,
  comparedSiteIds,
  activeSiteId,
  span,
  stayDays,
  hasRules,
  progress,
  onChangeSpan,
  onShiftWindowStart,
  onAlignWindowStart,
  onSelectScenario,
  onSwitchToSortie,
}: WindowFinderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRowRef = useRef<number | null>(null);
  const lastDragColRef = useRef<number | null>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col: number } | null>(null);

  const colCount = span === 'weekly' ? WEEKLY_WINDOW_COLUMNS : DAILY_WINDOW_COLUMNS;
  const colStepMs = span === 'weekly' ? 7 * DAY_MS : DAY_MS;
  const day0Ms = floorToUtcDay(matrixStartDayMs);
  const selectedDayMs = floorToUtcDay(selectedDateMs);

  const colStarts = useMemo(
    () => Array.from({ length: colCount }, (_, c) => day0Ms + c * colStepMs),
    [colCount, colStepMs, day0Ms],
  );

  const selectedCol = useMemo(() => {
    const diff = selectedDayMs - day0Ms;
    if (diff < 0) return -1;
    const idx = Math.floor(diff / colStepMs);
    return idx >= 0 && idx < colCount ? idx : -1;
  }, [colCount, colStepMs, day0Ms, selectedDayMs]);

  useEffect(() => {
    if (!hasRules) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(760, bounds.width);
      const height = HEADER_HEIGHT + sites.length * ROW_HEIGHT + BOTTOM_PAD;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      ctx.fillStyle = '#070a0f';
      ctx.fillRect(0, 0, width, height);

      const gridWidth = Math.max(240, width - LABEL_WIDTH - RIGHT_PAD);
      const cellW = gridWidth / colCount;

      // Column date ticks in header
      ctx.font = '11px "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#a3afbc';
      ctx.textAlign = 'left';
      ctx.fillText('Site · grade', 12, HEADER_HEIGHT / 2);

      const tickEvery = span === 'weekly' ? 4 : 15;
      for (let c = 0; c < colCount; c += tickEvery) {
        const x = LABEL_WIDTH + c * cellW;
        ctx.strokeStyle = 'rgba(236, 242, 248, 0.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, HEADER_HEIGHT - 6);
        ctx.lineTo(x, height - BOTTOM_PAD);
        ctx.stroke();
        ctx.fillStyle = '#c3cfdf';
        ctx.textAlign = 'left';
        ctx.fillText(formatShortDay(colStarts[c]), x + 2, HEADER_HEIGHT / 2);
      }

      // Draw rows
      for (let r = 0; r < sites.length; r++) {
        const site = sites[r];
        const y = HEADER_HEIGHT + r * ROW_HEIGHT;
        const isCompared = comparedSiteIds.has(site.id);
        const isActive = site.id === activeSiteId;

        if (isActive) {
          ctx.fillStyle = 'rgba(95, 212, 230, 0.16)';
          ctx.fillRect(0, y, LABEL_WIDTH - 4, ROW_HEIGHT - 1);
        } else if (isCompared) {
          ctx.fillStyle = 'rgba(95, 212, 230, 0.08)';
          ctx.fillRect(0, y, LABEL_WIDTH - 4, ROW_HEIGHT - 1);
        } else if (r % 2 === 1) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
          ctx.fillRect(0, y, LABEL_WIDTH - 4, ROW_HEIGHT - 1);
        }

        // Grade badge on left
        const rowData = rowsBySiteId.get(site.id);
        const grade = rowData?.grade ?? (site.isCustom ? 'D' : (skylineGrades.get(site.id) ?? 'D'));
        ctx.fillStyle = grade === 'B' ? '#1e3a5f' : grade === 'C' ? '#3a3352' : '#2a3342';
        ctx.fillRect(8, y + 4, 18, ROW_HEIGHT - 9);
        ctx.fillStyle = '#eaf2fb';
        ctx.font = 'bold 10px "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(grade, 17, y + ROW_HEIGHT / 2);

        // Site name
        ctx.fillStyle = isActive ? '#ffffff' : isCompared ? '#d7f5f8' : '#d5deeb';
        ctx.font = isActive || isCompared
          ? '600 12px ui-sans-serif, system-ui, sans-serif'
          : '12px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'left';
        const maxLabelChars = 25;
        const shortName = site.name.length > maxLabelChars ? `${site.name.slice(0, maxLabelChars - 1)}…` : site.name;
        ctx.fillText(shortName, 32, y + ROW_HEIGHT / 2);

        // Cells
        const cells = rowData?.cells;
        for (let c = 0; c < colCount; c++) {
          const cx = LABEL_WIDTH + c * cellW;
          const cw = Math.max(1, cellW - 1);
          const ch = ROW_HEIGHT - 3;
          const cy = y + 1;
          const cell: WindowFinderCell | undefined = cells?.[c];

          if (!cell) {
            ctx.fillStyle = 'rgba(158, 175, 196, 0.12)';
            ctx.fillRect(cx, cy, cw, ch);
            continue;
          }

          if (cell.verdict === 'GO') {
            // Solid full-height Okabe-Ito green block
            ctx.fillStyle = GO_HEX;
            ctx.fillRect(cx, cy, cw, ch);
          } else if (cell.verdict === 'MARGINAL') {
            // Okabe-Ito amber block with dark top/center notch so shape distinguishes it from GO and NO-GO
            ctx.fillStyle = MARGINAL_HEX;
            ctx.fillRect(cx, cy, cw, ch);
            ctx.fillStyle = '#070a0f';
            ctx.fillRect(cx + cw * 0.2, cy + ch * 0.42, Math.max(1.2, cw * 0.6), Math.max(2, ch * 0.18));
          } else if (cell.verdict === 'NO-GO') {
            // Okabe-Ito vermilion recessed lower bar + dark upper cap so greyscale luminance and shape differ
            ctx.fillStyle = 'rgba(213, 94, 0, 0.34)';
            ctx.fillRect(cx, cy, cw, ch);
            ctx.fillStyle = NOGO_HEX;
            ctx.fillRect(cx, cy + ch * 0.55, cw, ch * 0.45);
          } else {
            ctx.fillStyle = 'rgba(158, 175, 196, 0.2)';
            ctx.fillRect(cx, cy, cw, ch);
          }
        }
      }

      // Highlight selected date column
      if (selectedCol >= 0) {
        const sx = LABEL_WIDTH + selectedCol * cellW;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.75;
        ctx.strokeRect(sx - 0.5, HEADER_HEIGHT - 2, Math.max(2, cellW), sites.length * ROW_HEIGHT + 2);
      }

      // Highlight hovered / keyboard-focused cell
      if (focusCell && focusCell.row >= 0 && focusCell.row < sites.length && focusCell.col >= 0 && focusCell.col < colCount) {
        const fx = LABEL_WIDTH + focusCell.col * cellW;
        const fy = HEADER_HEIGHT + focusCell.row * ROW_HEIGHT;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(fx - 0.5, fy, Math.max(2, cellW + 0.5), ROW_HEIGHT - 1);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [activeSiteId, colCount, colStarts, comparedSiteIds, focusCell, hasRules, rowsBySiteId, selectedCol, sites, skylineGrades, span]);

  const cellFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>): { row: number; col: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || sites.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const row = Math.floor((y - HEADER_HEIGHT) / ROW_HEIGHT);
    if (row < 0 || row >= sites.length) return null;
    const gridWidth = Math.max(240, rect.width - LABEL_WIDTH - RIGHT_PAD);
    if (x < LABEL_WIDTH) {
      return { row, col: selectedCol >= 0 ? selectedCol : 0 };
    }
    const col = Math.floor(((x - LABEL_WIDTH) / gridWidth) * colCount);
    if (col < 0 || col >= colCount) return null;
    return { row, col };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const hit = cellFromPointer(event);
    if (!hit) return;
    setFocusCell(hit);
    const site = sites[hit.row];
    const rowData = rowsBySiteId.get(site.id);
    const dayStartMs = rowData?.cells[hit.col]?.startMs ?? colStarts[hit.col];
    onSelectScenario(site.id, dayStartMs, event.shiftKey);
    if (!event.shiftKey && event.pointerType === 'mouse') {
      dragRowRef.current = hit.row;
      lastDragColRef.current = hit.col;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const hit = cellFromPointer(event);
    if (hit) setFocusCell(hit);
    if (dragRowRef.current !== null && hit) {
      const pinnedRow = dragRowRef.current;
      if (hit.col !== lastDragColRef.current) {
        lastDragColRef.current = hit.col;
        const site = sites[pinnedRow];
        const rowData = rowsBySiteId.get(site.id);
        const dayStartMs = rowData?.cells[hit.col]?.startMs ?? colStarts[hit.col];
        setFocusCell({ row: pinnedRow, col: hit.col });
        onSelectScenario(site.id, dayStartMs, false);
      }
    }
  };

  const handlePointerUp = () => {
    dragRowRef.current = null;
    lastDragColRef.current = null;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (sites.length === 0) return;
    const current = focusCell ?? {
      row: Math.max(0, sites.findIndex((s) => s.id === activeSiteId)),
      col: Math.max(0, selectedCol),
    };
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusCell({ row: Math.min(sites.length - 1, current.row + 1), col: current.col });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusCell({ row: Math.max(0, current.row - 1), col: current.col });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setFocusCell({ row: current.row, col: Math.min(colCount - 1, current.col + 1) });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setFocusCell({ row: current.row, col: Math.max(0, current.col - 1) });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const site = sites[current.row];
      const rowData = rowsBySiteId.get(site.id);
      const dayStartMs = rowData?.cells[current.col]?.startMs ?? colStarts[current.col];
      onSelectScenario(site.id, dayStartMs, event.shiftKey);
    }
  };

  const inspected = useMemo(() => {
    const target = focusCell ?? (selectedCol >= 0
      ? { row: Math.max(0, sites.findIndex((s) => s.id === activeSiteId)), col: selectedCol }
      : null);
    if (!target || !sites[target.row]) return null;
    const site = sites[target.row];
    const rowData = rowsBySiteId.get(site.id);
    const cell = rowData?.cells[target.col];
    const dayMs = cell?.startMs ?? colStarts[target.col];
    const grade = rowData?.grade ?? (site.isCustom ? 'D' : (skylineGrades.get(site.id) ?? 'D'));
    return { site, grade, dayMs, cell };
  }, [activeSiteId, colStarts, focusCell, rowsBySiteId, selectedCol, sites, skylineGrades]);

  const shiftDays = span === 'weekly' ? 91 : 30;
  const canvasHeight = HEADER_HEIGHT + sites.length * ROW_HEIGHT + BOTTOM_PAD;

  return (
    <section className="window-finder" aria-label="Window Finder site by landing date matrix">
      <div className="wf-header">
        <div>
          <p className="eyebrow">Window Finder</p>
          <h2>Sites × landing dates</h2>
          <p className="wf-subtitle">
            Verdict for a {stayDays}-day stay starting at 00:00 UTC · click a cell to load, Shift-click to add a compare card, or drag along a row to slip
          </p>
        </div>
        <div className="wf-controls">
          <div className="wf-segmented" role="group" aria-label="Window Finder zoom">
            <button
              type="button"
              className={span === 'daily' ? 'is-active' : ''}
              aria-pressed={span === 'daily'}
              onClick={() => onChangeSpan('daily')}
            >
              Daily · 120 d
            </button>
            <button
              type="button"
              className={span === 'weekly' ? 'is-active' : ''}
              aria-pressed={span === 'weekly'}
              onClick={() => onChangeSpan('weekly')}
            >
              Weekly · 52 wk
            </button>
          </div>
          <div className="wf-pan" role="group" aria-label="Shift Window Finder date range">
            <button type="button" onClick={() => onShiftWindowStart(-shiftDays)}>
              ← {span === 'weekly' ? '13 wk' : '30 d'}
            </button>
            <button type="button" onClick={onAlignWindowStart}>
              Align to bar date
            </button>
            <button type="button" onClick={() => onShiftWindowStart(shiftDays)}>
              {span === 'weekly' ? '13 wk' : '30 d'} →
            </button>
          </div>
        </div>
      </div>

      {!hasRules ? (
        <div className="wf-empty">
          <strong>The one-year stay reports annual figures and the longest night only — it carries no pass/fail verdict.</strong>
          <span>Choose the 6.5-day sortie or 14-day lander preset to scan GO / MARGINAL / NO-GO windows across sites and dates.</span>
          <button type="button" className="play-button" onClick={onSwitchToSortie}>
            Switch to 6.5-day sortie
          </button>
        </div>
      ) : (
        <>
          <div className="wf-legend-bar">
            <div className="wf-legend">
              <span><i className="wf-swatch go" aria-hidden="true" /> <strong>GO</strong> meets rules, ≥ 3 d slip</span>
              <span><i className="wf-swatch marginal" aria-hidden="true" /> <strong>MARGINAL</strong> meets rules, &lt; 3 d slip</span>
              <span><i className="wf-swatch nogo" aria-hidden="true" /> <strong>NO-GO</strong> rule fails</span>
            </div>
            <span className="wf-progress" aria-live="polite">
              {progress.error
                ? `Matrix error: ${progress.error}`
                : progress.computing
                  ? `Scanning ${progress.done} of ${progress.total} sites…`
                  : `${formatIsoDay(colStarts[0])} to ${formatIsoDay(colStarts[colStarts.length - 1])} UTC · ${sites.length} sites`}
            </span>
          </div>

          <div className="wf-inspector" aria-live="polite">
            {inspected ? (
              <>
                <strong>{inspected.site.name}</strong>
                <span className="wf-chip">Grade {inspected.grade}</span>
                <span>{formatIsoDay(inspected.dayMs)} 00:00 UTC</span>
                {inspected.cell ? (
                  <>
                    <span className={`wf-verdict-pill ${inspected.cell.verdict.toLowerCase().replace('-', '')}`}>
                      {inspected.cell.verdict}
                    </span>
                    <span className="wf-rule-text">{inspected.cell.rule}</span>
                  </>
                ) : (
                  <span className="wf-rule-text">Calculating window…</span>
                )}
              </>
            ) : (
              <span>Hover, click, or use arrow keys on the matrix to inspect any site and landing date.</span>
            )}
          </div>

          <div className="wf-scroll">
            <canvas
              ref={canvasRef}
              className="wf-canvas"
              style={{ height: `${canvasHeight}px` }}
              tabIndex={0}
              role="application"
              aria-label={`Window Finder matrix of ${sites.length} sites by ${colCount} ${span} landing dates. Use arrow keys to inspect cells and Enter to load a scenario.`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={() => {
                if (dragRowRef.current === null) setFocusCell(null);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </>
      )}

      <p className="provenance wf-provenance">
        Ephemeris: JPL Horizons, MOON_ME · Terrain: LOLA south-pole rasters (Grades B, C) and smooth sphere (Grade D, no terrain) · Presets: illustrative, not agency requirements
      </p>
    </section>
  );
}
