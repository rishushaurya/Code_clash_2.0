// POST /api/ai/copilot: the building Assistant (and the Patterns explainer).
// Step 1  { question, roomIds, history }     -> the AI picks one tool and its arguments.
// Step 2  { question, toolResult, history }  -> the AI answers from the tool's result only.
// The browser runs the tool in between, on the real twin, simulation and site, so the AI never computes a number.
// A proposed site change is only a proposal: the browser shows it as a diff and saves it only on Approve.

import { z } from 'zod'
import { ungroundedFigures } from '../../_lib/grounding.js'
import { json, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiFailure, chatJson } from '../../_lib/llm.js'
import { numbersIn } from './setup.js'

const METRICS = ['power', 'cost', 'energy', 'emissions', 'air', 'people', 'waste', 'saved', 'savings', 'epi'] as const
const TOPICS = ['kwh', 'epi', 'bee', 'co2', 'naac'] as const
const DEVICES = ['light', 'fan', 'ac', 'projector', 'pc'] as const
const ROOM_TYPES = ['lecture_hall', 'classroom', 'lab', 'office', 'meeting', 'other'] as const

const Change = z.object({
  kind: z.enum(['setDeviceCount', 'setCapacity', 'setHours', 'setAutoOff', 'addRoom', 'renameRoom']),
  roomId: z.string().max(12).optional(),
  device: z.enum(DEVICES).optional(),
  count: z.number().optional(),
  capacity: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  days: z.array(z.number()).max(7).optional(),
  enabled: z.boolean().optional(),
  minutes: z.number().optional(),
  id: z.string().max(12).optional(),
  name: z.string().max(60).optional(),
  floor: z.number().optional(),
  type: z.enum(ROOM_TYPES).optional(),
})
const Plan = z.object({
  tool: z.enum(['liveSummary', 'runScenario', 'topWasters', 'getRoom', 'patterns', 'coverage', 'explainMetric', 'connectionGuide', 'proposeSiteChange', 'teach', 'none']),
  policy: z.enum(['auto_off', 'daylight', 'consolidate', 'combined']).optional(),
  emptyMinutes: z.number().int().min(1).max(60).optional(),
  roomId: z.string().optional(),
  metric: z.enum(METRICS).optional(),
  topic: z.enum(TOPICS).optional(),
  change: Change.optional(),
})
const Answer = z.object({ answer: z.string().max(1200) })

const History = z.array(z.object({ q: z.string().max(500), a: z.string().max(1500) })).max(6).optional()
const Body = z.union([
  z.object({ question: z.string().min(2).max(500), roomIds: z.array(z.string()).max(500), history: History }),
  z.object({ question: z.string().min(2).max(500), toolResult: z.unknown(), history: History }),
])

const PLAN_SYSTEM = `You are the Assistant of Pratibimb, the digital twin of one building. You help only with this building and this app.
Choose exactly one tool for the user's latest question. Earlier turns are given for context ("and LH-2?").
Tools:
- liveSummary: every watched room with people, power and status, highest power first. Use for "which room uses the most power", "what is on now", "give me a summary".
- topWasters: rooms wasting power right now (empty but drawing power).
- getRoom: the live state of one room; set roomId.
- patterns: when and where empty rooms are most often left on, from observed data.
- runScenario: modelled savings of a policy. policy is auto_off (switch off after emptyMinutes empty), daylight (window-side lights off in daylight), consolidate (move small classes to smaller rooms) or combined.
- coverage: how many of each room's devices a camera watches; roomId optional.
- explainMetric: where a number comes from and how it is computed. metric is one of power, cost, energy (kWh), emissions (kg CO2), air (indoor CO2 ppm), people, waste, saved, savings (modelled), epi. roomId optional.
- connectionGuide: how to connect a room with no inputs (camera, phone, sensor API, smart plug); roomId optional.
- proposeSiteChange: the user asks to change the setup. change.kind is one of:
  setDeviceCount {roomId, device (light, fan, ac, projector, pc), count}; setCapacity {roomId, capacity};
  setHours {from, to (0-24, 24-hour clock), days (0 = Monday ... 6 = Sunday, optional)}; setAutoOff {enabled, minutes};
  addRoom {id (like LH-3), name, floor, type (lecture_hall, classroom, lab, office, meeting, other), capacity}; renameRoom {roomId, name}.
  Use only numbers the user said. The change is shown to the user for approval; it is never saved by you.
- teach: explain a term. topic is kwh, epi, bee (Bureau of Energy Efficiency, star labels, AC 24 C), co2 (grid emissions and the indoor CO2 model), naac (NAAC criterion 7.1.6).
- none: greetings, and anything not about this building, its energy, comfort, data or this app (general knowledge, coding, other buildings, opinions).
Room ids must be from the given list, except the id of a new room in addRoom.
Reply with JSON only: {"tool", "policy"?, "emptyMinutes"?, "roomId"?, "metric"?, "topic"?, "change"?}.`

