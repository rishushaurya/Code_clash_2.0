// The whole loop in one test, on fake time: a camera sees people leave, the room turns to waste,
// an alert and an offline card appear, the switch-off is applied, the camera confirms, people return.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TICK_MS } from '@/shared/config'
import { getSite, setSite } from '@/shared/site'
import { testSite } from '@/test/fixture'
import type { CvReading } from '@/shared/types'
import { send } from './realtime'
import { useTwin } from './store'

const reading = (headcount: number, lights: boolean): CvReading => ({
  roomId: 'LH-1',
  cameraId: 'LH-1/test',
  sourceKind: 'webcam',
  ts: Date.now(),
  headcount,
  zones: { L1: lights, L2: lights },
  confidence: 0.9,
})

/** Feed the camera and run the twin for `ms`, one tick at a time */
async function run(ms: number, headcount: number, lights: boolean) {
  for (let t = 0; t < ms; t += TICK_MS) {
    useTwin.getState().ingestReading(reading(headcount, lights))
    await vi.advanceTimersByTimeAsync(TICK_MS)
  }
}

const lh1 = () => useTwin.getState().rooms['LH-1']

beforeAll(() => {
  setSite({ ...testSite, emptyDelayS: 20 })
  vi.useFakeTimers({ now: new Date('2000-01-03T10:00:00Z') })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))) // AI and weather offline: templates take over
  useTwin.getState().start()
})
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('twin loop', () => {
  it('follows the camera while people are in the room', async () => {
    await run(4000, 12, true)
    expect(lh1()).toMatchObject({ sources: ['camera'], headcount: 12, status: 'occupied', occupancyKnown: true })
    expect(lh1().watts).toBeGreaterThan(0)
  })

  it('keeps an empty room occupied for the empty delay, then flags waste with an offline card', async () => {
    await run((getSite().emptyDelayS - 6) * 1000, 0, true)
    expect(lh1().status).toBe('occupied')
    await run(10_000, 0, true)
    expect(lh1().status).toBe('waste')

    const alert = useTwin.getState().alerts.find((a) => a.roomId === 'LH-1' && a.type === 'empty_with_load')!
    expect(alert.facts.wattsNow).toBe(lh1().watts)
    const rec = useTwin.getState().recs[alert.id]
    expect(rec).toMatchObject({ source: 'template', command: { roomId: 'LH-1', target: 'all' } })
  })

  it('switches off, waits for the camera, and records the saving', async () => {
    await useTwin.getState().switchOff('LH-1', 'all')
    const [ack] = Object.values(useTwin.getState().acks)
    expect(ack).toMatchObject({ roomId: 'LH-1', relay: 'none', verifiedBy: null })
    expect(useTwin.getState().overrides['LH-1']).toBeDefined()

    await run(4000, 0, false)
    expect(useTwin.getState().acks[ack.commandId].verifiedBy).toBe('camera')
    expect(lh1()).toMatchObject({ status: 'idle', watts: 0 })
    expect(useTwin.getState().savedCost).toBeGreaterThan(0)
  })

  it('releases the hold when people come back', async () => {
    await run(4000, 5, true)
    expect(useTwin.getState().overrides['LH-1']).toBeUndefined()
    expect(lh1().status).toBe('occupied')
  })

  it('shows rooms nobody watches as unknown and draws nothing for them', () => {
    const s = useTwin.getState()
    expect(s.history.length).toBeGreaterThan(2)
    expect(s.rooms['LH-2']).toMatchObject({ status: 'unknown', occupancyKnown: false, watts: 0, sources: [] })
    expect(Object.keys(s.rooms)).toHaveLength(testSite.rooms.length)
  })

  it('takes occupancy, device states and metered power from a sensor', async () => {
    useTwin.getState().ingestSensor({ roomId: 'CR-001', source: 'home-assistant', ts: Date.now(), occupancy: 0, devices: [{ type: 'light', on: true }], powerW: 240 })
    await vi.advanceTimersByTimeAsync(25_000)
    expect(useTwin.getState().rooms['CR-001']).toMatchObject({ occupancyKnown: true, metered: true, watts: 240, status: 'waste', sources: ['sensor'] })
  })

  it('accepts a staff report as confirmation of a switch-off', async () => {
    await useTwin.getState().switchOff('CR-001', 'lights')
    const id = useTwin.getState().overrides['CR-001'].commandId
    useTwin.getState().ingestSensor({ roomId: 'CR-001', source: 'home-assistant', ts: Date.now(), occupancy: 0 }) // keep occupancy live, drop the meter
    useTwin.setState((s) => ({ sensors: { ...s.sensors, 'CR-001': { ...s.sensors['CR-001'], power: undefined } } }))
    useTwin.getState().reportDevices('CR-001', 'lights', false)
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)
    expect(useTwin.getState().acks[id].verifiedBy).toBe('manual')
  })

  it('turns a visitor report into a check, without touching device states', async () => {
    const before = useTwin.getState().rooms['LH-2']
    // A tip arrives on the workspace channel (the server relays it from the public view).
    send('tip', { roomId: 'LH-2', ts: Date.now() })
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)
    expect(useTwin.getState().alerts.some((a) => a.roomId === 'LH-2' && a.type === 'reported')).toBe(true)
    expect(useTwin.getState().rooms['LH-2'].deviceOn).toEqual(before.deviceOn)
  })

  it('raises camera offline when a camera falls silent, and clears it when it returns', async () => {
    await run(4000, 3, true)
    await vi.advanceTimersByTimeAsync(70_000)
    const alert = useTwin.getState().alerts.find((a) => a.roomId === 'LH-1' && a.type === 'camera_offline')
    expect(alert?.facts.minutesSinceCamera).toBe(1)
    expect(useTwin.getState().rooms['LH-1'].status).toBe('unknown')
    await run(4000, 3, true)
    expect(useTwin.getState().alerts.some((a) => a.roomId === 'LH-1' && a.type === 'camera_offline')).toBe(false)
  })

  it('switches off by itself when auto-off is on, once, after the set minutes', async () => {
    setSite({ ...getSite(), autoOff: { enabled: true, minutes: 1 } })
    await run(4000, 4, true) // people present: nothing to do
    expect(useTwin.getState().events.some((e) => e.roomId === 'LH-1' && e.text.includes('(policy)'))).toBe(false)
    await run(getSite().emptyDelayS * 1000 + 64_000, 0, true) // empty with lights on past the delay plus one minute
    const policy = useTwin.getState().events.filter((e) => e.roomId === 'LH-1' && e.kind === 'command' && e.text.includes('(policy)'))
    expect(policy).toHaveLength(1)
    await run(10_000, 0, true) // still on (nothing switched it): no second command while the first waits
    expect(useTwin.getState().events.filter((e) => e.roomId === 'LH-1' && e.text.includes('(policy)'))).toHaveLength(1)
    setSite({ ...getSite(), autoOff: { enabled: false, minutes: 10 } })
  })

  it('never auto-switches a room marked as exempt', async () => {
    await run(4000, 2, true) // people back: hold released
    setSite({ ...getSite(), autoOff: { enabled: true, minutes: 1 }, rooms: getSite().rooms.map((r) => (r.id === 'LH-1' ? { ...r, autoOffExempt: true } : r)) })
    const before = useTwin.getState().events.filter((e) => e.text.includes('(policy)')).length
    await run(getSite().emptyDelayS * 1000 + 70_000, 0, true)
    expect(useTwin.getState().events.filter((e) => e.text.includes('(policy)')).length).toBe(before)
    setSite({ ...testSite, emptyDelayS: 20 })
  })

  it('uses a room air sensor instead of the head-count estimate', async () => {
    useTwin.getState().ingestSensor({ roomId: 'OFF-1', source: 'airthings', ts: Date.now(), occupancy: 2, co2ppm: 1180, temperatureC: 26.5, humidity: 61 })
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)
    const off = useTwin.getState().rooms['OFF-1']
    expect(off).toMatchObject({ co2ppm: 1180, co2Measured: true, temperatureC: 26.5, humidity: 61 })
    expect(useTwin.getState().alerts.some((a) => a.roomId === 'OFF-1' && a.type === 'co2_high' && a.facts.co2ppm === 1180)).toBe(true)
  })

  it('records measured CO2 in the history the report reads, also for a room with no occupancy input (A5)', async () => {
    useTwin.getState().ingestSensor({ roomId: 'LAB-1', source: 'airthings', ts: Date.now(), co2ppm: 1250 })
    await vi.advanceTimersByTimeAsync(TICK_MS * 2)
    expect(useTwin.getState().rooms['LAB-1']).toMatchObject({ occupancyKnown: false, co2Measured: true })
    expect(useTwin.getState().co2History['LAB-1']?.at(-1)).toBe(1250)
  })
})
