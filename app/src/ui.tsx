// Small shared display pieces: the verdict badge and the plain-words status line.
import { motion } from 'framer-motion';
import type { Grade, VerdictName } from '../../engine/index.ts';
import type { ScenarioResult } from './scenario.ts';
import { statusLine, statusSentence } from './status.ts';

function verdictClass(verdict: VerdictName): string {
  return verdict.toLowerCase().replace('-', '');
}

/** The verdict always travels with its fidelity grade, and always as words, never colour alone. */
export function VerdictBadge({ verdict, grade, compact = false }: { verdict: VerdictName; grade: Grade; compact?: boolean }) {
  const word = verdict === 'NONE' ? 'ANNUAL' : verdict;
  return (
    <motion.div
      key={word}
      className={`verdict-badge ${verdictClass(verdict)} ${compact ? 'is-compact' : ''}`}
      initial={{ scale: 0.86, opacity: 0.5 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 24 }}
    >
      <span>{word}</span>
      <small>Grade {grade}</small>
    </motion.div>
  );
}

/** "Sun: lit · Power: 82% · Earth: visible · Link: open": the engine's figures as four words. */
export function StatusLine({ result, scrubMinutes }: { result: ScenarioResult; scrubMinutes: number }) {
  const items = statusLine(result, scrubMinutes);
  return (
    <ul className="status-line" aria-label={`Status in plain words. ${statusSentence(items)}.`}>
      {items.map((item) => (
        <li key={item.key} className={`status-item is-${item.key} ${item.on ? 'is-on' : 'is-off'}`} title={item.detail}>
          <i aria-hidden="true" />
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.scope === 'now' ? 'at this instant' : 'over the stay'}</em>
        </li>
      ))}
    </ul>
  );
}
