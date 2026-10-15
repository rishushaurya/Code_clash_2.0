// One card per room: every alert a room has right now becomes a finding on that room's card, so a room with
// waste, high CO2 and an over-cooled AC shows one card with three findings, not three cards repeating its load.
// Cards and findings are ordered by the monthly saving code computed, then by how urgent the alert type is.

import type { Alert, AlertType, Recommendation } from '@/shared/types'

/** Lower is more urgent: waste first, then broken inputs, then air, comfort and space */
export const ALERT_ORDER: Record<AlertType, number> = {
  empty_with_load: 0,
  camera_offline: 1,
  reported: 1,
  co2_high: 2,
  ac_mild_weather: 3,
  ac_overcooling: 3,
  over_capacity: 4,
  underused: 5,
  daylight_available: 6,
}

export interface Finding {
  alert: Alert
  /** The card text; 'loading' while the AI writes the reason, undefined before it starts */
  rec: Recommendation | 'loading' | undefined
  /** Money per month, from the engine; 0 when the alert has no modelled saving */
  monthlySaving: number
}

export interface RoomCard {
  roomId: string
  roomName: string
  /** The room's load now, stated once for the whole card */
  wattsNow: number
  costPerHourNow: number
  /** true when the room is empty and drawing power */
  wasting: boolean
  findings: Finding[]
  /** Sum of the findings' monthly savings */
  monthlySaving: number
  /** The earliest finding's start, for "since" */
  since: number
}

const saving = (a: Alert, rec: Finding['rec']) => (rec && rec !== 'loading' ? rec.monthlySavingCost : null) ?? a.facts.monthlySavingCost ?? 0
const urgency = (c: RoomCard) => Math.min(...c.findings.map((f) => ALERT_ORDER[f.alert.type]))

export function groupAlerts(alerts: Alert[], recs: Record<string, Recommendation | 'loading'>): RoomCard[] {
  const cards = new Map<string, RoomCard>()
  for (const alert of alerts) {
    const rec = recs[alert.id]
    const finding = { alert, rec, monthlySaving: saving(alert, rec) }
    const card = cards.get(alert.roomId)
    if (card) {
      card.findings.push(finding)
      card.monthlySaving += finding.monthlySaving
      card.wasting ||= alert.type === 'empty_with_load'
      card.since = Math.min(card.since, alert.since)
    } else {
      cards.set(alert.roomId, {
        roomId: alert.roomId,
        roomName: alert.facts.roomName,
        wattsNow: alert.facts.wattsNow,
        costPerHourNow: alert.facts.costPerHourNow,
        wasting: alert.type === 'empty_with_load',
        findings: [finding],
        monthlySaving: finding.monthlySaving,
        since: alert.since,
      })
    }
  }
  for (const c of cards.values()) c.findings.sort((a, b) => b.monthlySaving - a.monthlySaving || ALERT_ORDER[a.alert.type] - ALERT_ORDER[b.alert.type])
  return [...cards.values()].sort((a, b) => b.monthlySaving - a.monthlySaving || urgency(a) - urgency(b) || b.wattsNow - a.wattsNow)
}
