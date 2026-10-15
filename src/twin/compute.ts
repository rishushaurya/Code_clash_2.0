// How a room's state is decided (docs/BUILD_SPEC.md section 5), as pure functions.
// The browser twin (store.ts) and the server's minute tick (api/_routes/tick.ts) both call computeRoom, so
// they never disagree. Nothing here reads the site store or a browser API: everything comes in as arguments.
// Relative imports with .js, so the server function can load this file on Vercel.

import { CO2_OUTDOOR_PPM, SENSOR_FRESH_MS, WASTE_MIN_W } from '../shared/config.js'
import type { CvReading, DeviceType, Room, RoomState, SensorReading, Site } from '../shared/types'
import { stepCo2 } from './co2.js'
import { mergeReadings } from './merge.js'

export const roomWatts = (room: Room, deviceOn: Record<string, boolean>) => room.devices.reduce((sum, d) => sum + (deviceOn[d.id] ? d.ratedW : 0), 0)

/** kWh = watts x seconds / 3,600,000 */
export const kwhFrom = (watts: number, seconds: number) => (watts * seconds) / 3_600_000

export const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits

export interface Observed {
  on: boolean
  ts: number
  source: string
}

/** Latest non-camera inputs of one room */
export interface SensorState {
  occupancy?: { value: number; ts: number }
  power?: { watts: number; ts: number }
  air?: { co2ppm?: number; temperatureC?: number; humidity?: number; ts: number }
  byId: Record<string, Observed>
  byType: Partial<Record<DeviceType, Observed>>
}

/** A sensor reading folded into what is known about the room; a newer value replaces an older one */
export function applySensor(prev: SensorState | undefined, r: SensorReading): SensorState {
  const next: SensorState = { ...prev, byId: { ...prev?.byId }, byType: { ...prev?.byType } }
  if (r.occupancy !== undefined) next.occupancy = { value: r.occupancy, ts: r.ts }
  if (r.powerW !== undefined) next.power = { watts: r.powerW, ts: r.ts }
  if (r.co2ppm !== undefined || r.temperatureC !== undefined || r.humidity !== undefined)
    next.air = {
      ...next.air,
      ...(r.co2ppm !== undefined && { co2ppm: r.co2ppm }),
      ...(r.temperatureC !== undefined && { temperatureC: r.temperatureC }),
      ...(r.humidity !== undefined && { humidity: r.humidity }),
      ts: r.ts,
    }
  for (const d of r.devices ?? []) {
    const obs = { on: d.on, ts: r.ts, source: r.source }
    if (d.id) next.byId[d.id] = obs
    else if (d.type) next.byType[d.type] = obs
  }
  return next
}

/** People are back: they switch things on again, so staff reports stop counting */
export const dropManual = (s: SensorState): SensorState => ({
  ...s,
  byId: Object.fromEntries(Object.entries(s.byId).filter(([, o]) => o.source !== 'manual')),
  byType: Object.fromEntries(Object.entries(s.byType).filter(([, o]) => o?.source !== 'manual')),
})

export function initialRoomState(room: Room, now: number): RoomState {
  return {
    roomId: room.id,
    headcount: 0,
    occupancyKnown: false,
    occupied: false,
    emptySince: null,
    deviceOn: {},
    watts: 0,
    metered: false,
    co2ppm: CO2_OUTDOOR_PPM,
    co2Measured: false,
    status: 'unknown',
    sources: [],
    zones: {},
    kwh: 0,
    cost: 0,
    co2Kg: 0,
    wasteCost: 0,
    updatedAt: now,
  }
}

export interface RoomInputs {
  /** Latest reading of each camera (other rooms' readings are ignored) */
  readings: CvReading[]
  sensor?: SensorState
  /** Camera readings older than this are ignored; the server, fed every 10 s, allows more than the live 6 s */
  cameraFreshMs?: number
}

export type SiteMoney = Pick<Site, 'tariffPerKwh' | 'gridKgPerKwh' | 'emptyDelayS'>

