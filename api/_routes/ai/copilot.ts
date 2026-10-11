// POST /api/ai/copilot
// Step 1  { question, roomIds }      -> the AI picks a tool: runScenario, topWasters, getRoom or none.
// Step 2  { question, toolResult }   -> the AI answers from the tool's numbers only.
// The browser runs the tool in between, so the AI operates the real simulation engine.

import { z } from 'zod'
import { ALWAYS_ALLOWED, ungroundedFigures } from '../../_lib/grounding.js'
import { json, logJson, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiConfigured, chatJson } from '../../_lib/llm.js'

const Plan = z.object({
  tool: z.enum(['runScenario', 'topWasters', 'getRoom', 'patterns', 'none']),
  policy: z.enum(['auto_off', 'daylight', 'consolidate', 'combined']).optional(),
  emptyMinutes: z.number().int().min(1).max(60).optional(),
  roomId: z.string().optional(),
})
const Answer = z.object({ answer: z.string().max(900) })

const Body = z.union([
  z.object({ question: z.string().min(2).max(500), roomIds: z.array(z.string()).max(100) }),
  z.object({ question: z.string().min(2).max(500), toolResult: z.unknown() }),
])

const PLAN_SYSTEM = `You operate the Pratibimb digital twin of a building. Choose one tool for the user's question.
Tools:
- runScenario: what-if savings of a policy. policy is one of auto_off (switch off after emptyMinutes empty), daylight (window-side lights off in daylight), consolidate (move small classes to smaller rooms), combined (all three).
- topWasters: which rooms waste the most power right now.
- getRoom: the live state of one room; set roomId to one of the given room ids.
- patterns: when and where empty rooms are most often left on, from observed data.
- none: the question is not about this building's energy.
Reply with JSON only: {"tool", "policy"?, "emptyMinutes"?, "roomId"?}.`

const ANSWER_SYSTEM = `You are Pratibimb, the voice of the building's digital twin. Answer the question in at most 70 words, spoken style, for a facility manager.
Use only figures from the tool result JSON; quote ranges as given. Money in the currency given in the tool result, with its usual symbol. Say "modelled" when the numbers come from the simulation. No emojis.
Reply with JSON only: {"answer"}.`

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  if (!aiConfigured()) return json({ error: 'No AI key configured' }, 503)
  const limited = rateLimit(req)
  if (limited) return limited
  const body = await readBody(req, Body, 60_000)
  if (body instanceof Response) return body
  try {
    if ('roomIds' in body) {
      const plan = await chatJson(PLAN_SYSTEM, JSON.stringify(body), Plan, (p) =>
        p.tool === 'getRoom' && !body.roomIds.includes(p.roomId ?? '') ? ['roomId must be one of the given room ids'] : [],
      )
      return json(plan)
    }
    const out = await chatJson(ANSWER_SYSTEM, JSON.stringify(body), Answer, (a) =>
      ungroundedFigures(a.answer, body.toolResult, ALWAYS_ALLOWED).map((f) => `"${f}" is not in the tool result`),
    )
    return json(out)
  } catch (e) {
    logJson('warn', 'copilot failed', { error: String(e).slice(0, 300) })
    return json({ error: 'AI unavailable' }, 502)
  }
}
