// What the shell says about the live twin: building totals, the health score, today's actions, the
// "Emptying" label and how fresh the inputs are. Pure functions over the twin's state, tested in live.test.ts;
// energy and money come from src/twin/energy.ts.

import { CO2_ALERT_PPM, SENSOR_FRESH_MS } from '@/shared/config'
import type { Alert, Recommendation, RoomState } from '@/shared/types'
import { costPerHour } from '@/twin/energy'

export function buildingTotals(rooms: RoomState[]) {
  const watts = rooms.reduce((a, r) => a + r.watts, 0)
  const wasteWatts = rooms.filter((r) => r.status === 'waste').reduce((a, r) => a + r.watts, 0)
  return { watts, wasteWatts, costPerHour: costPerHour(watts), wasteCostPerHour: costPerHour(wasteWatts), wasteCost: rooms.reduce((a, r) => a + r.wasteCost, 0) }
}

/** Newest timestamp among camera readings and sensor inputs, or null when nothing ever reported */
export function lastInputAt(readings: { ts: number }[], sensors: { occupancy?: { ts: number }; power?: { ts: number }; air?: { ts: number }; byId: Record<string, { ts: number }>; byType: Partial<Record<string, { ts: number }>> }[]) {
  const ts = [
    ...readings.map((r) => r.ts),
    ...sensors.flatMap((s) => [s.occupancy?.ts, s.power?.ts, s.air?.ts, ...Object.values(s.byId).map((o) => o.ts), ...Object.values(s.byType).map((o) => o?.ts)]),
  ].filter((t): t is number => Number.isFinite(t))
  return ts.length ? Math.max(...ts) : null
}

export type Freshness = { kind: 'none' } | { kind: 'live' | 'recent' | 'stale'; ageS: number }

/** Live under a minute; stale once older than the sensor freshness window, when inputs stop counting */
export function freshness(last: number | null, now: number): Freshness {
  if (last === null) return { kind: 'none' }
  const ageS = Math.max(0, Math.round((now - last) / 1000))
  return { kind: ageS < 60 ? 'live' : ageS * 1000 < SENSOR_FRESH_MS ? 'recent' : 'stale', ageS }
}

/** "12 s ago", "4 min ago", "3 h ago" */
export function ago(ageS: number) {
  if (ageS < 60) return `${ageS} s ago`
  if (ageS < 3600) return `${Math.round(ageS / 60)} min ago`
  return `${Math.round(ageS / 3600)} h ago`
}

/**
 * The twin keeps a room "occupied" for the empty delay after the last person is seen (T1). With nobody in the
 * room that is not occupied but emptying: returns the seconds left, or null when the label does not apply.
 */
export function emptyingSecondsLeft(s: RoomState, emptyDelayS: number, now: number) {
  if (s.status !== 'occupied' || s.headcount > 0 || s.emptySince === null) return null
  return Math.max(0, Math.ceil(emptyDelayS - (now - s.emptySince) / 1000))
}

export interface HealthFactor {
  label: string
  /** Points taken off the 100 */
  lost: number
  max: number
  detail: string
}

/**
 * Building health, 0 to 100, from what the twin measures now: power drawn in empty rooms, rooms with no live
 * input, rooms above the CO2 guideline, and open alerts. Null when no room has a live input yet: there is
 * nothing measured to score.
 */
export function healthScore(rooms: RoomState[], openAlerts: number): { score: number; factors: HealthFactor[] } | null {
  const watched = rooms.filter((r) => r.status !== 'unknown')
  if (!watched.length) return null
  const t = buildingTotals(rooms)
  const co2High = watched.filter((r) => (r.occupancyKnown || r.co2Measured) && r.co2ppm > CO2_ALERT_PPM).length
  const blind = rooms.length - watched.length
  const factor = (label: string, max: number, share: number, detail: string): HealthFactor => ({ label, max, lost: Math.round(max * Math.min(1, share)), detail })
  const factors = [
    factor('Power in empty rooms', 40, t.watts > 0 ? t.wasteWatts / t.watts : 0, `${Math.round(t.wasteWatts)} W of ${Math.round(t.watts)} W`),
    factor('Rooms with no live input', 25, blind / rooms.length, `${blind} of ${rooms.length} rooms`),
    factor('Indoor CO2 above 1000 ppm', 15, co2High / watched.length, `${co2High} of ${watched.length} watched rooms`),
    factor('Open alerts', 20, openAlerts / 10, `${openAlerts} open`),
  ]
  return { score: 100 - factors.reduce((a, f) => a + f.lost, 0), factors }
}

/** The biggest savings available now: alerts with a fix, largest monthly saving first, then largest load */
export function topActions(alerts: Alert[], recs: Record<string, Recommendation | 'loading'>, n = 3) {
  const saving = (a: Alert) => {
    const r = recs[a.id]
    return (r && r !== 'loading' ? r.monthlySavingCost : null) ?? a.facts.monthlySavingCost ?? 0
  }
  return [...alerts].sort((a, b) => saving(b) - saving(a) || b.facts.costPerHourNow - a.facts.costPerHourNow).slice(0, n)
}
