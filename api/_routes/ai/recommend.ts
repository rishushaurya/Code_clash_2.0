// POST /api/ai/recommend  { facts, action }  ->  { reason }
// Code decides what to do (the browser's templates write the title and the action from the rule: 24 °C for
// ACs, ventilation for CO2, switch-off for waste). The AI only writes why, in the words of this room, and every
// figure it quotes must be in the facts.

import { z } from 'zod'
import { ungroundedFigures } from '../../_lib/grounding.js'
import { json, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiFailure, chatJson } from '../../_lib/llm.js'
import { FactsSchema } from '../../_lib/schemas.js'

const Out = z.object({ reason: z.string().min(10).max(400) })

const SYSTEM = `You are an energy auditor writing the reason line of one alert card for a building's facility manager.
The action is already decided by the building's rules and is given to you; do not change it, repeat it or suggest a different one.
Write why it matters for this room right now, in at most 35 words.
Rules:
- Use only figures that appear in the facts JSON, with the same period (per hour, today, a month) as their name says. Never invent or compute a number. Money in the currency given in facts.currency, with its usual symbol.
- Name rooms by their id (for example LH-1). Never write JSON field names.
- No emojis. Reply with JSON only: {"reason"}.`

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const limited = rateLimit(req)
  if (limited) return limited
  const body = await readBody(req, z.object({ facts: FactsSchema, action: z.string().max(400).default('') }))
  if (body instanceof Response) return body
  const { facts, action } = body
  try {
    const out = await chatJson({ workspace: id, task: 'chat' }, SYSTEM, JSON.stringify({ facts, action }), Out, (o) =>
      ungroundedFigures(o.reason, facts).map((f) => `"${f}" is not in the facts`),
    )
    return json(out)
  } catch (e) {
    return aiFailure(e, 'recommend', { roomId: facts.roomId })
  }
}
