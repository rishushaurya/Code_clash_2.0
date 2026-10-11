// Grounding rule: code computes every number, the AI only writes words.
// Any money, kWh, kg, ppm, W or % figure in AI text must exist in the facts the AI was given.

// Money in any currency (symbol or ISO code before the number, or a currency word after it) and physical units.
const FIGURE =
  /(?:[₹$€£¥]|\b(?:rs\.?|inr|usd|eur|gbp|aed|sgd|aud|cad|jpy)\s*)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:kwh|kg|ppm|%|w\b|watts?|rupees|dollars|euros|pounds|dirhams|yen|tonnes?)/gi

/** Every number anywhere in the facts, including numbers inside strings such as "LH-1" */
export function factNumbers(facts: unknown, out: number[] = []): number[] {
  if (typeof facts === 'number' && Number.isFinite(facts)) out.push(facts)
  else if (typeof facts === 'string') for (const m of facts.match(/\d+(?:\.\d+)?/g) ?? []) out.push(Number(m))
  else if (Array.isArray(facts)) for (const v of facts) factNumbers(v, out)
  else if (facts && typeof facts === 'object') for (const v of Object.values(facts)) factNumbers(v, out)
  return out
}

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** A quoted figure is grounded if it equals a fact, or a fact rounded to 0, 1 or 2 decimals. */
const grounded = (v: number, facts: number[]) => facts.some((f) => f === v || [0, 1, 2].some((d) => roundTo(f, d) === v))

/** Returns the figures in `text` that are not backed by `facts`. Empty means the text is grounded. */
export function ungroundedFigures(text: string, facts: unknown, allowed: number[] = []): string[] {
  const nums = [...factNumbers(facts), ...allowed]
  const bad: string[] = []
  for (const m of text.matchAll(FIGURE)) {
    const v = Number((m[1] ?? m[2]).replaceAll(',', ''))
    if (!grounded(v, nums)) bad.push(m[0].trim())
  }
  return bad
}

/** Constants the AI may always quote: the 1000 ppm indoor CO2 guideline and BEE's 6 % AC saving per degree */
export const ALWAYS_ALLOWED = [1000, 6]
