// What-if engine: one-minute ticks over whole days, for every room, under a policy.
// It models a typical teaching week from the customer's rooms and assumptions (Scenario Lab);
// it never feeds the live twin, which shows only real inputs.

import {
  CLEANER_AFTER_CLOSE_MIN,
  DAY_END_MIN,
  DAY_START_MIN,
  DAYLIGHT_FROM_MIN,
  DAYLIGHT_TO_MIN,
} from '@/shared/config'
import { getSite } from '@/shared/site'
import type { DeviceType, PolicyId, Range, Room, ScenarioComparison, ScenarioInput, ScenarioResult } from '@/shared/types'

export const DEVICE_TYPES: DeviceType[] = ['light', 'fan', 'ac', 'projector', 'pc']
const MINUTES = DAY_END_MIN - DAY_START_MIN

/** Devices switched on per type, plus people present, for one minute */
export interface Minute {
  n: number
  on: Record<DeviceType, number>
}

/** Small seeded generator: the same seed always gives the same week */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const countByType = (room: Room) => {
  const c: Record<DeviceType, number> = { light: 0, fan: 0, ac: 0, projector: 0, pc: 0 }
  for (const d of room.devices) c[d.type]++
  return c
}

const wattByType = (room: Room) => {
  const w: Record<DeviceType, number> = { light: 0, fan: 0, ac: 0, projector: 0, pc: 0 }
  for (const d of room.devices) w[d.type] = d.ratedW
  return w
}

export const minuteWatts = (room: Room, m: Minute) => {
  const w = wattByType(room)
  return DEVICE_TYPES.reduce((sum, t) => sum + m.on[t] * w[t], 0)
}

interface Session {
  start: number
  end: number
  n: number
  projector: boolean
  leftOn: boolean
  acLeftOn: boolean
}

/** A day of classes for one room. Weekday 0-4 full days, 5 Saturday mornings, 6 Sunday closed. */
function sessionsFor(room: Room, weekday: number, rand: () => number): Session[] {
  const hours = getSite().hours
  if (!hours.days.includes(weekday)) return []
  const lastHour = hours.to - 1
  const sessions: Session[] = []
  const pLeftOn = getSite().leftOnProbability
  const behaviour = () => ({ leftOn: rand() < pLeftOn, acLeftOn: rand() < pLeftOn / 2 })

  if (room.type === 'office') {
    if (rand() < 0.9) {
      const n = 1 + Math.floor(rand() * room.capacity)
      sessions.push({ start: hours.from * 60 + Math.floor(rand() * 20), end: hours.to * 60, n, projector: false, ...behaviour() })
    }
    return sessions
  }

  const p = room.type === 'lecture_hall' ? 0.55 : room.type === 'lab' ? 0.5 : 0.65
  const length = room.type === 'lab' ? 2 : 1
  for (let h = hours.from; h + length <= lastHour + 1; h += length) {
    if (rand() >= p) continue
    sessions.push({
      start: h * 60 + Math.floor(rand() * 10),
      end: (h + length) * 60 - Math.floor(rand() * 10),
      n: Math.max(3, Math.round(room.capacity * (0.15 + rand() * 0.8))),
      projector: rand() < 0.7,
      ...behaviour(),
    })
  }
  return sessions
}

/** Smallest classroom that seats n people, for the consolidation policy */
function smallerRoomFor(room: Room, n: number, rooms: Room[]) {
  if (room.capacity < 60 || n > room.capacity * 0.4) return null
  // seniordev: ignores whether the smaller room is free at that hour; a timetable solver would check it.
  return rooms
    .filter((r) => r.type === 'classroom' && r.capacity >= n && r.capacity < room.capacity)
    .sort((a, b) => a.capacity - b.capacity)[0] ?? null
}

export interface PolicyParams {
  policy: PolicyId
  emptyMinutes: number
}

