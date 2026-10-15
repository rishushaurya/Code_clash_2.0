// POST /api/ai/report  { facts }  ->  { title, sections: [{ heading, paragraphs, bullets }] }
// Facts are a week of twin and simulation numbers prepared in the browser by reportFacts() in src/ai/tools.ts.
// One AI call, read leniently (extra paragraphs are trimmed, not fatal). Then every sentence or bullet that
// quotes a figure missing from the facts is removed, so the AI never adds a number, and the rest of the
// report survives one bad sentence. Too little left means the browser writes the report from templates.

import { z } from 'zod'
import { ungroundedFigures } from '../../_lib/grounding.js'
import { json, logJson, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiFailure, chatJson } from '../../_lib/llm.js'

/**
 * A model that breaks its own JSON leaves structure inside the strings: a paragraph ending in `"]` or `”]`,
 * a "paragraph" that is only `bullets` or `:`. Those characters are cut from the ends, and a string that is only
 * a field name or punctuation is dropped, so raw JSON never reaches the page.
 */
export function cleanText(v: string) {
  const t = v
    .replace(/"?\b(?:heading|paragraphs|bullets|sections|title)"?\s*:\s*\[?/gi, '')
    .replace(/^[\s"'“”‘’[\]{},:]+/, '')
    .replace(/[\s"'“”‘’[\]{},:]+$/, '')
    .trim()
  return /^(heading|paragraphs?|bullets?|sections?|title)?$/i.test(t.replace(/[^a-z]/gi, '')) ? '' : t
}
const text = (max: number) => z.unknown().optional().transform((v) => (typeof v === 'string' ? cleanText(v).slice(0, max) : ''))
const texts = (max: number, count: number) =>
  z
    .unknown()
    .optional()
    .transform((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => cleanText(x).slice(0, max)).filter(Boolean).slice(0, count) : []))
export const Out = z.object({
  title: text(120),
  sections: z
    .unknown()
    .optional()
    .transform((v) => (Array.isArray(v) ? v.slice(0, 12) : []))
    .pipe(z.array(z.object({ heading: text(80), paragraphs: texts(1200, 4), bullets: texts(300, 10) }).nullable().catch(null))),
})
type Draft = z.infer<typeof Out>

const SYSTEM = `You write energy-audit reports for buildings, in the structure accreditation and audit evidence uses (for example NAAC criterion 7.1.6 in India, or an ASHRAE Level 1 walk-through).
Write these sections in order: Summary; Building profile; Baseline consumption; Waste hotspots; When waste happens (from the observed patterns); Space utilization; Indoor air quality; Recommendations with cost-benefit; Actions taken (include the stored action log when present); Rooftop solar (only when the facts include it); Method and assumptions.
Rules:
- Use only figures that appear in the facts JSON, written exactly as they appear there. Never invent, add up, subtract or estimate a number. Quote ranges exactly as given (p10 to p90).
- Each figure keeps the period its name gives: a monthly saving is "a month", a modelled week is "a week", a live session is "this session". Never call a monthly figure weekly or the reverse.
- Never write a JSON field name (such as indoorAir, peakPpm or monthlySavingCost) in the text; say what it means in plain words. Indoor air readings marked measured come from a CO2 sensor; the others are estimated from head-counts.
- Money in the currency given in facts.currency, with its usual symbol. Rooms by id. Say clearly which figures are modelled and which were measured by cameras, sensors or staff.
- At most 4 short paragraphs and 10 bullets per section. Plain, formal English. No emojis. No markdown symbols inside strings.
- Reply with JSON only: {"title", "sections": [{"heading", "paragraphs": [..], "bullets": [..]}]}.`

/** camelCase keys of the facts (indoorAir, peakPpm): a sentence naming one is leaking the data structure */
function fieldNames(facts: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(facts)) facts.forEach((v) => fieldNames(v, out))
  else if (facts && typeof facts === 'object')
    for (const [k, v] of Object.entries(facts)) {
      if (/[a-z][A-Z]/.test(k)) out.add(k)
      fieldNames(v, out)
    }
  return out
}

/** Keeps only sentences and bullets whose figures are all in the facts and that name no field; drops sections left empty */
export function keepGrounded(draft: Draft, facts: unknown) {
  let removed = 0
  const fields = [...fieldNames(facts)]
  const grounded = (t: string) => {
    if (!ungroundedFigures(t, facts).length && !fields.some((f) => t.includes(f))) return true
    removed++
    return false
  }
  // Sentences end at . ! or ? followed by a space, so "8.73" stays whole.
  const sentences = (p: string) => p.split(/(?<=[.!?])\s+/).filter(grounded).join(' ')
  const sections = draft.sections.flatMap((s) => {
    if (!s?.heading) return []
    const paragraphs = s.paragraphs.map(sentences).filter(Boolean)
    const bullets = s.bullets.filter(grounded)
    return paragraphs.length || bullets.length ? [{ heading: s.heading, paragraphs, bullets }] : []
  })
  const title = draft.title && grounded(draft.title) ? draft.title : 'Energy and sustainability report'
  return { title, sections, removed }
}

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const limited = rateLimit(req, 6)
  if (limited) return limited
  const body = await readBody(req, z.object({ facts: z.record(z.string(), z.unknown()) }), 60_000)
  if (body instanceof Response) return body
  try {
    const { title, sections, removed } = keepGrounded(await chatJson({ workspace: id, task: 'report' }, SYSTEM, JSON.stringify(body.facts), Out), body.facts)
    if (removed) logJson('info', 'report sentences removed', { workspace: id, removed })
    if (sections.length < 4) return json({ error: 'AI report too thin' }, 502)
    return json({ title, sections })
  } catch (e) {
    return aiFailure(e, 'report', { workspace: id })
  }
}
