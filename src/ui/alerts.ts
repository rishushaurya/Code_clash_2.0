// Alert lifecycle for the Alerts page. The twin raises and clears alerts every tick; this keeps which open
// alerts a person acknowledged, and the alerts that cleared (resolved) during this session with their last facts.
// seniordev: kept in memory for the session; the server's events table holds the long-term record.

import { create } from 'zustand'
import type { Alert, Recommendation } from '@/shared/types'
import { useTwin } from '@/twin/store'

export interface Resolved {
  alert: Alert
  rec?: Recommendation
  resolvedAt: number
}

export const useAlertLog = create<{ acked: Record<string, number>; resolved: Resolved[] }>(() => ({ acked: {}, resolved: [] }))

export const acknowledge = (id: string) => useAlertLog.setState((s) => ({ acked: { ...s.acked, [id]: Date.now() } }))
export const reopen = (id: string) =>
  useAlertLog.setState((s) => {
    const acked = { ...s.acked }
    delete acked[id]
    return { acked }
  })

useTwin.subscribe((s, prev) => {
  if (s.alerts === prev.alerts) return
  const open = new Set(s.alerts.map((a) => a.id))
  const gone = prev.alerts.filter((a) => !open.has(a.id))
  if (!gone.length) return
  const now = Date.now()
  useAlertLog.setState((st) => ({
    resolved: [...gone.map((alert) => ({ alert, rec: typeof prev.recs[alert.id] === 'object' ? (prev.recs[alert.id] as Recommendation) : undefined, resolvedAt: now })), ...st.resolved].slice(0, 200),
  }))
})

/** Open alerts nobody has acknowledged: the count on the bell and in the menu */
export function useOpenAlertCount() {
  const alerts = useTwin((s) => s.alerts)
  const acked = useAlertLog((s) => s.acked)
  return alerts.filter((a) => !acked[a.id]).length
}
