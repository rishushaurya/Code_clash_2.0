// POST /api/ai/report  { facts }  ->  { title, sections: [{ heading, paragraphs, bullets }] }
// Facts are a week of twin and simulation numbers prepared in the browser by reportFacts() in src/ai/tools.ts.

import { z } from 'zod'
import { ALWAYS_ALLOWED, ungroundedFigures } from '../../_lib/grounding.js'
import { json, logJson, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiConfigured, chatJson } from '../../_lib/llm.js'

const Out = z.object({
  title: z.string().max(120),
  sections: z
    .array(z.object({ heading: z.string().max(80), paragraphs: z.array(z.string().max(1200)).max(4), bullets: z.array(z.string().max(300)).max(10) }))
    .min(5)
    .max(12),
})

const SYSTEM = `You write energy-audit reports for buildings, in the structure accreditation and audit evidence uses (for example NAAC criterion 7.1.6 in India, or an ASHRAE Level 1 walk-through).
Write these sections in order: Summary; Building profile; Baseline consumption; Waste hotspots; When waste happens (from the observed patterns); Space utilization; Indoor air quality; Recommendations with cost-benefit; Actions taken (include the stored action log when present); Rooftop solar (only when the facts include it); Method and assumptions.
Rules:
- Use only figures that appear in the facts JSON. Never invent, add up or estimate a number. Quote ranges exactly as given (p10 to p90).
- Money in the currency given in facts.currency, with its usual symbol. Rooms by id. Say clearly which figures are modelled and which were measured by cameras, sensors or staff.
- Plain, formal English. No emojis. No markdown symbols inside strings.
- Reply with JSON only: {"title", "sections": [{"heading", "paragraphs": [..], "bullets": [..]}]}.`

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  if (!aiConfigured()) return json({ error: 'No AI key configured' }, 503)
  const limited = rateLimit(req, 6)
  if (limited) return limited
  const body = await readBody(req, z.object({ facts: z.record(z.string(), z.unknown()) }), 60_000)
  if (body instanceof Response) return body
  try {
    const out = await chatJson(SYSTEM, JSON.stringify(body.facts), Out, (o) => {
      const text = o.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...s.bullets]).join(' ')
      return ungroundedFigures(text, body.facts, ALWAYS_ALLOWED).map((f) => `"${f}" is not in the facts`)
    })
    return json(out)
  } catch (e) {
    logJson('warn', 'report failed', { error: String(e).slice(0, 300) })
    return json({ error: 'AI unavailable' }, 502)
  }
}
