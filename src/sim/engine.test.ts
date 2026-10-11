import { describe, expect, it } from 'vitest'
import { getSite } from '@/shared/site'
import { loadTestSite } from '@/test/fixture'

loadTestSite()
const building = getSite()
import { compareScenario, runScenario } from './engine'

const input = { params: { emptyMinutes: 5 }, days: 7, runs: 20, seed: 7 }

describe('simulation engine', () => {
  it('gives the same result for the same seed', () => {
    const a = runScenario({ ...input, policy: 'baseline' }, building.rooms)
    const b = runScenario({ ...input, policy: 'baseline' }, building.rooms)
    expect(a).toEqual(b)
  })

  it('never makes any policy worse than the manual baseline', () => {
    for (const policy of ['auto_off', 'daylight', 'consolidate', 'combined'] as const) {
      const c = compareScenario({ ...input, policy }, building.rooms)
      expect(c.savings.kwh.p10).toBeGreaterThanOrEqual(0)
      expect(c.policy.kwh.p50).toBeLessThanOrEqual(c.baseline.kwh.p50)
    }
  })

  it('auto-off saves a meaningful share and the range is ordered', () => {
    const c = compareScenario({ ...input, policy: 'auto_off' }, building.rooms)
    expect(c.savings.kwh.p50 / c.baseline.kwh.p50).toBeGreaterThan(0.05)
    expect(c.monthly.cost.p10).toBeLessThanOrEqual(c.monthly.cost.p50)
    expect(c.monthly.cost.p50).toBeLessThanOrEqual(c.monthly.cost.p90)
  })

  it('runs a week of the building, 20 times, well under 2 seconds', () => {
    const t = performance.now()
    compareScenario({ ...input, policy: 'combined' }, building.rooms)
    expect(performance.now() - t).toBeLessThan(2000)
  })
})


describe('automatic floor layout', () => {
  it('re-packs a floor when rooms move, and keeps drawn shapes', async () => {
    const { layoutRooms } = await import('@/shared/site')
    const rooms = layoutRooms(building.rooms)
    expect(rooms.every((r) => r.polygon && r.autoLayout)).toBe(true)
    const moved = layoutRooms(rooms.map((r) => (r.id === 'LH-2' ? { ...r, floor: 1 } : r)))
    const ground = moved.filter((r) => r.floor === 0)
    const xs = ground.map((r) => r.polygon![0][0]).sort((a, b) => a - b)
    expect(new Set(xs).size).toBe(ground.length) // no gap left where LH-2 was: every room has its own column
    const drawn = layoutRooms([{ ...rooms[0], polygon: [[1, 1], [9, 1], [9, 9]], autoLayout: undefined }])
    expect(drawn[0].polygon).toEqual([[1, 1], [9, 1], [9, 9]])
  })
})

describe('rooftop solar', () => {
  it('turns measured sunshine into yearly energy, money, CO2 and payback', async () => {
    const { solarEstimate } = await import('./engine')
    // 5.8 kWh/m2/day (Bengaluru, measured) x 0.75 x 10 kWp x 365 days
    const s = solarEstimate(5.8, 10, 8.73, 0.727, 50_000)
    expect(s.yearKwh).toBeCloseTo(15877.5, 1)
    expect(s.yearCost).toBeCloseTo(15877.5 * 8.73, 1)
    expect(s.yearCo2Kg).toBeCloseTo(15877.5 * 0.727, 1)
    expect(s.paybackYears).toBeCloseTo(500_000 / (15877.5 * 8.73), 3)
    expect(solarEstimate(5.8, 10, 8.73, 0.727).paybackYears).toBeNull()
  })
})

describe('opening hours', () => {
  it('models no load on closed days and more load over longer hours', async () => {
    const { setSite } = await import('@/shared/site')
    const { testSite } = await import('@/test/fixture')
    const run = (hours: typeof testSite.hours) => {
      setSite({ ...testSite, hours })
      return runScenario({ ...input, policy: 'baseline', runs: 5 }, testSite.rooms).kwh.p50
    }
    expect(run({ from: 9, to: 17, days: [] })).toBe(0)
    expect(run({ from: 7, to: 21, days: [0, 1, 2, 3, 4, 5] })).toBeGreaterThan(run({ from: 9, to: 17, days: [0, 1, 2, 3, 4] }))
    setSite(testSite)
  })
})
