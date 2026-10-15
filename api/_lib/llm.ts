// Every AI call goes through here, with the workspace's own keys: aiCandidates() (api/_lib/keys.ts) gives the
// ordered list of provider, model and key for a task, and each is tried in turn with a plain fetch.
//   - groq, openai, openrouter, custom: OpenAI-compatible chat completions with a Bearer key;
//   - gemini: its own generateContent API with the x-goog-api-key header (takes AIza and AQ. keys);
//   - anthropic: the Messages API with x-api-key and anthropic-version.
// Errors name the provider and the HTTP status ("Your OpenAI key was refused (401)"), never the key.

import type { z } from 'zod'
import type { AiProvider, AiTask } from '../../src/shared/types'
import { json, logJson } from './http.js'
import { aiCandidates, type AiCandidate } from './keys.js'

/** Which workspace pays for the call, and what it is for (each task can use its own provider and model) */
export interface AiCall {
  workspace: string
  task: AiTask
}

const NAMES: Record<AiProvider, string> = { groq: 'Groq', gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter', custom: 'custom AI server' }

/** Used only when the workspace's AI settings leave the model empty; checked against each provider's model list */
const DEFAULT_MODEL: Record<AiProvider, string> = {
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-flash-latest',
  openai: 'gpt-6-luna',
  anthropic: 'claude-opus-5-5',
  openrouter: 'openrouter/auto',
  custom: '',
}
const DEFAULT_URL: Partial<Record<AiProvider, string>> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
}
const SPEECH_MODEL: Partial<Record<AiProvider, string>> = { groq: 'whisper-large-v3-turbo', openai: 'gpt-transcribe' }

/** A failure in words a customer can act on. Never contains a key. */
export class AiError extends Error {}
/** The workspace has no key for this task, and the deployment's keys are off or missing */
export class NoAiKey extends Error {
  constructor() {
    super('Add an AI key in Settings, Keys and AI')
  }
}

/** Whether the deployment has keys of its own; /api/status reports it */
export const aiConfigured = () => Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)

