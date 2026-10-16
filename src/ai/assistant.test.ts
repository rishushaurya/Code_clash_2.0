// The Assistant's ten scripted questions (PLAN.md section 7), answered with the AI off: keyword routing picks
// the tool, the tool runs on the twin's state, code writes the answer. Plus the setup proposals and A5/A6.

import { beforeAll, describe, expect, it } from 'vitest'
import { getSite, setSite } from '@/shared/site'
import type { RoomState } from '@/shared/types'
import { testSite } from '@/test/fixture'
import { useTwin } from '@/twin/store'
import { propose } from './proposals'
import { guessTool, indoorAir, liveSummary, OFF_TOPIC, runTool, templateAnswer } from './tools'

const state = (roomId: string, s: Partial<RoomState>): RoomState => ({
  roomId,
  headcount: 0,
  occupancyKnown: false,
  occupied: false,
  emptySince: null,
  deviceOn: {},
  watts: 0,
  metered: false,
  co2ppm: 420,
  co2Measured: false,
  status: 'unknown',
  sources: [],
  zones: {},
  kwh: 0,
  cost: 0,
  co2Kg: 0,
  wasteCost: 0,
  updatedAt: 0,
  ...s,
})

beforeAll(() => {
  setSite(testSite)
  useTwin.setState({
    rooms: {
      'LH-1': state('LH-1', { headcount: 42, occupancyKnown: true, occupied: true, status: 'occupied', watts: 1460, sources: ['camera'] }),
      'LH-2': state('LH-2', { occupancyKnown: true, status: 'waste', watts: 2400, metered: true, sources: ['sensor'], wasteCost: 12.5 }),
      'CR-001': state('CR-001', { occupancyKnown: true, status: 'idle', watts: 0, sources: ['manual'] }),
      'LAB-1': state('LAB-1', {}),
      'OFF-1': state('OFF-1', {}),
    },
  })
})

const ask = (q: string) => {
  const tool = guessTool(q)
  const result = runTool(tool)
  return { tool, result: result as Record<string, unknown>, answer: tool.tool === 'none' ? OFF_TOPIC : templateAnswer(tool, result, q) }
}

describe('the ten scripted Assistant questions', () => {
  it('1. which room uses the most power: every watched room, highest first (A6)', () => {
    const { tool, answer } = ask('Which room uses the most power right now?')
    expect(tool.tool).toBe('liveSummary')
    expect(liveSummary().byPower.map((r) => r.roomId)).toEqual(['LH-2', 'LH-1', 'CR-001'])
    expect(liveSummary().notWatched).toEqual(['LAB-1', 'OFF-1'])
    expect(answer).toContain('LH-2 2400 W (waste, 0 people); LH-1 1460 W (occupied, 42 people)')
  })

  it('2. the state of one room', () => {
    const { tool, answer } = ask('How is LH-1 doing?')
    expect(tool).toEqual({ tool: 'getRoom', roomId: 'LH-1' })
    expect(answer).toBe('LH-1 is occupied with 42 people, drawing 1460 W.')
  })

  it('3. a what-if, labelled modelled', () => {
    const { tool, result, answer } = ask('What would auto-off save in a month?')
    expect(tool).toMatchObject({ tool: 'runScenario', policy: 'auto_off' })
    expect(result.modelled).toBe(true)
    expect(answer).toMatch(/^Modelled over \d+ runs/)
  })

  it('4. where a number comes from: metered power', () => {
    const { tool, result } = ask('Where does the power figure for LH-2 come from?')
    expect(tool).toEqual({ tool: 'explainMetric', metric: 'power', roomId: 'LH-2' })
    expect(result).toMatchObject({ wattsNow: 2400, source: 'a meter or smart plug', inputs: 'a sensor or smart plug' })
  })

  it('5. how to connect a room with no inputs', () => {
    const { tool, result } = ask('How do I connect OFF-1?')
    expect(tool).toEqual({ tool: 'connectionGuide', roomId: 'OFF-1' })
    expect(result.roomsWithNoInput).toEqual(['LAB-1', 'OFF-1'])
    expect((result.methods as { name: string }[]).map((m) => m.name)).toEqual(['Camera on this device or a phone', 'Sensor API', 'Smart plug or meter'])
  })

  it('6. teach EPI with this building’s own modelled number', () => {
    const { tool, result } = ask('What is EPI?')
    expect(tool).toEqual({ tool: 'teach', topic: 'epi' })
    expect(result.thisBuildingModelledKwhPerM2Year).toBeGreaterThan(0)
  })

  it('7. teach BEE: 24 °C and about 6 % per degree', () => {
    const { result } = ask('Explain BEE to me')
    expect(result).toMatchObject({ acDefaultC: 24, savingPercentPerDegree: 6 })
  })

  it('8. which rooms are wasting power', () => {
    const { tool, answer } = ask('Which rooms are wasting power?')
    expect(tool.tool).toBe('topWasters')
    expect(answer).toBe('Right now LH-2 wastes 2400 W.')
  })

  it('9. camera coverage of a room', () => {
    const { tool, answer } = ask('What is the camera coverage in LH-1?')
    expect(tool).toEqual({ tool: 'coverage', roomId: 'LH-1' })
    expect(answer).toBe('LH-1: no camera.')
  })

  it('10. an off-topic question is declined with what it can help with', () => {
    const { tool, answer } = ask('Who won the cricket match yesterday?')
    expect(tool.tool).toBe('none')
    expect(answer).toBe(OFF_TOPIC)
  })
})

