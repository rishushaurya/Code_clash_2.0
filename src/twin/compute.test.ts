// The pure room maths shared by the browser twin and the server tick.

import { describe, expect, it } from 'vitest'
import type { CvReading, Room } from '../shared/types'
import { applySensor, computeRoom, dropManual, emptyingSeconds, initialRoomState } from './compute'

const room: Room = {
  id: 'LH-1',
  name: 'Lecture Hall 1',
  floor: 0,
  type: 'lecture_hall',
  capacity: 100,
  areaM2: 100,
  volumeM3: 300,
  windowSide: false,
  devices: [
    { id: 'l1', type: 'light', ratedW: 20, zone: 'L1', brickClass: 'Luminaire' },
    { id: 'l2', type: 'light', ratedW: 20, zone: 'L2', brickClass: 'Luminaire' },
    { id: 'l3', type: 'light', ratedW: 20, brickClass: 'Luminaire' },
    { id: 'l4', type: 'light', ratedW: 20, brickClass: 'Luminaire' },
    { id: 'f1', type: 'fan', ratedW: 75, brickClass: 'Fan' },
  ],
}
const site = { tariffPerKwh: 10, gridKgPerKwh: 0.7, emptyDelayS: 300 }
const now = 1_000_000_000
const cam = (headcount: number, zones: Record<string, boolean>, ts = now): CvReading => ({ roomId: 'LH-1', cameraId: 'LH-1/cam-1', sourceKind: 'webcam', ts, headcount, zones, confidence: 0.9 })

describe('computeRoom', () => {
  it('infers unseen devices of a watched room from the seen ones of the same type, and leaves other types alone', () => {
    const s = computeRoom(room, initialRoomState(room, now), { readings: [cam(3, { L1: true, L2: false })] }, site, now, 2)
    expect(s.deviceOn).toEqual({ l1: true, l2: false, l3: true, l4: true })
    expect(s.deviceSource).toEqual({ l1: 'camera', l2: 'camera', l3: 'inferred', l4: 'inferred' })
    expect(s.watts).toBe(60)
  })

  it('lets a manual report by device id override an inferred state', () => {
    const sensor = applySensor(undefined, { roomId: 'LH-1', source: 'manual', ts: now, devices: [{ id: 'l4', on: false }] })
    const s = computeRoom(room, initialRoomState(room, now), { readings: [cam(3, { L1: true })], sensor }, site, now, 2)
    expect(s.deviceOn.l4).toBe(false)
    expect(s.deviceSource?.l4).toBe('manual')
    expect(s.deviceSource?.l3).toBe('inferred')
    expect(dropManual(sensor).byId).toEqual({})
  })

  it('infers nothing in a room no camera watches', () => {
    const sensor = applySensor(undefined, { roomId: 'LH-1', source: 'shelly', ts: now, occupancy: 0, devices: [{ id: 'l1', on: true }] })
    const s = computeRoom(room, initialRoomState(room, now), { readings: [], sensor }, site, now, 2)
    expect(s.deviceOn).toEqual({ l1: true })
  })

  it('accepts older camera readings when the caller allows it (the server, fed every 10 s)', () => {
    const old = cam(2, {}, now - 20_000)
    expect(computeRoom(room, initialRoomState(room, now), { readings: [old] }, site, now, 60).occupancyKnown).toBe(false)
    expect(computeRoom(room, initialRoomState(room, now), { readings: [old], cameraFreshMs: 30_000 }, site, now, 60).occupancyKnown).toBe(true)
  })

  it('accumulates energy and money from the site settings passed in', () => {
    const s = computeRoom(room, initialRoomState(room, now), { readings: [cam(0, { L1: true, L2: true })] }, site, now, 3600)
    expect(s.kwh).toBeCloseTo(0.08)
    expect(s.cost).toBeCloseTo(0.8)
    expect(s.co2Kg).toBeCloseTo(0.056)
  })

  it('takes measured CO2 over the head-count estimate', () => {
    const sensor = applySensor(undefined, { roomId: 'LH-1', source: 'air', ts: now, co2ppm: 1250 })
    const s = computeRoom(room, initialRoomState(room, now), { readings: [], sensor }, site, now, 2)
    expect(s).toMatchObject({ co2ppm: 1250, co2Measured: true, occupancyKnown: false })
  })
})

describe('emptyingSeconds (T1)', () => {
  it('counts down the empty delay only for an occupied room with nobody seen', () => {
    const prev = initialRoomState(room, now)
    const full = computeRoom(room, prev, { readings: [cam(5, {})] }, site, now, 2)
    expect(emptyingSeconds(full, site.emptyDelayS, now)).toBeNull()
    const leaving = computeRoom(room, full, { readings: [cam(0, {}, now + 10_000)] }, site, now + 10_000, 2)
    expect(leaving.status).toBe('occupied')
    expect(emptyingSeconds(leaving, site.emptyDelayS, now + 70_000)).toBe(240)
    const gone = computeRoom(room, leaving, { readings: [cam(0, {}, now + 400_000)] }, site, now + 400_000, 2)
    expect(gone.status).toBe('idle')
    expect(emptyingSeconds(gone, site.emptyDelayS, now + 400_000)).toBeNull()
  })
})
