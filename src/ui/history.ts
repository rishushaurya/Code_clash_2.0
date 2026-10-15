// Hourly roll-ups from GET /api/history (written by the server's minute tick), grouped for the Trends chart.

export interface HourRow {
  roomId: string
  /** Epoch ms of the hour's start */
  hour: number
  kwh: number
  cost: number
  wasteKwh: number
  wasteCost: number
  occupiedMinutes: number
  observedMinutes: number
}

export interface HistoryResponse {
  from: number
  to: number
  hours: HourRow[]
}

export type Range = 'day' | 'week' | 'month'
export const RANGE_MS: Record<Range, number> = { day: 24 * 3600_000, week: 7 * 24 * 3600_000, month: 30 * 24 * 3600_000 }

/** Start of the bucket a time falls in: the local hour for a day, the local day otherwise */
const bucketOf = (t: number, range: Range) => {
  const d = new Date(t)
  if (range === 'day') d.setMinutes(0, 0, 0)
  else d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Stored roll-ups added up per hour (day view) or per day; the totals are sums of stored values only */
export function bucket(rows: HourRow[], range: Range) {
  const map = new Map<number, { ts: number; usedKwh: number; wasteKwh: number; cost: number; wasteCost: number }>()
  for (const r of rows) {
    const ts = bucketOf(r.hour, range)
    const b = map.get(ts) ?? { ts, usedKwh: 0, wasteKwh: 0, cost: 0, wasteCost: 0 }
    b.usedKwh += r.kwh - r.wasteKwh
    b.wasteKwh += r.wasteKwh
    b.cost += r.cost
    b.wasteCost += r.wasteCost
    map.set(ts, b)
  }
  const sum = (k: 'kwh' | 'cost' | 'wasteKwh' | 'wasteCost' | 'occupiedMinutes' | 'observedMinutes') => rows.reduce((a, r) => a + r[k], 0)
  return {
    buckets: [...map.values()].sort((a, b) => a.ts - b.ts),
    totals: { kwh: sum('kwh'), cost: sum('cost'), wasteKwh: sum('wasteKwh'), wasteCost: sum('wasteCost'), occupiedHours: sum('occupiedMinutes') / 60, observedHours: sum('observedMinutes') / 60 },
  }
}
