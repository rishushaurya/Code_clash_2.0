// Tools the Copilot can run, executed here in the browser on the real twin and engine.
// Also builds the facts pack for the sustainability report. Every number is computed and rounded here.

import { DEFAULT_RUNS } from '@/shared/config'
import { getRoom, getSite } from '@/shared/site'
import type { PolicyId, Range, ScenarioComparison } from '@/shared/types'
import { compareScenario, epi, POLICY_LABELS } from '@/sim/engine'
import { costPerHour, formatMoney, round } from '@/twin/energy'
import { useTwin } from '@/twin/store'
import { readUsage, wastePatterns } from '@/twin/usage'
import { patternFacts, templatePatterns } from './patterns'
import type { AuditTrail, CopilotTool } from './client'

export interface SolarFacts {
  kWp: number
  sunKwhPerM2Day: number
  yearKwh: number
  yearCost: number
  yearCo2Tonnes: number
}

const r = (x: Range, d = 0) => ({ p10: round(x.p10, d), p50: round(x.p50, d), p90: round(x.p90, d) })

export const scenarioFacts = (c: ScenarioComparison) => ({
  policy: POLICY_LABELS[c.policy.policy],
  modelled: true,
  currency: getSite().currency,
  days: c.policy.days,
  runs: DEFAULT_RUNS,
  baselineWeekKwh: r(c.baseline.kwh),
  monthlySavingCost: r(c.monthly.cost),
  monthlySavingKwh: r(c.monthly.kwh),
  monthlySavingCo2Kg: r(c.monthly.co2Kg),
})

export function runTool(t: CopilotTool) {
  const s = useTwin.getState()
  if (t.tool === 'runScenario') {
    const c = compareScenario({ policy: t.policy, params: { emptyMinutes: t.emptyMinutes ?? 5 }, days: 7, runs: DEFAULT_RUNS, seed: 42 }, getSite().rooms)
    return { ...scenarioFacts(c), emptyMinutes: t.policy === 'auto_off' || t.policy === 'combined' ? (t.emptyMinutes ?? 5) : undefined }
  }
  if (t.tool === 'topWasters') {
    return {
      wastingRooms: Object.values(s.rooms)
        .filter((x) => x.status === 'waste')
        .sort((a, b) => b.watts - a.watts)
        .slice(0, 5)
        .map((x) => ({ roomId: x.roomId, watts: round(x.watts, 0), costPerHour: round(costPerHour(x.watts)) })),
    }
  }
  if (t.tool === 'patterns') return { patterns: patternFacts(wastePatterns()) }
  if (t.tool === 'getRoom') {
    const x = s.rooms[t.roomId]
    const room = getRoom(t.roomId)
    if (!x || !room) return { error: 'unknown room' }
    return { roomId: x.roomId, name: room.name, status: x.status, people: x.headcount, capacity: room.capacity, watts: round(x.watts, 0), costPerHour: round(costPerHour(x.watts)), co2ppm: round(x.co2ppm, 0), occupancyKnown: x.occupancyKnown, inputs: x.sources }
  }
  return {}
}

/** Offline routing when the AI is unreachable: a few keywords cover the demo questions. */
export function guessTool(q: string): CopilotTool {
  const text = q.toLowerCase()
  const room = getSite().rooms.find((x) => text.includes(x.id.toLowerCase()))
  if (/what if|save|saving|policy|auto|semester|month/.test(text)) {
    const policy: Exclude<PolicyId, 'baseline'> = /daylight/.test(text) ? 'daylight' : /move|smaller|consolidat/.test(text) ? 'consolidate' : /all|everything|combined/.test(text) ? 'combined' : 'auto_off'
    return { tool: 'runScenario', policy }
  }
  if (room) return { tool: 'getRoom', roomId: room.id }
  if (/pattern|when|usually|often|habit/.test(text)) return { tool: 'patterns' }
  if (/wast|most|worst|top/.test(text)) return { tool: 'topWasters' }
  return { tool: 'none' }
}

/** Offline answer written by code from the tool result */
export function templateAnswer(t: CopilotTool, result: ReturnType<typeof runTool>): string {
  const x = result as Record<string, unknown>
  if (t.tool === 'runScenario') {
    const m = x.monthlySavingCost as Range
    return `Modelled over ${x.runs} runs, ${x.policy} would save between ${formatMoney(m.p10)} and ${formatMoney(m.p90)} a month across the building, most likely ${formatMoney(m.p50)}.`
  }
  if (t.tool === 'topWasters') {
    const list = x.wastingRooms as { roomId: string; watts: number }[]
    return list.length ? `Right now ${list.map((w) => `${w.roomId} wastes ${w.watts} W`).join(', ')}.` : 'No room is wasting power right now.'
  }
  if (t.tool === 'patterns') return templatePatterns(wastePatterns()) || 'No pattern yet: cameras or sensors need to watch empty rooms for a while first.'
  if (t.tool === 'getRoom' && !x.error) return x.occupancyKnown ? `${x.roomId} is ${x.status} with ${x.people} people, drawing ${x.watts} W.` : `${x.roomId} has no live occupancy input yet; it draws ${x.watts} W from what is observed.`
  return 'I can answer questions about this building: which rooms waste power, the state of a room, or what a policy would save.'
}

