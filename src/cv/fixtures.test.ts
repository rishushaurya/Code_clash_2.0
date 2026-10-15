import { describe, expect, it } from 'vitest'
import { averageFrames, findLights, findMotion, findScreens } from './fixtures'
import type { Frame } from './lightZones'

const W = 320
const H = 180
/** A grey frame with bright rectangles (pixel boxes) painted on it */
function frame(base: number, boxes: [number, number, number, number, number][] = []): Frame {
  const data = new Uint8ClampedArray(W * H * 4).fill(base)
  for (const [x0, y0, w, h, v] of boxes) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.fill(v, (y * W + x) * 4, (y * W + x) * 4 + 4)
  return { width: W, height: H, data }
}

describe('auto-find lights', () => {
  it('proposes one zone per fixture that got brighter, in reading order', () => {
    const off = frame(40)
    const on = frame(40, [
      [200, 20, 40, 12, 250],
      [40, 24, 40, 12, 240],
    ])
    const found = findLights(off, on)
    expect(found).toHaveLength(2)
    const [left, right] = found
    expect(left.x).toBeLessThan(40 / W)
    expect(left.x + left.w).toBeGreaterThan(80 / W)
    expect(right.x).toBeLessThan(200 / W)
    expect(right.y).toBeLessThan(20 / H)
  })

  it('proposes nothing when the lights did not change the picture, or for a speck of noise', () => {
    expect(findLights(frame(40), frame(45))).toEqual([])
    expect(findLights(frame(40), frame(40, [[100, 100, 4, 4, 255]]))).toEqual([])
  })

  it('averages frames so one noisy frame does not decide', () => {
    expect(averageFrames([frame(10), frame(30)]).data[0]).toBe(20)
  })
})

describe('auto-find fans', () => {
  it('finds the region that keeps changing, and ignores a still picture', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(60, [[120, 60, 48, 48, i % 2 ? 200 : 60]]))
    const found = findMotion(frames)
    expect(found).toHaveLength(1)
    expect(found[0].x).toBeCloseTo(116 / W, 2)
    expect(findMotion(Array.from({ length: 10 }, () => frame(60)))).toEqual([])
  })

  it('keeps out a person who crosses once', () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(60, i === 5 ? [[10, 10, 30, 80, 200]] : []))
    expect(findMotion(frames)).toEqual([])
  })
})

describe('screens', () => {
  it('takes the detection that saw the most screens, as picture fractions', () => {
    const found = findScreens([[{ x: 0, y: 0, w: 64, h: 36 }], [{ x: 320, y: 180, w: 160, h: 90 }, { x: 0, y: 0, w: 64, h: 36 }]], 640, 360)
    expect(found).toEqual([
      { x: 0, y: 0, w: 0.1, h: 0.1 },
      { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
    ])
  })
})
