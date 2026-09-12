import { describe, expect, it } from 'vitest'
import { fitInWorkArea } from './window-position'
describe('display recovery', () => {
  it('recovers a pet from a disconnected display', () => {
    expect(fitInWorkArea({ x: 2200, y: 1000, width: 160, height: 170 },
      { x: 0, y: 25, width: 1440, height: 875 })).toEqual({ x: 1280, y: 730, width: 160, height: 170 })
  })
  it('preserves positions on displays with negative coordinates', () => {
    const bounds = { x: -900, y: 100, width: 160, height: 170 }
    expect(fitInWorkArea(bounds, { x: -1440, y: 0, width: 1440, height: 900 })).toEqual(bounds)
  })
})
