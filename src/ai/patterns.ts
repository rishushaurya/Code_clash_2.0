// Waste patterns as AI facts and as an offline sentence. Numbers come from src/twin/usage.ts observations.

import type { WastePattern } from '@/twin/usage'

export const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_LONG = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

export const patternFacts = (list: WastePattern[]) =>
  list.map((p) => ({ roomId: p.roomId, day: DAY_LONG[p.weekday], hour: `${p.hour}:00`, leftOnPercent: Math.round(p.share * 100), emptyHoursObserved: Math.round(p.emptyHours * 10) / 10 }))

export function templatePatterns(list: WastePattern[]) {
  if (!list.length) return ''
  const [top] = list
  return `Empty rooms are most often left on in ${top.roomId} on ${DAY_LONG[top.weekday]} around ${top.hour}:00 (${Math.round(top.share * 100)}% of the empty time watched). A switch-off check or an auto-off rule at that hour would catch most of it.`
}
