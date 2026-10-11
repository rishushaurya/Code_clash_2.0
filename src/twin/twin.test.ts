import { describe, expect, it, vi } from 'vitest'
import { getRoom } from '@/shared/site'
import { loadTestSite } from '@/test/fixture'
import type { CvReading, Room } from '@/shared/types'
import { steadyCo2, stepCo2 } from './co2'
import { wasteOverPeriod } from './energy'
import { mergeReadings } from './merge'

// A signed-in server workspace, so the site sync talks to the (mocked) server.
vi.mock('@/shared/workspace', async (original) => ({ ...(await original<typeof import('@/shared/workspace')>()), online: () => true, authHeaders: () => ({ authorization: 'Bearer t' }) }))

loadTestSite()

describe('energy', () => {
  it('matches the worked example at the Indian preset tariff', () => {
    // 650 W left on 3 hours a day for 22 working days
    const w = wasteOverPeriod(650, 3, 22)
    expect(w.kwh).toBeCloseTo(42.9, 5)
    expect(w.cost).toBeCloseTo(374.52, 2)
    expect(w.co2Kg).toBeCloseTo(31.19, 2)
  })
})

describe('indoor CO2', () => {
  it('rises with people and settles at the steady state', () => {
    const room = getRoom('CR-001')!
    let c = 420
    for (let t = 0; t < 6 * 3600; t += 60) c = stepCo2(c, 50, room.volumeM3, 60)
    expect(c).toBeGreaterThan(1000)
    expect(c).toBeCloseTo(steadyCo2(50, room.volumeM3), -1)
  })

  it('never drops below outdoor air', () => {
    expect(stepCo2(420, 0, 300, 60)).toBe(420)
  })
})

describe('camera merge', () => {
  const room = getRoom('LH-1')!
  const now = 1_000_000
  const reading = (cameraId: string, headcount: number, zones: Record<string, boolean>, age = 0): CvReading => ({
    roomId: 'LH-1',
    cameraId,
    sourceKind: 'webcam',
    ts: now - age,
    headcount,
    zones,
    confidence: 0.8,
  })

  it('never double-counts overlapping cameras', () => {
    const v = mergeReadings(room, [reading('a', 12, { L1: true }), reading('b', 10, { L2: false })], now)!
    expect(v.headcount).toBe(12)
    expect(v.zones).toEqual({ L1: true, L2: false })
  })

  it('adds cameras that split a room', () => {
    const split: Room = { ...room, cameraMerge: 'sum' }
    expect(mergeReadings(split, [reading('a', 12, {}), reading('b', 10, {})], now)!.headcount).toBe(22)
  })

  it('ignores stale cameras', () => {
    expect(mergeReadings(room, [reading('a', 5, {}, 60_000)], now)).toBeNull()
  })
})

describe('recorded utilization and left-on share', () => {
  it('summarises only observed rooms and learns how often empty rooms stay on', async () => {
    const { recordUsage, readUsage, observedLeftOnShare, clearUsage } = await import('./usage')
    const { getSite } = await import('@/shared/site')
    clearUsage()
    const rooms = getSite().rooms
    const base = { occupancyKnown: true, metered: false, deviceOn: { 'LH-1/light-01': true }, emptySince: null, co2ppm: 420, co2Measured: false, sources: [], zones: {}, kwh: 0, cost: 0, co2Kg: 0, wasteCost: 0, updatedAt: 0, watts: 20 }
    const t = new Date('2000-01-03T10:00:00').getTime() // a Monday, 10:00
    for (let i = 0; i < 900; i++) {
      const empty = i % 3 === 0
      recordUsage([{ ...base, roomId: 'LH-1', headcount: empty ? 0 : 60, occupied: !empty, status: empty ? (i % 2 ? 'waste' : 'idle') : 'occupied' }], rooms, t)
    }
    expect(observedLeftOnShare()).toBeNull() // 300 empty samples = 10 minutes, not enough yet
    for (let i = 0; i < 600; i++) recordUsage([{ ...base, roomId: 'LH-1', headcount: 0, occupied: false, status: 'waste' }], rooms, t)
    const learned = observedLeftOnShare()!
    expect(learned.share).toBeCloseTo(750 / 900, 2)
    const [lh1] = readUsage(rooms)
    expect(lh1.roomId).toBe('LH-1')
    expect(lh1.hourly[10]).toBeGreaterThan(0)
    expect(lh1.hourly[11]).toBeNull()
    expect(readUsage(rooms)).toHaveLength(1) // rooms never observed are absent, not zero
  })
})