describe('knowledge: this workspace and the app guide', () => {
  it('answers a how-to with the exact steps, offline', () => {
    const { tool, answer } = ask('How do I invite a teammate as a viewer?')
    expect(tool.tool).toBe('knowledge')
    expect(answer.startsWith('Team, roles and devices (/settings/team):\n1. ')).toBe(true)
    expect(answer).toContain('Create link')
  })

  it('gives the AI the real setup: rooms, devices, cameras and the guide', () => {
    const { result } = ask('Guide me through what is set up here')
    const snap = result as unknown as { totals: { rooms: number }; rooms: { roomId: string; devices: Record<string, number> }[]; appGuide: unknown[] }
    expect(snap.totals.rooms).toBe(getSite().rooms.length)
    expect(snap.rooms.find((r) => r.roomId === 'LH-1')?.devices.light).toBe(getSite().rooms.find((r) => r.id === 'LH-1')!.devices.filter((d) => d.type === 'light').length)
    expect(snap.appGuide.length).toBeGreaterThan(5)
  })
})

describe('setup proposals: a diff, never saved by the Assistant', () => {
  it('changes a device count and keeps existing devices', () => {
    const before = getSite()
    const p = propose(before, { kind: 'setDeviceCount', roomId: 'LH-1', device: 'light', count: 18 })
    if (typeof p === 'string') throw new Error(p)
    expect(p.rows).toEqual([{ label: 'LH-1 lights', before: '16', after: '18' }])
    const lh1 = p.next.rooms.find((r) => r.id === 'LH-1')!
    expect(lh1.devices.filter((d) => d.type === 'light')).toHaveLength(18)
    expect(lh1.devices.find((d) => d.id === 'LH-1/light-01')).toBe(before.rooms[0].devices.find((d) => d.id === 'LH-1/light-01'))
    // Proposing changed nothing.
    expect(getSite()).toBe(before)
  })

  it('sets hours, auto-off and adds a room', () => {
    const hours = propose(getSite(), { kind: 'setHours', from: 8, to: 18 })
    expect(typeof hours !== 'string' && hours.next.hours).toEqual({ from: 8, to: 18, days: getSite().hours.days })
    const auto = propose(getSite(), { kind: 'setAutoOff', enabled: true, minutes: 10 })
    expect(typeof auto !== 'string' && auto.rows[0].after).toBe('On, after 10 empty minutes')
    const add = propose(getSite(), { kind: 'addRoom', id: 'CR-002', name: 'Classroom 2', floor: 2, type: 'classroom', capacity: 45 })
    if (typeof add === 'string') throw new Error(add)
    expect(add.next.rooms.at(-1)).toMatchObject({ id: 'CR-002', floor: 2, capacity: 45 })
    expect(add.next.floors.map((f) => f.level)).toContain(2)
  })

  it('refuses changes that do not fit the site', () => {
    expect(propose(getSite(), { kind: 'setCapacity', roomId: 'XX-9', capacity: 10 })).toBe('There is no room XX-9 in this building.')
    expect(propose(getSite(), { kind: 'setHours', from: 18, to: 8 })).toMatch(/closing comes after opening/)
    expect(propose(getSite(), { kind: 'addRoom', id: 'LH-1', name: 'Dup' })).toBe('LH-1 already exists.')
    expect(propose(getSite(), { kind: 'setDeviceCount', roomId: 'LH-1', device: 'light', count: 16 })).toBe('LH-1 already has 16 lights.')
    // A plan from the AI may miss a field.
    expect(propose(getSite(), { kind: 'renameRoom' } as never)).toBe('Which room should change?')
  })
})

describe('A5: measured CO2 reaches the report facts', () => {
  it('keeps a sensor reading even when the live history is empty', () => {
    const air = indoorAir({ co2History: { 'LH-1': [600, 820] }, sensors: { 'LH-2': { air: { co2ppm: 1250, ts: 1 }, byId: {}, byType: {} } } })
    expect(air).toEqual([
      { roomId: 'LH-2', peakPpm: 1250, measured: true },
      { roomId: 'LH-1', peakPpm: 820, measured: false },
    ])
  })
})
