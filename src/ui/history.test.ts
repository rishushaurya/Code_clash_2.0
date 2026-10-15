import { describe, expect, it } from 'vitest'
import { bucket, parseHistory } from './history'

describe('trends history', () => {
  it('reads snake_case rows from the table and camelCase rows alike', () => {
    const rows = parseHistory({ rows: [{ room_id: 'LH-1', hour: '2026-10-15T09:00:00Z', kwh: 2, cost: 16, waste_kwh: 0.5, waste_cost: 4, occupied_minutes: 40, observed_minutes: 60 }] })
    expect(rows[0]).toMatchObject({ roomId: 'LH-1', kwh: 2, wasteKwh: 0.5, occupiedMinutes: 40 })
    expect(parseHistory({ hours: [{ roomId: 'A', hour: 0, kwh: 1 }] })).toHaveLength(1)
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory([{ hour: 0 }])).toEqual([])
  })

  it('splits used and wasted energy per bucket and totals stored values', () => {
    const h = new Date(2026, 9, 15, 9).getTime()
    const rows = parseHistory([
      { roomId: 'A', hour: h, kwh: 2, cost: 10, wasteKwh: 0.5, wasteCost: 2, occupiedMinutes: 30, observedMinutes: 60 },
      { roomId: 'B', hour: h, kwh: 1, cost: 5, wasteKwh: 0, wasteCost: 0, occupiedMinutes: 60, observedMinutes: 60 },
      { roomId: 'A', hour: h + 3600_000, kwh: 1, cost: 5, wasteKwh: 1, wasteCost: 5, occupiedMinutes: 0, observedMinutes: 60 },
    ])
    const day = bucket(rows, 'day')
    expect(day.buckets).toHaveLength(2)
    expect(day.buckets[0]).toMatchObject({ usedKwh: 2.5, wasteKwh: 0.5 })
    expect(bucket(rows, 'week').buckets).toHaveLength(1)
    expect(day.totals).toMatchObject({ kwh: 4, wasteKwh: 1.5, occupiedHours: 1.5, observedHours: 3 })
  })
})
