import { describe, expect, it } from 'vitest'
import { bucket, type HourRow } from './history'

const row = (roomId: string, hour: number, kwh: number, cost: number, wasteKwh: number, wasteCost: number, occupiedMinutes: number): HourRow => ({ roomId, hour, kwh, cost, wasteKwh, wasteCost, occupiedMinutes, observedMinutes: 60 })

describe('trends history', () => {
  it('splits used and wasted energy per bucket and totals stored values', () => {
    const h = new Date(2026, 9, 15, 9).getTime()
    const rows = [row('A', h, 2, 10, 0.5, 2, 30), row('B', h, 1, 5, 0, 0, 60), row('A', h + 3600_000, 1, 5, 1, 5, 0)]
    const day = bucket(rows, 'day')
    expect(day.buckets).toHaveLength(2)
    expect(day.buckets[0]).toMatchObject({ usedKwh: 2.5, wasteKwh: 0.5 })
    expect(bucket(rows, 'week').buckets).toHaveLength(1)
    expect(day.totals).toMatchObject({ kwh: 4, wasteKwh: 1.5, occupiedHours: 1.5, observedHours: 3 })
  })
})
