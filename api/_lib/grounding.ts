// Grounding rule: code computes every number, the AI only writes words.
// Any money, energy, power, mass, CO2, percentage, temperature or people figure in AI text must exist in the
// facts the AI was given. When the text says the period ("a week", "per month", "today"), the fact it quotes
// must be for that period too: facts carry the period in their key names (monthlySavingCost, kwhToday).

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`
const UNIT = String.raw`(kwh|kw\b|kg|tonnes?\b|ppm|%|percent\b|w\b|watts?\b|°\s*c\b|degrees?(?:\s*(?:c\b|celsius))?|celsius|people\b|persons?\b|students\b|occupants\b|seats\b|rupees|dollars|euros|pounds|dirhams|yen)`
// Money in any currency (symbol or ISO code before the number, or a currency word after it) and physical units.
const FIGURE = new RegExp(String.raw`(?:[₹$€£¥]|\b(?:rs\.?|inr|usd|eur|gbp|aed|sgd|aud|cad|jpy)\s*)${NUM}|${NUM}\s*${UNIT}`, 'gi')

type Kind = 'money' | 'air' | 'percent' | 'temp' | 'other'
const kindOf = (unit: string | undefined): Kind => {
  if (!unit) return 'money'
  const u = unit.toLowerCase()
  if (u === 'ppm') return 'air'
  if (u === '%' || u === 'percent') return 'percent'
  if (u.startsWith('°') || u.startsWith('degree') || u === 'celsius') return 'temp'
  if (/rupees|dollars|euros|pounds|dirhams|yen/.test(u)) return 'money'
  return 'other'
}

/** Constants the AI may always quote, each only in its own unit: the 1000 ppm indoor CO2 guideline, BEE's 6 % AC saving per degree, and BEE's 24 °C default AC setting */
const CONSTANTS: Partial<Record<Kind, number[]>> = { air: [1000], percent: [6], temp: [24] }

type Period = 'hour' | 'day' | 'week' | 'month' | 'year'
const PERIOD_WORDS: [RegExp, Period][] = [
  [/^(hour|hourly|hr)$/i, 'hour'],
  [/^(day|daily|today)$/i, 'day'],
  [/^(week|weekly)$/i, 'week'],
  [/^(month|monthly)$/i, 'month'],
  [/^(year|yearly|annual|annually)$/i, 'year'],
]
const periodOfWord = (w: string) => PERIOD_WORDS.find(([re]) => re.test(w))?.[1]
/** The period a fact's key path names: monthlySavingCost -> month, modelledWeekBaseline.cost.p50 -> week */
const periodOfPath = (path: string) => {
  for (const w of path.split(/[.\s]|(?=[A-Z])/)) {
    const p = periodOfWord(w)
    if (p) return p
  }
}
/** The period said right after a figure ("a month", "per week", "today"), or else just before it ("a monthly saving of") */
const PERIOD_AFTER = /^[^.;\d]{0,24}?\b(?:a|an|per|each|every|this|last|over the|in the|\/)?\s*(hour|hr|day|today|week|month|year)\b|^\s*(hourly|daily|weekly|monthly|yearly|annually)\b/i
const PERIOD_BEFORE = /\b(hourly|daily|weekly|monthly|yearly|annual)\b[^.;\d]{0,24}$/i

interface Fact {
  value: number
  path: string
}

/** Every number anywhere in the facts with its key path, including numbers inside strings such as "LH-1" */
export function factEntries(facts: unknown, path = '', out: Fact[] = []): Fact[] {
  if (typeof facts === 'number' && Number.isFinite(facts)) out.push({ value: facts, path })
  else if (typeof facts === 'string') for (const m of facts.match(/\d+(?:\.\d+)?/g) ?? []) out.push({ value: Number(m), path })
  else if (Array.isArray(facts)) for (const v of facts) factEntries(v, path, out)
  else if (facts && typeof facts === 'object') for (const [k, v] of Object.entries(facts)) factEntries(v, path ? `${path}.${k}` : k, out)
  return out
}

/** Every number anywhere in the facts */
export const factNumbers = (facts: unknown) => factEntries(facts).map((f) => f.value)

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
/** A quoted figure matches a fact if it equals it, or the fact rounded to 0, 1 or 2 decimals */
const matches = (v: number, f: number) => f === v || [0, 1, 2].some((d) => roundTo(f, d) === v)

/** Returns the figures in `text` that are not backed by `facts`. Empty means the text is grounded. */
export function ungroundedFigures(text: string, facts: unknown, allowed: number[] = []): string[] {
  const entries = factEntries(facts)
  const bad: string[] = []
  for (const m of text.matchAll(FIGURE)) {
    const v = Number((m[1] ?? m[2]).replaceAll(',', ''))
    const kind = kindOf(m[3])
    if ([...(CONSTANTS[kind] ?? []), ...allowed].includes(v)) continue
    const found = entries.filter((f) => matches(v, f.value))
    if (!found.length) {
      bad.push(m[0].trim())
      continue
    }
    const end = m.index + m[0].length
    const said = PERIOD_AFTER.exec(text.slice(end, end + 40)) ?? PERIOD_BEFORE.exec(text.slice(Math.max(0, m.index - 40), m.index))
    const period = said && periodOfWord((said[1] ?? said[2]).toLowerCase())
    // A fact with no period in its name (a range, a live value) cannot contradict the word.
    if (period && !found.some((f) => [undefined, period].includes(periodOfPath(f.path)))) {
      bad.push(`${m[0].trim()} ${said[0].trim()} (the facts give it per ${periodOfPath(found[0].path)})`)
    }
  }
  return bad
}
