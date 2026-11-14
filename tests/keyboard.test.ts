import { describe, expect, it } from 'vitest'
import { timeControlForKey } from '../app/src/keyboard.ts'

describe('time-control keyboard actions', () => {
  it('steps through the stay in ten-minute increments', () => {
    expect(timeControlForKey('ArrowLeft', 20, 100)).toEqual({ type: 'scrub', minutes: 10 })
    expect(timeControlForKey('ArrowRight', 20, 100)).toEqual({ type: 'scrub', minutes: 30 })
    expect(timeControlForKey('ArrowUp', 20, 100)).toEqual({ type: 'scrub', minutes: 30 })
    expect(timeControlForKey('ArrowDown', 20, 100)).toEqual({ type: 'scrub', minutes: 10 })
  })

  it('keeps arrow stepping inside the stay', () => {
    expect(timeControlForKey('ArrowLeft', 0, 100)).toEqual({ type: 'scrub', minutes: 0 })
    expect(timeControlForKey('ArrowRight', 100, 100)).toEqual({ type: 'scrub', minutes: 100 })
    expect(timeControlForKey('ArrowRight', 99, 100)).toEqual({ type: 'scrub', minutes: 100 })
  })

  it('jumps to either end and toggles playback with Space', () => {
    expect(timeControlForKey('Home', 55, 100)).toEqual({ type: 'scrub', minutes: 0 })
    expect(timeControlForKey('End', 55, 100)).toEqual({ type: 'scrub', minutes: 100 })
    expect(timeControlForKey(' ', 55, 100)).toEqual({ type: 'toggle-play' })
    expect(timeControlForKey('Spacebar', 55, 100)).toEqual({ type: 'toggle-play' })
  })

  it('ignores unrelated keys', () => {
    expect(timeControlForKey('PageDown', 55, 100)).toBeNull()
  })
})
