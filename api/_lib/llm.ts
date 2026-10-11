// One function for both AI providers, each with a plain fetch: Groq through its OpenAI-compatible API,
// Gemini through its own generateContent API with the x-goog-api-key header, which accepts both the
// older AIza keys and the AQ. keys AI Studio issues now. Groq first (fast), Gemini when Groq fails.

import type { z } from 'zod'

interface Provider {
  name: 'groq' | 'gemini'
  url: string
  key?: string
  model: string
}

/** Text calls go to Groq first (fast on stage). Image calls go to Gemini first: it is trained to return boxes. */
const providers = (vision = false): Provider[] => {
  const groq: Provider = {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY,
    model: vision ? process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct' : process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  const gemini: Provider = {
    name: 'gemini',
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    key: process.env.GEMINI_API_KEY,
    model,
  }
  return vision ? [gemini, groq] : [groq, gemini]
}

export const aiConfigured = () => providers().some((p) => p.key)

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type Message = { role: 'system' | 'user' | 'assistant'; content: string | Part[] }

/** Gemini's own format: a system instruction, user and model turns, images inline */
async function callGemini(p: Provider, messages: Message[]) {
  const part = (c: Part) => {
    if (c.type === 'text') return { text: c.text }
    const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(c.image_url.url) ?? []
    return { inlineData: { mimeType, data } }
  }
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': p.key! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: messages.find((m) => m.role === 'system')?.content ?? '' }] },
      contents: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content.map(part) })),
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return data.candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('') ?? ''
}

async function call(p: Provider, messages: Message[]) {
  if (p.name === 'gemini') return callGemini(p, messages)
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ model: p.model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * Ask for JSON, validate it with `schema`, and run `check` (for example the grounding rule).
 * A failed check gets one retry with the problems listed; then the next provider is tried.
 */
export async function chatJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  check: (v: T) => string[] = () => [],
  image?: string,
): Promise<T> {
  const errors: string[] = []
  for (const p of providers(Boolean(image)).filter((x) => x.key)) {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] : user },
    ]
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await call(p, messages)
        const parsed = schema.safeParse(JSON.parse(raw))
        const problems = parsed.success ? check(parsed.data) : [parsed.error.message.slice(0, 300)]
        if (parsed.success && !problems.length) return parsed.data
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `Fix these problems and answer again with JSON only: ${problems.join('; ')}` })
        errors.push(`${p.name}: ${problems.join('; ')}`)
      } catch (e) {
        errors.push(String(e))
        break
      }
    }
  }
  throw new Error(errors.join(' | ') || 'No AI provider configured')
}