/**
 * One room, one day, minute by minute (DAY_START_MIN to DAY_END_MIN).
 * Random draws depend only on the seed, never on the policy, so baseline and policy
 * see the same classes and the same forgetful people (common random numbers).
 */
export function simulateRoomDay(room: Room, rooms: Room[], weekday: number, seed: number, params: PolicyParams): Minute[] {
  const rand = mulberry32(seed)
  const sessions = sessionsFor(room, weekday, rand)
  const cleanerRound = getSite().hours.to * 60 + CLEANER_AFTER_CLOSE_MIN
  const count = countByType(room)
  const autoOff = params.policy === 'auto_off' || params.policy === 'combined'
  const daylight = (params.policy === 'daylight' || params.policy === 'combined') && room.windowSide
  const consolidate = params.policy === 'consolidate' || params.policy === 'combined'

  const out: Minute[] = new Array(MINUTES)
  let s = 0
  for (let i = 0; i < MINUTES; i++) {
    const t = DAY_START_MIN + i
    while (s < sessions.length && sessions[s].end <= t) s++
    const cur = sessions[s] && sessions[s].start <= t ? sessions[s] : null
    const prev = s > 0 ? sessions[s - 1] : null
    const on: Record<DeviceType, number> = { light: 0, fan: 0, ac: 0, projector: 0, pc: 0 }
    let n = 0

    if (cur) {
      const moved = consolidate ? smallerRoomFor(room, cur.n, rooms) : null
      n = cur.n
      if (moved) {
        // The class runs next door: this room sits dark, and we charge the smaller room's load here.
        const c = countByType(moved)
        on.light = c.light
        on.fan = c.fan
        on.projector = cur.projector ? c.projector : 0
        out[i] = { n, on: scaleToRoom(on, moved, room) }
        continue
      }
      on.light = count.light
      on.fan = count.fan
      on.ac = count.ac
      on.projector = cur.projector ? count.projector : 0
      on.pc = Math.min(count.pc, room.type === 'office' ? count.pc : n)
      if (daylight && t >= DAYLIGHT_FROM_MIN && t < DAYLIGHT_TO_MIN) on.light = Math.ceil(on.light / 2)
    } else if (prev && prev.leftOn && t < cleanerRound) {
      const emptyFor = t - prev.end
      if (!(autoOff && emptyFor >= params.emptyMinutes)) {
        on.light = count.light
        on.fan = count.fan
        on.ac = prev.acLeftOn ? count.ac : 0
        on.projector = prev.projector ? count.projector : 0
        on.pc = room.type === 'lab' ? count.pc : 0
      }
    }
    out[i] = { n, on }
  }
  return out
}

/** Express another room's device counts as watts-equivalent counts of this room's devices */
function scaleToRoom(on: Record<DeviceType, number>, from: Room, to: Room): Record<DeviceType, number> {
  const wf = wattByType(from)
  const wt = wattByType(to)
  const scaled = { ...on }
  for (const t of DEVICE_TYPES) scaled[t] = wt[t] ? (on[t] * wf[t]) / wt[t] : 0
  return scaled
}

export function percentiles(values: number[]): Range {
  const v = [...values].sort((a, b) => a - b)
  const at = (p: number) => {
    const i = p * (v.length - 1)
    const lo = Math.floor(i)
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo)
  }
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) }
}

const seedFor = (base: number, run: number, roomIndex: number, day: number) => base * 1_000_003 + run * 10_007 + roomIndex * 101 + day

interface RunTotals {
  kwh: number
  daily: number[]
  perRoom: number[]
}

function runOnce(rooms: Room[], input: ScenarioInput, run: number): RunTotals {
  const params: PolicyParams = { policy: input.policy, emptyMinutes: input.params.emptyMinutes ?? 5 }
  const daily = new Array(input.days).fill(0)
  const perRoom = new Array(rooms.length).fill(0)
  rooms.forEach((room, ri) => {
    for (let d = 0; d < input.days; d++) {
      const minutes = simulateRoomDay(room, rooms, d % 7, seedFor(input.seed, run, ri, d), params)
      let wattMinutes = 0
      for (const m of minutes) wattMinutes += minuteWatts(room, m)
      const kwh = wattMinutes / 60 / 1000
      daily[d] += kwh
      perRoom[ri] += kwh
    }
  })
  return { kwh: daily.reduce((a, b) => a + b, 0), daily, perRoom }
}

