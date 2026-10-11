// Recorded space utilization: every tick, rooms with a live occupancy input add to an
// hour-of-week summary (7 days x 24 hours). Real data only; nothing is filled in.
// seniordev: kept in this browser's storage; move to the Supabase event log for multi-device history.

import type { Room, RoomState } from '@/shared/types'
import { ns } from '@/shared/workspace'

const KEY = ns('pratibimb:usage')
const EMPTY_KEY = ns('pratibimb:empty-load-v2')
const SAVE_EVERY_MS = 60_000

/** Per room: 168 cells of [sum of seat share, samples, samples with people] */
type Usage = Record<string, [number, number, number][]>

const blank = () => Array.from({ length: 168 }, () => [0, 0, 0] as [number, number, number])

/** Per room, per hour of week: [samples while empty, samples while empty with load on] */
type EmptyLoad = Record<string, [number, number][]>

function loadEmpty(): EmptyLoad {
  try {
    return JSON.parse(localStorage.getItem(EMPTY_KEY) ?? '{}') as EmptyLoad
  } catch {
    return {}
  }
}

function load(): Usage {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Usage
  } catch {
    return {}
  }
}

let usage: Usage = typeof localStorage === 'undefined' ? {} : load()
let emptyLoad: EmptyLoad = typeof localStorage === 'undefined' ? {} : loadEmpty()
let lastSave = 0

/** Monday-based hour of week, 0..167 */
export const hourOfWeek = (t: number) => {
  const d = new Date(t)
  return ((d.getDay() + 6) % 7) * 24 + d.getHours()
}

export function recordUsage(states: RoomState[], rooms: Room[], now: number) {
  const h = hourOfWeek(now)
  for (const s of states) {
    if (!s.occupancyKnown) continue
    const room = rooms.find((r) => r.id === s.roomId)
    if (!room) continue
    const cells = (usage[s.roomId] ??= blank())
    cells[h][0] += Math.min(1, s.headcount / room.capacity)
    cells[h][1] += 1
    cells[h][2] += s.headcount > 0 ? 1 : 0
    // Only rooms where someone observes the devices can say whether an empty room was left on.
    if (!s.occupied && (s.metered || Object.keys(s.deviceOn).length)) {
      const e = (emptyLoad[s.roomId] ??= Array.from({ length: 168 }, () => [0, 0] as [number, number]))[h]
      e[0] += 1
      e[1] += s.status === 'waste' ? 1 : 0
    }
  }
  if (now - lastSave > SAVE_EVERY_MS) {
    lastSave = now
    try {
      localStorage.setItem(KEY, JSON.stringify(usage))
      localStorage.setItem(EMPTY_KEY, JSON.stringify(emptyLoad))
    } catch {
      // Storage full or blocked: keep the in-memory summary.
    }
  }
}

export interface RoomUsage {
  roomId: string
  /** Average seat share per hour of day (0-23), across the days that have data; null = no data */
  hourly: (number | null)[]
  inUse: number
  fillWhenUsed: number
  /** Hours of real observation behind these numbers */
  hoursObserved: number
}

/** Summary per room from what was actually observed. Empty array when nothing was recorded. */
export function readUsage(rooms: Room[]): RoomUsage[] {
  return rooms.flatMap((room) => {
    const cells = usage[room.id]
    if (!cells) return []
    const hourly: (number | null)[] = []
    let samples = 0
    let used = 0
    let fill = 0
    for (let hour = 0; hour < 24; hour++) {
      let f = 0
      let n = 0
      for (let day = 0; day < 7; day++) {
        const [sum, count, withPeople] = cells[day * 24 + hour]
        f += sum
        n += count
        used += withPeople
        fill += sum // empty samples add nothing, so this over used samples is the fill while in use
      }
      samples += n
      hourly.push(n ? f / n : null)
    }
    if (!samples) return []
    return [{ roomId: room.id, hourly, inUse: used / samples, fillWhenUsed: used ? fill / used : 0, hoursObserved: (samples * 2) / 3600 }]
  })
}

export function clearUsage() {
  usage = {}
  emptyLoad = {}
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(EMPTY_KEY)
  } catch {
    // Nothing stored.
  }
}

/**
 * Observed share of empty time with devices still on, across all watched rooms.
 * The Scenario Lab's "left on" assumption can take this measured value instead of a guess.
 * Returns null until at least 30 minutes of empty time has been observed.
 */
export function observedLeftOnShare(): { share: number; emptyHours: number } | null {
  let empty = 0
  let loaded = 0
  for (const cells of Object.values(emptyLoad)) {
    for (const [e, l] of cells) {
      empty += e
      loaded += l
    }
  }
  const emptyHours = (empty * 2) / 3600
  return emptyHours >= 0.5 ? { share: loaded / empty, emptyHours } : null
}

/**
 * Opening hours as observed: the days and hours in which watched rooms had people at least
 * 10 % of the time. Null until 5 hours of occupied observation exist.
 */
export function observedOpenHours(): { from: number; to: number; days: number[] } | null {
  const busy = new Array(168).fill(0)
  const seen = new Array(168).fill(0)
  for (const cells of Object.values(usage)) {
    cells.forEach(([, count, withPeople], h) => {
      seen[h] += count
      busy[h] += withPeople
    })
  }
  const occupiedSamples = busy.reduce((a, b) => a + b, 0)
  if ((occupiedSamples * 2) / 3600 < 5) return null
  const open = busy.map((b, h) => seen[h] > 0 && b / seen[h] >= 0.1)
  const hours = open.flatMap((o, h) => (o ? [h % 24] : []))
  const days = [...new Set(open.flatMap((o, h) => (o ? [Math.floor(h / 24)] : [])))].sort()
  return hours.length ? { from: Math.min(...hours), to: Math.max(...hours) + 1, days } : null
}

export interface WastePattern {
  roomId: string
  /** 0 = Monday ... 6 = Sunday */
  weekday: number
  hour: number
  /** Share of observed empty time in that hour with devices still on */
  share: number
  emptyHours: number
}

/**
 * When empty rooms are most often left on: the room-hours with the highest share of empty time
 * with load, among those observed empty for at least 20 minutes. Real observations only.
 */
export function wastePatterns(limit = 5): WastePattern[] {
  const out: WastePattern[] = []
  for (const [roomId, cells] of Object.entries(emptyLoad)) {
    cells.forEach(([e, l], h) => {
      const emptyHours = (e * 2) / 3600
      if (emptyHours >= 1 / 3 && l > 0) out.push({ roomId, weekday: Math.floor(h / 24), hour: h % 24, share: l / e, emptyHours })
    })
  }
  return out.sort((a, b) => b.share - a.share || b.emptyHours - a.emptyHours).slice(0, limit)
}
