// Telemetry strip: the current site, the selected instant, and what the Sun and Earth are doing there.
// It repeats the active card's engine results; it computes nothing.
import { motion } from 'framer-motion';
import { formatSignedDegrees, formatUtcStamp } from './format.ts';
import type { ScenarioResult, SiteDefinition } from './scenario.ts';
import { instantAt, sunWord } from './status.ts';
import { VerdictBadge } from './ui.tsx';

export type SectionId = 'globe' | 'board' | 'windows' | 'map';

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'globe', label: 'Globe' },
  { id: 'board', label: 'Compare' },
  { id: 'windows', label: 'Windows' },
  { id: 'map', label: 'Map' },
];

function Cell({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'sun' | 'earth' }) {
  return (
    <div className="telemetry-cell">
      <span className="telemetry-label">{label}</span>
      <span className={`telemetry-value ${tone ? `is-${tone}` : ''}`}>
        {value}
        {note && <em>{note}</em>}
      </span>
    </div>
  );
}

export function TopBar({
  site,
  result,
  scrubMinutes,
  instantMs,
  onNavigate,
  onOpenMethod,
}: {
  site: SiteDefinition | undefined;
  result: ScenarioResult | undefined;
  scrubMinutes: number;
  instantMs: number | null;
  onNavigate: (section: SectionId) => void;
  onOpenMethod: () => void;
}) {
  const now = result ? instantAt(result, scrubMinutes) : undefined;
  return (
    <header className="topbar">
      <button type="button" className="wordmark" onClick={() => onNavigate('globe')} aria-label="Oneiric, back to the Moon view">
        <span aria-hidden="true">◐</span> ONEIRIC
      </button>

      <div className="telemetry" role="group" aria-label="Current scenario telemetry">
        <Cell label="Site" value={site?.name ?? 'loading'} />
        <Cell label="UTC" value={instantMs !== null ? formatUtcStamp(instantMs) : '—'} />
        <Cell
          label="Sun elevation"
          tone="sun"
          value={now ? formatSignedDegrees(now.sunEl) : '—'}
          note={now ? sunWord(now.sunF) : undefined}
        />
        <Cell
          label="Earth elevation"
          tone="earth"
          value={now ? formatSignedDegrees(now.earthEl) : '—'}
          note={now ? (now.earthVis ? 'visible' : 'hidden') : undefined}
        />
        <div className="telemetry-cell telemetry-verdict">
          {result ? (
            <VerdictBadge verdict={result.verdict.verdict} grade={result.verdict.grade} compact />
          ) : (
            <span className="telemetry-value">
              <span className="spinner" aria-hidden="true" /> computing
            </span>
          )}
        </div>
      </div>

      <nav className="topnav" aria-label="Sections">
        {SECTIONS.map((section) => (
          <motion.button key={section.id} type="button" whileTap={{ scale: 0.96 }} onClick={() => onNavigate(section.id)}>
            {section.label}
          </motion.button>
        ))}
        <motion.button type="button" className="is-method" whileTap={{ scale: 0.96 }} onClick={onOpenMethod}>
          Method and checks
        </motion.button>
      </nav>
    </header>
  );
}
