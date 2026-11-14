export type TimeControlAction =
  | { type: 'scrub'; minutes: number }
  | { type: 'toggle-play' }

const STEP_MINUTES = 10

function clampMinutes(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, value))
}

export function timeControlForKey(key: string, currentMinutes: number, maximumMinutes: number): TimeControlAction | null {
  const maximum = Math.max(0, maximumMinutes)
  const current = clampMinutes(currentMinutes, maximum)

  if (key === ' ' || key === 'Spacebar') return { type: 'toggle-play' }
  if (key === 'ArrowLeft' || key === 'ArrowDown') return { type: 'scrub', minutes: clampMinutes(current - STEP_MINUTES, maximum) }
  if (key === 'ArrowRight' || key === 'ArrowUp') return { type: 'scrub', minutes: clampMinutes(current + STEP_MINUTES, maximum) }
  if (key === 'Home') return { type: 'scrub', minutes: 0 }
  if (key === 'End') return { type: 'scrub', minutes: maximum }
  return null
}
