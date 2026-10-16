// Tools the Assistant can run, executed here in the browser on the real twin and engine.
// Also builds the facts pack for the sustainability report. Every number is computed and rounded here.

import { DEFAULT_RUNS } from '@/shared/config'
import { getRoom, getSite } from '@/shared/site'
import type { PolicyId, Range, ScenarioComparison } from '@/shared/types'
import { compareScenario, epi, POLICY_LABELS } from '@/sim/engine'
import { costPerHour, formatMoney, round } from '@/twin/energy'
import { useTwin } from '@/twin/store'
import { readUsage, wastePatterns } from '@/twin/usage'
import { useCameras } from '@/cv/cameras'
import { coverage } from '@/cv/coverage'
import { connectionGuide, explainMetric, teach, TOPICS } from './guides'
import { guideAnswer, workspaceSnapshot } from './knowledge'
import { patternFacts, templatePatterns } from './patterns'
import { propose } from './proposals'
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

/** Every watched room with people, watts and status, highest load first: answers "which room uses the most power" */
export function liveSummary() {
  const s = useTwin.getState()
  const all = Object.values(s.rooms)
  const watched = all.filter((x) => x.sources.length)
  return {
    currency: getSite().currency,
    rooms: all.length,
    watchedRooms: watched.length,
    totalWattsWatched: round(watched.reduce((a, x) => a + x.watts, 0), 0),
    byPower: watched
      .sort((a, b) => b.watts - a.watts)
      .map((x) => ({ roomId: x.roomId, status: x.status, people: x.occupancyKnown ? x.headcount : 'unknown', watts: round(x.watts, 0), costPerHour: round(costPerHour(x.watts)) })),
    notWatched: all.filter((x) => !x.sources.length).map((x) => x.roomId),
  }
}

/** The modelled energy index of the site, for teaching EPI with this building's own number */
const siteEpi = () => {
  const rooms = getSite().rooms
  if (!rooms.length) return undefined
  const c = compareScenario({ policy: 'auto_off', params: { emptyMinutes: 5 }, days: 7, runs: DEFAULT_RUNS, seed: 42 }, rooms)
  return round(epi(c.baseline.kwh.p50, rooms), 1)
}