/** Facts for the sustainability report: a modelled week, policy results, and the live record. */
export function reportFacts(extra: { auditTrail?: AuditTrail | null; solar?: SolarFacts | null } = {}) {
  const s = useTwin.getState()
  const site = getSite()
  const building = site
  const live = Object.values(s.rooms)
  const policies: PolicyId[] = ['auto_off', 'daylight', 'consolidate', 'combined']
  const comparisons = policies.map((p) => compareScenario({ policy: p, params: { emptyMinutes: 5 }, days: 7, runs: DEFAULT_RUNS, seed: 42 }, site.rooms))
  const auto = comparisons[0]
  const count = (t: string) => building.rooms.reduce((a, room) => a + room.devices.filter((d) => d.type === t).length, 0)
  const connectedKw = building.rooms.reduce((a, room) => a + room.devices.reduce((b, d) => b + d.ratedW, 0), 0) / 1000

  return {
    building: {
      organization: site.organization,
      name: site.buildingName,
      location: site.location?.name ?? null,
      rooms: building.rooms.length,
      seats: building.rooms.reduce((a, room) => a + room.capacity, 0),
      devices: { lights: count('light'), fans: count('fan'), acs: count('ac'), projectors: count('projector'), pcs: count('pc') },
      connectedLoadKw: round(connectedKw, 1),
      roomsWithLiveInputs: live.filter((x) => x.sources.length).map((x) => x.roomId),
    },
    currency: site.currency,
    tariffPerKwh: site.tariffPerKwh,
    gridEmissionKgPerKwh: site.gridKgPerKwh,
    modelledWeekBaseline: { kwh: r(auto.baseline.kwh), cost: r(auto.baseline.cost), co2Kg: r(auto.baseline.co2Kg) },
    energyIntensityKwhPerM2Year: {
      today: round(epi(auto.baseline.kwh.p50, building.rooms), 1),
      withAllMeasures: round(epi(comparisons[3].policy.kwh.p50, building.rooms), 1),
    },
    wastePatternsObserved: patternFacts(wastePatterns()),
    spaceUtilizationObserved: readUsage(site.rooms)
      .map((u) => ({ roomId: u.roomId, seats: getRoom(u.roomId)!.capacity, usedPercent: round(u.inUse * 100, 0), fullWhenUsedPercent: round(u.fillWhenUsed * 100, 0), hoursObserved: round(u.hoursObserved, 1) }))
      .sort((a, b) => a.fullWhenUsedPercent - b.fullWhenUsedPercent)
      .slice(0, 5),
    policies: comparisons.map(scenarioFacts),
    topWasteRoomsModelledWeek: auto.baseline.perRoom
      .map((b, i) => ({ roomId: b.roomId, avoidableKwhPerWeek: round(b.kwhP50 - auto.policy.perRoom[i].kwhP50, 1) }))
      .sort((a, b) => b.avoidableKwhPerWeek - a.avoidableKwhPerWeek)
      .slice(0, 5),
    liveSession: {
      minutes: round((Date.now() - s.t0) / 60000, 1),
      kwh: round(live.reduce((a, x) => a + x.kwh, 0), 3),
      cost: round(live.reduce((a, x) => a + x.cost, 0)),
      wasteCost: round(live.reduce((a, x) => a + x.wasteCost, 0)),
      savedCost: round(s.savedCost),
    },
    indoorAir: Object.entries(s.co2History)
      .map(([roomId, h]) => ({ roomId, peakPpm: round(Math.max(...h), 0) }))
      .sort((a, b) => b.peakPpm - a.peakPpm)
      .slice(0, 3),
    ...(extra.auditTrail ? { storedActionLog: extra.auditTrail } : {}),
    ...(extra.solar ? { rooftopSolarModelled: extra.solar } : {}),
    actionsTaken: s.events.filter((e) => e.kind === 'command' || e.kind === 'ack').slice(0, 15).map((e) => e.text),
    method: {
      runs: DEFAULT_RUNS,
      days: 7,
      notes: [
        'Live figures come only from cameras (person, light, fan and screen detection in the browser), connected sensors and staff reports.',
        'Savings and the weekly baseline are modelled from the configured rooms and assumptions, as Monte Carlo ranges (p10 to p90) on shared random seeds.',
        `Assumed share of classes after which lights stay on: ${Math.round(site.leftOnProbability * 100)}%.`,
      ],
    },
  }
}