const modelOf = (c: AiCandidate) => c.model.trim() || DEFAULT_MODEL[c.provider]
const urlOf = (c: AiCandidate) => {
  if (c.provider === 'gemini') return c.url || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelOf(c))}:generateContent`
  return c.url || DEFAULT_URL[c.provider] || ''
}

/** Turns an HTTP failure into a sentence; the provider's body goes to the log only, with the key cut out */
async function refused(c: AiCandidate, res: Response) {
  const body = (await res.text().catch(() => '')).replaceAll(c.apiKey, '[key]').slice(0, 200)
  logJson('warn', 'ai provider error', { provider: c.provider, owner: c.owner, model: modelOf(c), status: res.status, body })
  const whose = c.owner === 'workspace' ? `Your ${NAMES[c.provider]} key` : `The built-in ${NAMES[c.provider]} key`
  const s = res.status
  if (s === 401 || s === 403) return new AiError(`${whose} was refused (${s})`)
  if (s === 402) return new AiError(`${whose} has no credit left (402)`)
  if (s === 429) return new AiError(`${whose} hit its rate limit (429); try again in a minute`)
  if (s === 404) return new AiError(`${NAMES[c.provider]} does not offer the model "${modelOf(c)}" (404)`)
  if (s >= 500) return new AiError(`${NAMES[c.provider]} is busy or down (${s})`)
  return new AiError(`${NAMES[c.provider]} rejected the request (${s})`)
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type Message = { role: 'system' | 'user' | 'assistant'; content: string | Part[] }

const dataUrl = (url: string) => {
  const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(url) ?? []
  return { mimeType, data }
}
const parts = (m: Message): Part[] => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content)
const systemOf = (messages: Message[]) => String(messages.find((m) => m.role === 'system')?.content ?? '')

async function post(c: AiCandidate, url: string, headers: Record<string, string>, body: unknown, ms: number) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }).catch((e: Error) => {
    throw new AiError(e.name === 'TimeoutError' ? `${NAMES[c.provider]} took too long to answer` : `${NAMES[c.provider]} could not be reached`)
  })
  if (!res.ok) throw await refused(c, res)
  return res.json()
}

/** Gemini's own format: a system instruction, user and model turns, images inline */
async function callGemini(c: AiCandidate, messages: Message[]) {
  const part = (p: Part) => (p.type === 'text' ? { text: p.text } : { inlineData: dataUrl(p.image_url.url) })
  const data = (await post(
    c,
    urlOf(c),
    { 'x-goog-api-key': c.apiKey },
    {
      systemInstruction: { parts: [{ text: systemOf(messages) }] },
      contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts(m).map(part) })),
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    },
    // Short enough that an overloaded model leaves time for the next one.
    15_000,
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return data.candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('') ?? ''
}

/**
 * Anthropic's Messages API. Current Claude models think adaptively and cannot switch it off, so effort is low
 * for these short answers; older models that reject the effort setting get none. JSON comes from the prompt
 * (prefill is not accepted by current models), and parseJson() reads it out of any surrounding text.
 */
async function callAnthropic(c: AiCandidate, messages: Message[]) {
  const model = modelOf(c)
  const content = (m: Message) =>
    parts(m).map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: dataUrl(p.image_url.url).mimeType, data: dataUrl(p.image_url.url).data } }))
  // seniordev: model-name check for effort support; drop it when every model the customers pick accepts effort.
  const noEffort = /claude-3|haiku-4|sonnet-4-5/.test(model)
  // The default model gets Anthropic's server-side fallback when its safety classifier declines a request.
  const fallback = model === DEFAULT_MODEL.anthropic
  const data = (await post(
    c,
    urlOf(c),
    { 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', ...(fallback && { 'anthropic-beta': 'server-side-fallback-2026-07-01' }) },
    {
      model,
      max_tokens: 16000,
      system: systemOf(messages),
      messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: content(m) })),
      ...(!noEffort && { output_config: { effort: 'low' } }),
      ...(fallback && { fallbacks: 'default' }),
    },
    30_000,
  )) as { content?: { type: string; text?: string }[]; stop_reason?: string }
  if (data.stop_reason === 'refusal') throw new AiError('Anthropic declined to answer this request')
  return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

/** Groq, OpenAI, OpenRouter and any OpenAI-compatible server */
async function callOpenAi(c: AiCandidate, messages: Message[]) {
  const data = (await post(
    c,
    urlOf(c),
    { authorization: `Bearer ${c.apiKey}` },
    // OpenAI's reasoning models accept only the default temperature, so it is set for Groq alone.
    { model: modelOf(c), messages, response_format: { type: 'json_object' }, ...(c.provider === 'groq' && { temperature: 0.2 }) },
    20_000,
  )) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

const call = (c: AiCandidate, messages: Message[]) => (c.provider === 'gemini' ? callGemini(c, messages) : c.provider === 'anthropic' ? callAnthropic(c, messages) : callOpenAi(c, messages))

/** The JSON object in a reply, also when a model wraps it in a code fence or a sentence */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new AiError('The AI did not answer in the expected format')
    return JSON.parse(raw.slice(start, end + 1))
  }
}

async function candidates(ai: AiCall) {
  const list = (await aiCandidates(ai.workspace, ai.task)).filter((c) => c.apiKey && urlOf(c) && modelOf(c))
  if (!list.length) throw new NoAiKey()
  return list
}

/**
 * Ask for JSON, validate it with `schema`, and run `check` (for example the grounding rule).
 * A failed check gets one retry with the problems listed; then the next candidate is tried.
 */
export async function chatJson<T>(ai: AiCall, system: string, user: string, schema: z.ZodType<T>, check: (v: T) => string[] = () => [], image?: string): Promise<T> {
  const errors: string[] = []
  for (const c of await candidates(ai)) {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] : user },
    ]
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await call(c, messages)
        const parsed = schema.safeParse(parseJson(raw))
        const problems = parsed.success ? check(parsed.data) : [parsed.error.message.slice(0, 300)]
        if (parsed.success && !problems.length) return parsed.data
        messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `Fix these problems and answer again with JSON only: ${problems.join('; ')}` })
        if (attempt) errors.push(`${NAMES[c.provider]} gave an answer that failed the checks`)
      } catch (e) {
        errors.push(e instanceof AiError ? e.message : `${NAMES[c.provider]} gave an unreadable answer`)
        break
      }
    }
  }
  throw new AiError([...new Set(errors)].join('; '))
}

const AUDIO_EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }

/** Speech to text with Groq Whisper, OpenAI transcription, or a custom OpenAI-compatible server */
export async function transcribeAudio(ai: Omit<AiCall, 'task'>, audio: ArrayBuffer, type: string, lang: string) {
  const list = (await candidates({ ...ai, task: 'speech' }).catch(() => [])).filter((c) => ['groq', 'openai', 'custom'].includes(c.provider))
  if (!list.length) throw new NoAiKey()
  const errors: string[] = []
  for (const c of list) {
    const url = (c.url || DEFAULT_URL[c.provider]!).replace(/\/chat\/completions\/?$/, '/audio/transcriptions')
    const form = new FormData()
    form.append('file', new Blob([audio], { type }), `speech.${AUDIO_EXT[type] ?? 'webm'}`)
    form.append('model', c.model.trim() || SPEECH_MODEL[c.provider] || '')
    if (['en', 'hi', 'kn'].includes(lang)) form.append('language', lang)
    form.append('response_format', 'json')
    try {
      const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${c.apiKey}` }, body: form, signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw await refused(c, res)
      const { text } = (await res.json()) as { text?: unknown }
      return typeof text === 'string' ? text.trim().slice(0, 8000) : ''
    } catch (e) {
      errors.push(e instanceof AiError ? e.message : `${NAMES[c.provider]} could not be reached`)
    }
  }
  throw new AiError(errors.join('; '))
}

/** The response an AI route sends when a call fails: 503 with the Settings hint when no key, else the reason */
export function aiFailure(e: unknown, where: string, meta: Record<string, unknown> = {}) {
  if (e instanceof NoAiKey) return json({ error: e.message, code: 'no-key' }, 503)
  logJson('warn', `${where} failed`, { ...meta, error: String(e).slice(0, 300) })
  return json({ error: e instanceof AiError && e.message ? e.message : 'AI unavailable' }, 502)
}
