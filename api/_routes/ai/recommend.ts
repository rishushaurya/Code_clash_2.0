// POST /api/ai/recommend  { facts }  ->  { title, action, reason, monthlySavingCost, priority }
// The AI writes the words; the saving figure is copied from the facts by code, never by the model.

import { z } from 'zod'
import { ALWAYS_ALLOWED, ungroundedFigures } from '../../_lib/grounding.js'
import { json, logJson, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiConfigured, chatJson } from '../../_lib/llm.js'
import { FactsSchema } from '../../_lib/schemas.js'

const Out = z.object({
  title: z.string().max(80),
  action: z.string().max(400),
  reason: z.string().max(400),
  priority: z.enum(['high', 'medium', 'low']),
})

const SYSTEM = `You are an energy auditor writing one recommendation card for a building's facility manager.
Rules:
- Use only figures that appear in the facts JSON. Never invent or compute a number. Write money in the currency given in facts.currency, with its usual symbol.
- Name rooms by their id (for example LH-1).
- title: at most 8 words. action: one concrete step, at most 40 words. reason: why, at most 40 words.
- priority: high if the room wastes 1000 W or more, medium otherwise, low for daylight or underused rooms.
- No emojis. Reply with JSON only: {"title","action","reason","priority"}.`

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  if (!aiConfigured()) return json({ error: 'No AI key configured' }, 503)
  const limited = rateLimit(req)
  if (limited) return limited
  const body = await readBody(req, z.object({ facts: FactsSchema }))
  if (body instanceof Response) return body
  const { facts } = body
  try {
    const out = await chatJson(SYSTEM, JSON.stringify(facts), Out, (o) =>
      ungroundedFigures(`${o.title} ${o.action} ${o.reason}`, facts, ALWAYS_ALLOWED).map((f) => `"${f}" is not in the facts`),
    )
    return json({ ...out, monthlySavingCost: facts.monthlySavingCost ?? null })
  } catch (e) {
    logJson('warn', 'recommend failed', { roomId: facts.roomId, error: String(e).slice(0, 300) })
    return json({ error: 'AI unavailable' }, 502)
  }
}