export function runTool(t: CopilotTool) {
  const s = useTwin.getState()
  const site = getSite()
  if (t.tool === 'liveSummary') return liveSummary()
  if (t.tool === 'runScenario') {
    const c = compareScenario({ policy: t.policy, params: { emptyMinutes: t.emptyMinutes ?? 5 }, days: 7, runs: DEFAULT_RUNS, seed: 42 }, site.rooms)
    return { ...scenarioFacts(c), emptyMinutes: t.policy === 'auto_off' || t.policy === 'combined' ? (t.emptyMinutes ?? 5) : undefined }
  }
  if (t.tool === 'topWasters') {
    const all = Object.values(s.rooms)
    return {
      currency: site.currency,
      /** Rooms a camera, sensor or staff report feeds right now; the others cannot be judged */
      watchedRooms: all.filter((x) => x.sources.length).length,
      rooms: all.length,
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
    if (!x || !room) return { error: `There is no room ${t.roomId} in this building.` }
    return { roomId: x.roomId, name: room.name, currency: site.currency, status: x.status, people: x.headcount, capacity: room.capacity, watts: round(x.watts, 0), costPerHour: round(costPerHour(x.watts)), co2ppm: round(x.co2ppm, 0), co2Measured: x.co2Measured, occupancyKnown: x.occupancyKnown, inputs: x.sources }
  }
  if (t.tool === 'coverage') {
    const cameras = Object.values(useCameras.getState().cameras)
    const rooms = t.roomId ? site.rooms.filter((r) => r.id === t.roomId) : site.rooms
    return {
      rooms: rooms.map((r) => ({
        roomId: r.id,
        cameras: cameras.filter((c) => c.roomId === r.id).length,
        liveInputs: s.rooms[r.id]?.sources ?? [],
        devices: coverage(r, cameras).map((c) => ({ type: c.type, watched: c.watched, total: c.total })),
      })),
    }
  }
  if (t.tool === 'explainMetric') return explainMetric(t.metric, site, s.rooms, t.roomId ? getRoom(t.roomId) : undefined)
  if (t.tool === 'connectionGuide') return connectionGuide(site, s.rooms, t.roomId ? getRoom(t.roomId) : undefined)
  if (t.tool === 'teach') return teach(t.topic, site, t.topic === 'epi' ? siteEpi() : undefined)
  if (t.tool === 'knowledge') return workspaceSnapshot()
  if (t.tool === 'proposeSiteChange') {
    const p = propose(site, t.change)
    return typeof p === 'string' ? { error: p } : { proposal: p.summary, changes: p.rows }
  }
  return {}
}

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Offline routing when the AI is unreachable: keywords cover the common questions. */
export function guessTool(q: string): CopilotTool {
  const text = q.toLowerCase()
  const room = getSite().rooms.find((x) => new RegExp(`(^|[^a-z0-9-])${escape(x.id.toLowerCase())}($|[^a-z0-9-])`).test(text))
  const at = room ? { roomId: room.id } : {}
  const topic = TOPICS.find((t) => text.includes(t))
  if (/\b(what is|what's|explain|teach|meaning|mean)\b/.test(text) && topic) return { tool: 'teach', topic }
  if (/where .*come from|how .*(calculated|computed|measured|worked out)/.test(text)) {
    const metric = /cost|money|bill/.test(text) ? 'cost' : /people|head/.test(text) ? 'people' : /co2|air|ppm/.test(text) ? 'air' : /saving/.test(text) ? 'savings' : /kwh|energy/.test(text) ? 'energy' : 'power'
    return { tool: 'explainMetric', metric, ...at }
  }
  if (/connect|no input|hook up|add a camera|smart plug|sensor api|set up a camera/.test(text)) return { tool: 'connectionGuide', ...at }
  if (/coverage|watched|can the camera see|cameras see/.test(text)) return { tool: 'coverage', ...at }
  if (/what if|save|saving|policy|auto-?off|semester|month/.test(text)) {
    const policy: Exclude<PolicyId, 'baseline'> = /daylight/.test(text) ? 'daylight' : /move|smaller|consolidat/.test(text) ? 'consolidate' : /all|everything|combined/.test(text) ? 'combined' : 'auto_off'
    return { tool: 'runScenario', policy }
  }
  if (room) return { tool: 'getRoom', roomId: room.id }
  if (/pattern|when|usually|often|habit/.test(text)) return { tool: 'patterns' }
  if (/wast/.test(text)) return { tool: 'topWasters' }
  if (/most|power|watts|load|summary|every room|all rooms|status/.test(text)) return { tool: 'liveSummary' }
  if (/how (do|can|to|should)|where (is|do|can)|steps?|guide|help me|set ?up|invite|team|password|key|camera|sensor|report|3d|alert|assistant|energy|sustainab|green|efficien/.test(text)) return { tool: 'knowledge' }
  return { tool: 'none' }
}

export const OFF_TOPIC =
  'I help with this building, this app, and energy and sustainability: live rooms and power, alerts and their fixes, savings what-ifs, where a number comes from, how to do anything in the app step by step, changes to the setup, and terms like kWh, EPI, BEE or NAAC 7.1.6.'

/** Offline answer written by code from the tool result */
export function templateAnswer(t: CopilotTool, result: ReturnType<typeof runTool>, q = ''): string {
  const x = result as Record<string, unknown>
  if (x.error) return String(x.error)
  if (t.tool === 'liveSummary') {
    const r = result as ReturnType<typeof liveSummary>
    if (!r.watchedRooms) return 'No room has a camera or sensor yet, so there is no live power to compare. Ask me how to connect one.'
    const people = (p: number | string) => (p === 'unknown' ? 'people unknown' : `${p} ${p === 1 ? 'person' : 'people'}`)
    return `${r.watchedRooms} of ${r.rooms} rooms are watched. By power: ${r.byPower.map((w) => `${w.roomId} ${w.watts} W (${w.status}, ${people(w.people)})`).join('; ')}.`
  }
  if (t.tool === 'runScenario') {
    const m = x.monthlySavingCost as Range
    return `Modelled over ${x.runs} runs, ${x.policy} would save between ${formatMoney(m.p10)} and ${formatMoney(m.p90)} a month across the building, most likely ${formatMoney(m.p50)}.`
  }
  if (t.tool === 'topWasters') {
    const list = x.wastingRooms as { roomId: string; watts: number }[]
    if (!x.watchedRooms) return 'No room has a camera or sensor yet, so none can be judged. Add a camera on the Cameras page, or report what you see on a room page.'
    return list.length ? `Right now ${list.map((w) => `${w.roomId} wastes ${w.watts} W`).join(', ')}.` : `None of the ${x.watchedRooms} watched rooms is wasting power right now.`
  }
  if (t.tool === 'patterns') return templatePatterns(wastePatterns()) || 'No pattern yet: cameras or sensors need to watch empty rooms for a while first.'
  if (t.tool === 'getRoom') return x.occupancyKnown ? `${x.roomId} is ${x.status} with ${x.people} people, drawing ${x.watts} W.` : `${x.roomId} has no live occupancy input yet; it draws ${x.watts} W from what is observed.`
  if (t.tool === 'coverage') {
    const rooms = (result as { rooms: { roomId: string; cameras: number; devices: { type: string; watched: number; total: number }[] }[] }).rooms
    if (!rooms.length) return 'No rooms are set up yet.'
    return `${rooms.map((r) => `${r.roomId}: ${r.cameras ? r.devices.map((d) => `${d.watched} of ${d.total} ${d.type}s watched`).join(', ') || 'no devices set up' : 'no camera'}`).join('. ')}.`
  }
  if (t.tool === 'explainMetric') return String(x.how)
  if (t.tool === 'connectionGuide') {
    const g = result as ReturnType<typeof connectionGuide>
    return `${g.roomsWithNoInput.length ? `Rooms with no input: ${g.roomsWithNoInput.join(', ')}. ` : ''}A room can be connected three ways: a camera or phone, the sensor API, or a smart plug. The steps are below.`
  }
  if (t.tool === 'teach') return Object.values(x).filter((v) => typeof v === 'string').join(' ')
  if (t.tool === 'knowledge') return guideAnswer(q)
  if (t.tool === 'proposeSiteChange') return `Here is the change I propose: ${x.proposal}. Nothing is saved until you press Approve.`
  return OFF_TOPIC
}

/**
 * Peak indoor CO2 per room this session. Sensor readings count even when they are older than the live window
 * (the twin's history only keeps values while they are fresh), so a measured 1250 ppm is never lost.
 */
export function indoorAir(s: Pick<ReturnType<typeof useTwin.getState>, 'co2History' | 'sensors'>) {
  const rooms = new Set([...Object.keys(s.co2History), ...Object.keys(s.sensors).filter((id) => s.sensors[id].air?.co2ppm !== undefined)])
  return [...rooms]
    .map((roomId) => {
      const sensor = s.sensors[roomId]?.air?.co2ppm
      return { roomId, peakPpm: round(Math.max(...(s.co2History[roomId] ?? []), sensor ?? 0), 0), measured: sensor !== undefined }
    })
    .sort((a, b) => b.peakPpm - a.peakPpm)
    .slice(0, 5)
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
    indoorAir: indoorAir(s),
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
