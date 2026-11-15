// Caption bar for the scripted 30-second tour. It never blocks the pointer: any click, key, or scroll stops the tour.
import { motion } from 'framer-motion';
import { AUTOPILOT_STEPS, AUTOPILOT_TOTAL_S } from './autopilot-script.ts';

export function TourOverlay({ stepIndex }: { stepIndex: number }) {
  const step = AUTOPILOT_STEPS[stepIndex];
  if (!step) return null;
  return (
    <motion.div
      className="tour-overlay"
      role="status"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.25 }}
    >
      <div className="tour-head">
        <span>
          Autopilot {stepIndex + 1}/{AUTOPILOT_STEPS.length} · {step.title}
        </span>
        <span>Click, press a key, or scroll to stop</span>
      </div>
      <motion.p key={step.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {step.caption}
      </motion.p>
      <div className="tour-track" aria-hidden="true">
        <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: AUTOPILOT_TOTAL_S, ease: 'linear' }} />
      </div>
    </motion.div>
  );
}
