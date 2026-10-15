import { beforeAll, describe, expect, it } from 'vitest'
import { setSite } from '@/shared/site'
import { testSite } from '@/test/fixture'
import type { Alert, RoomState } from '@/shared/types'
import { ago, buildingTotals, emptyingSecondsLeft, freshness, healthScore, lastInputAt, topActions } from './live'

const room = (patch: Partial<RoomState>): RoomState => ({
  roomId: 'R',
  headcount: 0,
  occupancyKnown: true,
  occupied: false,
  emptySince: null,
  deviceOn: {},
  watts: 0,
  metered: false,
  co2ppm: 420,
  co2Measured: false,
  status: 'idle',
  sources: ['camera'],
  zones: {},
  kwh: 0,
  cost: 0,
  co2Kg: 0,
  wasteCost: 0,
  updatedAt: 0,
  ...patch,
})

beforeAll(() => setSite(testSite))

describe('shell live helpers', () => {
  it('labels a room emptying only while nobody is seen inside the empty delay (T1)', () => {
    const now = 100_000
    expect(emptyingSecondsLeft(room({ status: 'occupied', headcount: 0, emptySince: now - 20_000 }), 300, now)).toBe(280)
    expect(emptyingSecondsLeft(room({ status: 'occupied', headcount: 3, emptySince: null }), 300, now)).toBeNull()
    expect(emptyingSecondsLeft(room({ status: 'waste', emptySince: now - 400_000 }), 300, now)).toBeNull()
  })

  it('scores health from measured state and says nothing without inputs', () => {
    expect(healthScore([room({ status: 'unknown', sources: [] })], 0)).toBeNull()
    const h = healthScore([room({ status: 'waste', watts: 500 }), room({ status: 'occupied', headcount: 5, watts: 500 }), room({ status: 'unknown', sources: [] })], 2)!
    // Half the power is in an empty room (-20), one of three rooms is blind (-8), two alerts (-4).
    expect(h.factors.map((f) => f.lost)).toEqual([20, 8, 0, 4])
    expect(h.score).toBe(68)
  })

  it('totals power and money through the energy module', () => {
    const t = buildingTotals([room({ status: 'waste', watts: 1000 }), room({ status: 'occupied', watts: 1000 })])
    expect(t.watts).toBe(2000)
    expect(t.wasteWatts).toBe(1000)
    expect(t.costPerHour).toBeCloseTo(2 * testSite.tariffPerKwh)
  })

  it('finds the newest input and calls it stale after the sensor window', () => {
    expect(lastInputAt([], [])).toBeNull()
    expect(lastInputAt([{ ts: 5 }], [{ byId: { a: { ts: 9 } }, byType: {} }])).toBe(9)
    expect(freshness(null, 0)).toEqual({ kind: 'none' })
    expect(freshness(0, 30_000).kind).toBe('live')
    expect(freshness(0, 20 * 60_000).kind).toBe('stale')
    expect(ago(125)).toBe('2 min ago')
  })

  it('orders actions by monthly saving, then by load', () => {
    const alert = (id: string, saving: number | undefined, perHour: number) => ({ id, roomId: id, type: 'empty_with_load', since: 0, facts: { monthlySavingCost: saving, costPerHourNow: perHour } }) as unknown as Alert
    const ids = topActions([alert('a', undefined, 9), alert('b', 50, 1), alert('c', undefined, 20), alert('d', 10, 1)], {}).map((a) => a.id)
    expect(ids).toEqual(['b', 'd', 'c'])
  })
})
