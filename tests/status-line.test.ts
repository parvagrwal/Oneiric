import { describe, expect, it } from 'vitest'
import { AUTOPILOT_STEPS, AUTOPILOT_TOTAL_S, autopilotStepAt } from '../app/src/autopilot-script.ts'
import type { ScenarioResult, TrackPoint } from '../app/src/scenario.ts'
import { instantAt, percentWord, statusLine, statusSentence, sunWord } from '../app/src/status.ts'

function point(tMs: number, sunF: number, earthVis: boolean): TrackPoint {
  return { tMs, sunAz: 0, sunEl: 1, sunF, earthAz: 0, earthEl: 2, earthVis }
}

/** Only the fields the status line reads; the figures stand in for engine output. */
function fakeResult(metrics: { sunlitPct: number; earthVisiblePct: number; longestLinkGapH: number }, track: TrackPoint[]): ScenarioResult {
  return {
    startMs: 0,
    metrics,
    track,
    sample: { sunF: track[0].sunF, earthVis: track[0].earthVis },
  } as unknown as ScenarioResult
}

describe('plain-words status line', () => {
  it('reads like one sentence a person can take in at a glance', () => {
    const result = fakeResult({ sunlitPct: 82.3, earthVisiblePct: 100, longestLinkGapH: 0 }, [point(0, 1, true)])
    expect(statusSentence(statusLine(result, 0))).toBe('Sun: lit, Power: 82%, Earth: visible, Link: open')
  })

  it('uses the engine dark limit for the Sun word, never its own', () => {
    expect(sunWord(0)).toBe('dark')
    expect(sunWord(0.009)).toBe('dark')
    expect(sunWord(1 / 64)).toBe('partly lit')
    expect(sunWord(63 / 64)).toBe('partly lit')
    expect(sunWord(1)).toBe('lit')
  })

  it('never rounds a partial figure up to 100% or down to 0%', () => {
    expect(percentWord(100)).toBe('100%')
    expect(percentWord(99.6)).toBe('99.6%')
    expect(percentWord(0.4)).toBe('0.4%')
    expect(percentWord(0)).toBe('0%')
    expect(percentWord(28.3)).toBe('28%')
  })

  it('follows the scrubbed instant for Sun and Earth and the whole stay for power and link', () => {
    const track = [point(0, 1, true), point(600_000, 0, false)]
    const result = fakeResult({ sunlitPct: 28.3, earthVisiblePct: 83.4, longestLinkGapH: 25.7 }, track)
    expect(instantAt(result, 10)?.tMs).toBe(600_000)
    expect(statusSentence(statusLine(result, 0))).toBe('Sun: lit, Power: 28%, Earth: visible, Link: 83%')
    expect(statusSentence(statusLine(result, 10))).toBe('Sun: dark, Power: 28%, Earth: hidden, Link: 83%')
    const closed = fakeResult({ sunlitPct: 0, earthVisiblePct: 0, longestLinkGapH: 156 }, [point(0, 0, false)])
    const items = statusLine(closed, 0)
    expect(statusSentence(items)).toBe('Sun: dark, Power: 0%, Earth: hidden, Link: closed')
    expect(items.every((item) => !item.on)).toBe(true)
  })
})

describe('scripted tour', () => {
  it('runs for 30 seconds through globe, site, skyline, and verdict in order', () => {
    expect(AUTOPILOT_TOTAL_S).toBe(30)
    expect(AUTOPILOT_STEPS.map((step) => step.id)).toEqual(['globe', 'pole', 'site', 'skyline', 'verdict'])
    expect(AUTOPILOT_STEPS[0].atS).toBe(0)
    for (let i = 1; i < AUTOPILOT_STEPS.length; i++) {
      expect(AUTOPILOT_STEPS[i].atS).toBeGreaterThan(AUTOPILOT_STEPS[i - 1].atS)
      expect(AUTOPILOT_STEPS[i].atS).toBeLessThan(AUTOPILOT_TOTAL_S)
    }
  })

  it('maps elapsed time to the active step and ends at 30 seconds', () => {
    expect(autopilotStepAt(0)).toBe(0)
    expect(autopilotStepAt(5.9)).toBe(0)
    expect(autopilotStepAt(6)).toBe(1)
    expect(autopilotStepAt(29.9)).toBe(AUTOPILOT_STEPS.length - 1)
    expect(autopilotStepAt(30)).toBe(-1)
    expect(autopilotStepAt(-1)).toBe(-1)
  })
})
