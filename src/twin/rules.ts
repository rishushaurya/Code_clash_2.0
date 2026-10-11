// Rules turn twin state into alerts, and alerts into the facts pack the AI is allowed to quote.

import { CO2_ALERT_PPM, DAYLIGHT_FROM_MIN, DAYLIGHT_TO_MIN } from '@/shared/config'

/** BEE (India) default setting for star-labelled room ACs since January 2020 */
export const AC_DEFAULT_C = 24
/** BEE: each degree higher saves about 6 % of AC electricity */
export const AC_SAVING_PER_DEGREE = 0.06
/** A room measured this far below 24 C with ACs on is being overcooled */
const OVERCOOL_MARGIN_C = 1
import type { AlertType, DeviceType, FactsPack, Room, RoomState } from '@/shared/types'
import { costPerHour, round } from './energy'

export interface RuleContext {
  now: number
  /** Real local minute of the day */
  minuteOfDay: number
  currency: string
  /** Open-Meteo cloud cover in percent; null when offline */
  cloudCover: number | null
  /** Open-Meteo outdoor temperature; null when offline or no location */
  outdoorTempC?: number | null
  /** Engine estimates, money per month, per room */
  autoOffSaving: Record<string, number>
  consolidateSaving: Record<string, number>
}

export function alertTypesFor(room: Room, s: RoomState, ctx: RuleContext): AlertType[] {
  const types: AlertType[] = []
  if (s.status === 'unknown') return types
  if (s.status === 'waste') types.push('empty_with_load')
  if (s.headcount > room.capacity) types.push('over_capacity')
  if (s.co2ppm > CO2_ALERT_PPM) types.push('co2_high')
  const lights = room.devices.filter((d) => d.type === 'light')
  const allLightsOn = lights.length > 0 && lights.every((d) => s.deviceOn[d.id])
  const daytime = ctx.minuteOfDay >= DAYLIGHT_FROM_MIN && ctx.minuteOfDay < DAYLIGHT_TO_MIN
  if (room.windowSide && s.occupied && allLightsOn && daytime && (ctx.cloudCover ?? 0) < 60) types.push('daylight_available')
  if (s.occupied && room.capacity >= 60 && s.headcount > 0 && s.headcount < room.capacity * 0.25) types.push('underused')
  // Cooling with ACs when the outside air is already at or below the BEE default setting of 24 C.
  const acOn = room.devices.some((d) => d.type === 'ac' && s.deviceOn[d.id])
  if (s.occupied && acOn && ctx.outdoorTempC != null && ctx.outdoorTempC <= AC_DEFAULT_C) types.push('ac_mild_weather')
  if (acOn && s.temperatureC !== undefined && s.temperatureC < AC_DEFAULT_C - OVERCOOL_MARGIN_C) types.push('ac_overcooling')
  return types
}

export function devicesOnSummary(room: Room, s: RoomState) {
  const byType = new Map<DeviceType, { type: DeviceType; count: number; watts: number }>()
  for (const d of room.devices) {
    if (!s.deviceOn[d.id]) continue
    const e = byType.get(d.type) ?? { type: d.type, count: 0, watts: 0 }
    e.count++
    e.watts += d.ratedW
    byType.set(d.type, e)
  }
  return [...byType.values()]
}

export function smallerRoomFor(room: Room, people: number, rooms: Room[]) {
  return rooms
    .filter((r) => r.id !== room.id && r.type === 'classroom' && r.capacity >= people && r.capacity < room.capacity)
    .sort((a, b) => a.capacity - b.capacity)[0]
}

export function factsFor(room: Room, s: RoomState, type: AlertType, ctx: RuleContext, rooms: Room[]): FactsPack {
  const facts: FactsPack = {
    roomId: room.id,
    roomName: room.name,
    alertType: type,
    devicesOn: devicesOnSummary(room, s),
    wattsNow: round(s.watts, 0),
    costPerHourNow: round(costPerHour(s.watts)),
    kwhToday: round(s.kwh),
    costToday: round(s.cost),
    co2KgToday: round(s.co2Kg),
    capacity: room.capacity,
    currency: ctx.currency,
  }
  if (s.emptySince) facts.minutesEmpty = round((ctx.now - s.emptySince) / 60000, 1)
  if (type === 'co2_high') facts.co2ppm = round(s.co2ppm, 0)
  if (type === 'ac_mild_weather' && ctx.outdoorTempC != null) facts.outdoorTempC = round(ctx.outdoorTempC, 1)
  if (type === 'ac_overcooling' && s.temperatureC !== undefined) {
    facts.indoorTempC = round(s.temperatureC, 1)
    facts.acSavingPercent = Math.round((AC_DEFAULT_C - s.temperatureC) * AC_SAVING_PER_DEGREE * 100)
  }
  if (type === 'over_capacity' || type === 'underused' || type === 'co2_high') facts.headcount = s.headcount
  if (type === 'empty_with_load' && ctx.autoOffSaving[room.id]) facts.monthlySavingCost = round(ctx.autoOffSaving[room.id], 0)
  if (type === 'underused') {
    facts.smallerRoomId = smallerRoomFor(room, s.headcount, rooms)?.id
    if (ctx.consolidateSaving[room.id]) facts.monthlySavingCost = round(ctx.consolidateSaving[room.id], 0)
  }
  return facts
}

export const ALERT_LABELS: Record<AlertType, string> = {
  empty_with_load: 'Empty room wasting power',
  over_capacity: 'Over capacity',
  co2_high: 'Indoor CO2 high',
  daylight_available: 'Daylight available',
  underused: 'Room underused',
  reported: 'Reported by a visitor',
  ac_mild_weather: 'AC on in mild weather',
  camera_offline: 'Camera offline',
  ac_overcooling: 'AC set too cold',
}
