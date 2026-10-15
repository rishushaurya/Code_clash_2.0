// Hourly roll-ups from GET /api/history (stored by the server's minute tick), grouped for the Trends chart.
// Accepts camelCase or the table's snake_case, wrapped in { hours } or { rows } or bare, so a small shape
// difference between branches never blanks the page.

export interface HourRow {
  roomId: string
  hour: number
  kwh: number
  cost: number
  wasteKwh: number
  wasteCost: number
  occupiedMinutes: number
  observedMinutes: number
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export function parseHistory(body: unknown): HourRow[] {
  const b = body as { hours?: unknown; rows?: unknown } | unknown[] | null
  const list = Array.isArray(b) ? b : Array.isArray(b?.hours) ? b.hours : Array.isArray(b?.rows) ? b.rows : []
  return (list as Record<string, unknown>[])
    .map((r) => ({
      roomId: String(r.roomId ?? r.room_id ?? ''),
      hour: typeof r.hour === 'number' ? r.hour : Date.parse(String(r.hour)),
      kwh: n(r.kwh),
      cost: n(r.cost),
      wasteKwh: n(r.wasteKwh ?? r.waste_kwh),
      wasteCost: n(r.wasteCost ?? r.waste_cost),
      occupiedMinutes: n(r.occupiedMinutes ?? r.occupied_minutes),
      observedMinutes: n(r.observedMinutes ?? r.observed_minutes),
    }))
    .filter((r) => r.roomId && Number.isFinite(r.hour))
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