describe('site sync', () => {
  it('pulls the server copy, but pushes a local edit that never reached the server', async () => {
    const { getSite, setSite, syncSiteFromServer } = await import('@/shared/site')
    const { testSite } = await import('@/test/fixture')
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    const server = { ...testSite, buildingName: 'From server' }
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? new Response('{}') : new Response(JSON.stringify({ site: server }))),
    )
    vi.stubGlobal('fetch', fetchMock)

    await syncSiteFromServer()
    expect(getSite().buildingName).toBe('From server')

    setSite({ ...testSite, buildingName: 'Edited offline' })
    store.set('pratibimb:site-unsynced:none', '1')
    await syncSiteFromServer()
    expect(getSite().buildingName).toBe('Edited offline')
    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: 'PUT', headers: { authorization: 'Bearer t' } })
    expect(store.has('pratibimb:site-unsynced:none')).toBe(false)
    vi.unstubAllGlobals()
    setSite(testSite)
  })
})

describe('set up with AI', () => {
  it('builds rooms from the draft, keeps existing devices, and lists what it assumed', async () => {
    const { applySetupDraft } = await import('@/shared/site')
    const { testSite } = await import('@/test/fixture')
    const lh1 = testSite.rooms.find((r) => r.id === 'LH-1')!
    const { site, assumed } = applySetupDraft(testSite, {
      buildingName: 'Main Block',
      tariffPerKwh: 9.1,
      currency: 'inr',
      rooms: [
        { id: 'LH-1', name: 'Lecture Hall One', floor: 0, type: 'lecture_hall', fans: 4 },
        { id: 'MR-1', name: 'Board room', floor: 3, type: 'meeting', lights: 6 },
      ],
    })
    expect(site).toMatchObject({ buildingName: 'Main Block', tariffPerKwh: 9.1, currency: testSite.currency })
    const one = site.rooms.find((r) => r.id === 'LH-1')!
    expect(one.name).toBe('Lecture Hall One')
    expect(one.devices.filter((d) => d.type === 'fan')).toHaveLength(4)
    expect(one.devices.filter((d) => d.type === 'light')).toEqual(lh1.devices.filter((d) => d.type === 'light'))
    const mr = site.rooms.find((r) => r.id === 'MR-1')!
    expect(mr.devices.map((d) => d.type)).toEqual(Array(6).fill('light'))
    expect(site.floors.map((f) => f.level)).toEqual([0, 1, 3])
    expect(assumed).toEqual(['MR-1 seats (12, from the meeting room template)', 'MR-1 area (25 m², from the template)'])
  })
})

describe('spoken setup', () => {
  it('turns Devanagari and Kannada digits into 0-9, so spoken numbers pass the server check', async () => {
    const { asciiDigits } = await import('@/ui/components/AiSetup')
    expect(asciiDigits('१६ lights, ೧೨೦ seats, 8 fans, ०')).toBe('16 lights, 120 seats, 8 fans, 0')
  })
})

describe('cooling advice', () => {
  it('flags ACs in an occupied room only when the outside is at or below 24 C', async () => {
    const { alertTypesFor } = await import('./rules')
    const room = getRoom('LH-1')!
    const ac = room.devices.find((d) => d.type === 'ac')!
    const state = { roomId: 'LH-1', headcount: 30, occupancyKnown: true, occupied: true, emptySince: null, deviceOn: { [ac.id]: true }, watts: 1500, metered: false, co2ppm: 600, co2Measured: false, status: 'occupied' as const, sources: ['camera' as const], zones: {}, kwh: 0, cost: 0, co2Kg: 0, wasteCost: 0, updatedAt: 0 }
    const ctx = { now: 0, minuteOfDay: 8 * 60, currency: 'INR', cloudCover: 90, autoOffSaving: {}, consolidateSaving: {} }
    expect(alertTypesFor(room, state, { ...ctx, outdoorTempC: 21 })).toContain('ac_mild_weather')
    expect(alertTypesFor(room, state, { ...ctx, outdoorTempC: 31 })).not.toContain('ac_mild_weather')
    expect(alertTypesFor(room, state, { ...ctx, outdoorTempC: null })).not.toContain('ac_mild_weather')
    expect(alertTypesFor(room, { ...state, deviceOn: {} }, { ...ctx, outdoorTempC: 21 })).not.toContain('ac_mild_weather')
  })
})