/** The room's next state after `dt` seconds. Energy, money and CO2 accumulate from `prev`. */
export function computeRoom(room: Room, prev: RoomState, inputs: RoomInputs, site: SiteMoney, now: number, dt: number): RoomState {
  const view = mergeReadings(room, inputs.readings, now, inputs.cameraFreshMs)
  const sensor = inputs.sensor
  const sources = new Set<RoomState['sources'][number]>()

  let headcount = 0
  let occupancyKnown = false
  if (view) {
    headcount = view.headcount
    occupancyKnown = true
    sources.add('camera')
  } else if (sensor?.occupancy && now - sensor.occupancy.ts < SENSOR_FRESH_MS) {
    headcount = sensor.occupancy.value
    occupancyKnown = true
    sources.add('sensor')
  }

  // Device states, most specific observation first: a report by device id (a sensor, or a person's manual
  // report), then the camera zone, then a report for every device of the type.
  const deviceOn: Record<string, boolean> = {}
  const deviceSource: NonNullable<RoomState['deviceSource']> = {}
  for (const d of room.devices) {
    const camera = view && d.zone ? view.zones[d.zone] : undefined
    const pick = sensor?.byId[d.id] ?? (camera !== undefined ? { on: camera, source: 'camera' } : sensor?.byType[d.type])
    if (!pick) continue
    deviceOn[d.id] = pick.on
    deviceSource[d.id] = pick.source === 'camera' ? 'camera' : pick.source === 'manual' ? 'manual' : 'sensor'
    sources.add(deviceSource[d.id] as 'camera' | 'sensor' | 'manual')
  }
  // In a watched room, a device nobody observes takes the state of the observed devices of its type (lights
  // usually share a switch): on when any of them is on. Labelled 'inferred'; any report by id overrides it.
  if (view) {
    for (const d of room.devices) {
      if (deviceOn[d.id] !== undefined) continue
      const seen = room.devices.filter((o) => o.type === d.type && deviceSource[o.id] !== undefined && deviceSource[o.id] !== 'inferred')
      if (!seen.length) continue
      deviceOn[d.id] = seen.some((o) => deviceOn[o.id])
      deviceSource[d.id] = 'inferred'
    }
  }

  const metered = Boolean(sensor?.power && now - sensor.power.ts < SENSOR_FRESH_MS)
  const watts = metered ? sensor!.power!.watts : roomWatts(room, deviceOn)
  const emptySince = !occupancyKnown || headcount > 0 ? null : (prev.emptySince ?? now)
  const occupied = occupancyKnown && (headcount > 0 || (emptySince !== null && now - emptySince < site.emptyDelayS * 1000))
  const status: RoomState['status'] = !occupancyKnown ? 'unknown' : occupied ? 'occupied' : watts > WASTE_MIN_W ? 'waste' : 'idle'

  const air = sensor?.air && now - sensor.air.ts < SENSOR_FRESH_MS ? sensor.air : undefined
  const kwh = kwhFrom(watts, dt)
  const cost = kwh * site.tariffPerKwh
  return {
    roomId: room.id,
    headcount,
    occupancyKnown,
    occupied,
    emptySince,
    deviceOn,
    watts,
    metered,
    co2ppm: air?.co2ppm ?? (occupancyKnown ? stepCo2(prev.co2ppm, headcount, room.volumeM3, dt) : prev.co2ppm),
    co2Measured: air?.co2ppm !== undefined,
    temperatureC: air?.temperatureC,
    humidity: air?.humidity,
    status,
    deviceSource,
    sources: [...sources],
    zones: view?.zones ?? {},
    kwh: prev.kwh + kwh,
    cost: prev.cost + cost,
    co2Kg: prev.co2Kg + kwh * site.gridKgPerKwh,
    wasteCost: prev.wasteCost + (status === 'waste' ? cost : 0),
    updatedAt: now,
  }
}

/**
 * Seconds left in the empty delay for a room counted as occupied with nobody seen, so the UI can say
 * "Emptying (n s)" instead of "Occupied, 0 people". Null when the room is not emptying.
 */
export function emptyingSeconds(s: RoomState, emptyDelayS: number, now: number): number | null {
  if (s.status !== 'occupied' || s.headcount > 0 || s.emptySince === null) return null
  return Math.max(0, Math.ceil(emptyDelayS - (now - s.emptySince) / 1000))
}
