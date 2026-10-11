import { describe, expect, it } from 'vitest'
import { classify, meanLuminance, median, type Zone } from './lightZones'

const zone: Zone = { id: 'z1', x: 0, y: 0, w: 0.5, h: 0.5, onRef: 200, offRef: 40 }

describe('light zones', () => {
  it('reads on and off against the calibration, and holds inside the band', () => {
    expect(classify(zone, 210)).toBe(true)
    expect(classify(zone, 30)).toBe(false)
    expect(classify({ ...zone, on: true }, 121)).toBe(true)
    expect(classify({ ...zone, on: false }, 121)).toBe(false)
  })

  it('reports nothing for an uncalibrated zone', () => {
    expect(classify({ id: 'z2', x: 0, y: 0, w: 1, h: 1 }, 100)).toBeUndefined()
  })

  it('handles lamps that look darker when on (backlit fixtures)', () => {
    expect(classify({ ...zone, onRef: 40, offRef: 200 }, 30)).toBe(true)
  })

  it('measures the mean brightness of just the zone', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) data.fill(255, (y * 4 + x) * 4, (y * 4 + x) * 4 + 4)
    const frame = { width: 4, height: 4, data } as unknown as ImageData
    expect(meanLuminance(frame, zone)).toBeCloseTo(255, 3)
    expect(meanLuminance(frame, { ...zone, x: 0.5 })).toBe(0)
  })

  it('smooths a missed frame away with the median', () => {
    expect(median([12, 12, 0, 11, 12])).toBe(12)
  })
})

describe('fan zones', () => {
  const frame = (v: number) => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).fill(v) }) as unknown as ImageData
  const fan: Zone = { id: 'F1', x: 0, y: 0, w: 1, h: 1, kind: 'motion' }

  it('sees turning blades as change between frames', async () => {
    const { meanMotion, classifyZone } = await import('./lightZones')
    expect(meanMotion(frame(10), frame(10), fan)).toBe(0)
    expect(meanMotion(frame(10), frame(40), fan)).toBe(30)
    expect(classifyZone(fan, 30, 6)).toBe(true)
    expect(classifyZone(fan, 1, 6)).toBe(false)
  })

  it('leaves uncalibrated light zones unreported', async () => {
    const { classifyZone } = await import('./lightZones')
    expect(classifyZone({ id: 'L1', x: 0, y: 0, w: 1, h: 1, kind: 'brightness' }, 200, 6)).toBeUndefined()
  })
})

describe('room boundary', () => {
  it('counts a person only when their feet are inside the drawn room', async () => {
    const { insideRegion } = await import('./lightZones')
    const room: Zone = { id: 'ROOM', x: 0.1, y: 0.3, w: 0.8, h: 0.7, kind: 'region' }
    expect(insideRegion({ x: 400, y: 200, w: 100, h: 300 }, room, 1000, 600)).toBe(true) // feet at (450, 500)
    expect(insideRegion({ x: 20, y: 50, w: 50, h: 100 }, room, 1000, 600)).toBe(false) // corridor at the edge
    expect(insideRegion({ x: 20, y: 50, w: 50, h: 100 }, { ...room, w: 0 }, 1000, 600)).toBe(true) // no boundary drawn: whole frame
  })
})

describe('activity log CSV', () => {
  it('quotes every field and escapes quotes so spreadsheets read it safely', async () => {
    const { toCsv } = await import('@/ui/components/ActivityLog')
    expect(toCsv([['a', 'say "hi"'], ['x,y', '']])).toBe('"a","say ""hi"""\r\n"x,y",""')
    // Formula injection: anything a spreadsheet would execute is prefixed with an apostrophe
    expect(toCsv([['=HYPERLINK("x")', '+1', '-2', '@SUM']])).toBe(`"'=HYPERLINK(""x"")","'+1","'-2","'@SUM"`)
  })
})