function summarise(rooms: Room[], input: ScenarioInput, runs: RunTotals[]): ScenarioResult {
  const kwh = runs.map((r) => r.kwh)
  return {
    policy: input.policy,
    days: input.days,
    kwh: percentiles(kwh),
    cost: percentiles(kwh.map((k) => k * getSite().tariffPerKwh)),
    co2Kg: percentiles(kwh.map((k) => k * getSite().gridKgPerKwh)),
    daily: Array.from({ length: input.days }, (_, d) => ({ day: d, ...percentiles(runs.map((r) => r.daily[d])) })),
    perRoom: rooms.map((room, ri) => ({ roomId: room.id, kwhP50: percentiles(runs.map((r) => r.perRoom[ri])).p50 })),
  }
}

export function runScenario(input: ScenarioInput, rooms: Room[]): ScenarioResult {
  const runs = Array.from({ length: input.runs }, (_, r) => runOnce(rooms, input, r))
  return summarise(rooms, input, runs)
}

/** Baseline and policy on the same seeds; savings are taken run by run, then summarised. */
export function compareScenario(input: ScenarioInput, rooms: Room[]): ScenarioComparison {
  const baseInput = { ...input, policy: 'baseline' as const }
  const base = Array.from({ length: input.runs }, (_, r) => runOnce(rooms, baseInput, r))
  const pol = Array.from({ length: input.runs }, (_, r) => runOnce(rooms, input, r))
  const saved = base.map((b, i) => b.kwh - pol[i].kwh)
  const toMonth = 30 / input.days
  const ranges = (k: number[]) => ({
    kwh: percentiles(k),
    cost: percentiles(k.map((x) => x * getSite().tariffPerKwh)),
    co2Kg: percentiles(k.map((x) => x * getSite().gridKgPerKwh)),
  })
  return {
    baseline: summarise(rooms, baseInput, base),
    policy: summarise(rooms, input, pol),
    savings: ranges(saved),
    monthly: ranges(saved.map((x) => x * toMonth)),
  }
}

export const POLICY_LABELS: Record<PolicyId, string> = {
  baseline: 'Today (manual switching)',
  auto_off: 'Auto-off when empty',
  daylight: 'Daylight harvesting',
  consolidate: 'Move small classes to smaller rooms',
  combined: 'All three together',
}

/** Energy Performance Index: kWh per square metre per year, from a simulated week */
export const epi = (weekKwh: number, rooms: Room[]) => (weekKwh * 52) / Math.max(1, rooms.reduce((a, r) => a + r.areaM2, 0))

/** Typical performance ratio for rooftop PV: inverter, wiring, temperature and soiling losses */
export const PV_PERFORMANCE_RATIO = 0.75

/**
 * Rooftop solar estimate from measured sunshine at the site.
 * kWh per kWp per day = peak sun hours (kWh/m2/day of global horizontal radiation) x performance ratio.
 * seniordev: horizontal radiation, no tilt or shading model; use PVGIS or PVWatts for a bankable quote.
 */
export function solarEstimate(sunKwhPerM2Day: number, kWp: number, tariffPerKwh: number, gridKgPerKwh: number, costPerKwp = 0) {
  const yearKwh = sunKwhPerM2Day * PV_PERFORMANCE_RATIO * kWp * 365
  const yearCost = yearKwh * tariffPerKwh
  return {
    yearKwh,
    yearCost,
    yearCo2Kg: yearKwh * gridKgPerKwh,
    paybackYears: costPerKwp > 0 && yearCost > 0 ? (costPerKwp * kWp) / yearCost : null,
  }
}