describe('observed opening hours', () => {
  it('reads the busy days and hours from what cameras and sensors saw', async () => {
    const { recordUsage, observedOpenHours, clearUsage } = await import('./usage')
    const { getSite } = await import('@/shared/site')
    clearUsage()
    const rooms = getSite().rooms
    const base = { roomId: 'LH-1', occupancyKnown: true, metered: false, deviceOn: {}, emptySince: null, co2ppm: 420, co2Measured: false, sources: [], zones: {}, kwh: 0, cost: 0, co2Kg: 0, wasteCost: 0, updatedAt: 0, watts: 0 }
    expect(observedOpenHours()).toBeNull()
    // Tuesday and Thursday, people from 8:00 to 15:59; empty at 20:00
    for (const day of [4, 6]) {
      for (let hour = 8; hour < 16; hour++) {
        const t = new Date(2000, 0, day, hour, 30).getTime() // Jan 4 2000 was a Tuesday
        for (let i = 0; i < 1800; i++) recordUsage([{ ...base, headcount: 20, occupied: true, status: 'occupied' }], rooms, t)
      }
      const night = new Date(2000, 0, day, 20, 0).getTime()
      for (let i = 0; i < 1800; i++) recordUsage([{ ...base, headcount: 0, occupied: false, status: 'idle' }], rooms, night)
    }
    expect(observedOpenHours()).toEqual({ from: 8, to: 16, days: [1, 3] })
    clearUsage()
  })
})

describe('waste patterns', () => {
  it('finds the room-hours where empty rooms are most often left on', async () => {
    const { recordUsage, wastePatterns, clearUsage } = await import('./usage')
    const { getSite } = await import('@/shared/site')
    clearUsage()
    const rooms = getSite().rooms
    const base = { occupancyKnown: true, metered: false, deviceOn: { x: true }, emptySince: null, co2ppm: 420, co2Measured: false, sources: [], zones: {}, kwh: 0, cost: 0, co2Kg: 0, wasteCost: 0, updatedAt: 0, watts: 300, headcount: 0, occupied: false }
    const friday16 = new Date(2000, 0, 7, 16, 10).getTime() // Jan 7 2000 was a Friday
    const monday10 = new Date(2000, 0, 3, 10, 10).getTime()
    for (let i = 0; i < 900; i++) recordUsage([{ ...base, roomId: 'LH-1', status: i % 10 ? 'waste' : 'idle' }], rooms, friday16)
    for (let i = 0; i < 900; i++) recordUsage([{ ...base, roomId: 'CR-001', status: i % 2 ? 'waste' : 'idle' }], rooms, monday10)
    for (let i = 0; i < 100; i++) recordUsage([{ ...base, roomId: 'LH-2', status: 'waste' }], rooms, monday10) // too little to count
    const [top, second, ...rest] = wastePatterns()
    expect(top).toMatchObject({ roomId: 'LH-1', weekday: 4, hour: 16 })
    expect(top.share).toBeCloseTo(0.9, 2)
    expect(second).toMatchObject({ roomId: 'CR-001', weekday: 0, hour: 10 })
    expect(rest).toHaveLength(0)
    clearUsage()
  })
})

describe('overcooling advice', () => {
  it('flags ACs cooling a room well below 24 C and computes the saving share in code', async () => {
    const { alertTypesFor, factsFor } = await import('./rules')
    const room = getRoom('LH-1')!
    const ac = room.devices.find((d) => d.type === 'ac')!
    const state = { roomId: 'LH-1', headcount: 30, occupancyKnown: true, occupied: true, emptySince: null, deviceOn: { [ac.id]: true }, watts: 1500, metered: false, co2ppm: 600, co2Measured: false, temperatureC: 20, status: 'occupied' as const, sources: ['sensor' as const], zones: {}, kwh: 0, cost: 0, co2Kg: 0, wasteCost: 0, updatedAt: 0 }
    const ctx = { now: 0, minuteOfDay: 8 * 60, currency: 'INR', cloudCover: 90, autoOffSaving: {}, consolidateSaving: {} }
    expect(alertTypesFor(room, state, ctx)).toContain('ac_overcooling')
    expect(factsFor(room, state, 'ac_overcooling', ctx, [room])).toMatchObject({ indoorTempC: 20, acSavingPercent: 24 }) // BEE: 20 to 24 C saves about 24 %
    expect(alertTypesFor(room, { ...state, temperatureC: 23.5 }, ctx)).not.toContain('ac_overcooling')
    expect(alertTypesFor(room, { ...state, deviceOn: {} }, ctx)).not.toContain('ac_overcooling')
  })
})