const ANSWER_SYSTEM = `You are the Assistant of Pratibimb, the digital twin of one building, speaking to its facility manager. Answer the latest question from the tool result JSON.
Rules:
- Use only figures that appear in the tool result, with the period their name gives (per hour, today, a month, a week). Never invent, add up or estimate a number. Quote ranges as given.
- Money in the currency given in the tool result, with its usual symbol. Name rooms by id.
- Say "modelled" for numbers from a simulation (runScenario, savings, EPI); live room states are measured. People "unknown" means no input counts people there; never say zero.
- Only when the tool result has watchedRooms equal to 0, say that no room has a camera or sensor yet, so nothing can be judged, and offer to explain how to connect one.
- Coverage counts only what cameras watch; a room with no camera may still have a sensor or staff reports (liveInputs).
- For a tool result with steps, give a one or two sentence summary; the steps are shown below your answer.
- For teach, explain in plain words a newcomer understands, at most 120 words. Otherwise at most 80 words, spoken style.
- Answer in the language of the question (English, Hindi or Kannada), with digits as in the tool result.
- Never write JSON field names. No emojis, no markdown.
Reply with JSON only: {"answer"}.`

/** Numbers in a proposed change must be numbers the person said; ids and day lists are checked by the browser */
function unstated(change: z.infer<typeof Change>, question: string) {
  const said = numbersIn(question)
  const nums = (['count', 'capacity', 'from', 'to', 'minutes', 'floor'] as const).flatMap((k) => (typeof change[k] === 'number' ? [[k, change[k]] as const] : []))
  // "9 am to 5 pm" is said as 9 and 5 and means 9 and 17.
  return nums.filter(([k, v]) => !said.has(v) && !((k === 'to' || k === 'from') && said.has(v - 12))).map(([k, v]) => `${k} ${v} was not said by the user; use only numbers from the question`)
}

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const limited = rateLimit(req)
  if (limited) return limited
  const body = await readBody(req, Body, 60_000)
  if (body instanceof Response) return body
  const ai = { workspace: id, task: 'chat' } as const
  try {
    if ('roomIds' in body) {
      const plan = await chatJson(ai, PLAN_SYSTEM, JSON.stringify(body), Plan, (p) => {
        const known = (r?: string) => body.roomIds.includes(r ?? '')
        if (p.tool === 'getRoom' && !known(p.roomId)) return ['roomId must be one of the given room ids']
        if (['coverage', 'explainMetric', 'connectionGuide'].includes(p.tool) && p.roomId && !known(p.roomId)) return ['roomId must be one of the given room ids, or left out']
        if (p.tool === 'runScenario' && !p.policy) return ['runScenario needs a policy']
        if (p.tool === 'explainMetric' && !p.metric) return ['explainMetric needs a metric']
        if (p.tool === 'teach' && !p.topic) return ['teach needs a topic']
        if (p.tool === 'proposeSiteChange') return p.change ? unstated(p.change, body.question) : ['proposeSiteChange needs a change']
        return []
      })
      return json(plan)
    }
    const out = await chatJson(ai, ANSWER_SYSTEM, JSON.stringify(body), Answer, (a) => ungroundedFigures(a.answer, body.toolResult).map((f) => `"${f}" is not in the tool result`))
    return json(out)
  } catch (e) {
    return aiFailure(e, 'copilot', { workspace: id })
  }
}
