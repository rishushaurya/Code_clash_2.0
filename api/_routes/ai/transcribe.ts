// POST /api/ai/transcribe?lang=en|hi|kn  (Bearer token)  body: recorded audio  ->  { text }
// Voice for Set up with AI and the Copilot, in every browser: the page records with MediaRecorder and this
// route writes it down with Groq's Whisper. (The browsers' own speech recognition is missing in Firefox and
// switched off in Brave.) The audio is passed through and never stored.

import { json, logJson, rateLimit, requireWorkspace } from '../../_lib/http.js'

const TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }
/** Vercel accepts request bodies up to 4.5 MB; at the 32 kbit/s the page records, that is about 15 minutes */
const MAX_BYTES = 4_000_000

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) return json({ error: 'Voice needs GROQ_API_KEY on the server' }, 503)
  const limited = rateLimit(req, 10)
  if (limited) return limited
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!TYPES[type]) return json({ error: 'Send recorded audio (webm, ogg, mp4, mp3 or wav)' }, 415)
  const audio = await req.arrayBuffer()
  if (!audio.byteLength) return json({ error: 'The recording is empty' }, 400)
  if (audio.byteLength > MAX_BYTES) return json({ error: 'The recording is too long; speak in shorter parts' }, 413)

  const lang = new URL(req.url).searchParams.get('lang') ?? ''
  const form = new FormData()
  form.append('file', new Blob([audio], { type }), `speech.${TYPES[type]}`)
  form.append('model', process.env.GROQ_TRANSCRIBE_MODEL?.trim() || 'whisper-large-v3-turbo')
  if (['en', 'hi', 'kn'].includes(lang)) form.append('language', lang)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => e)
  if (!(res instanceof Response) || !res.ok) {
    logJson('warn', 'transcribe failed', { workspace: id, status: res instanceof Response ? res.status : String(res).slice(0, 200) })
    return json({ error: 'The voice service is not available just now' }, 502)
  }
  const { text } = (await res.json()) as { text?: unknown }
  return json({ text: typeof text === 'string' ? text.trim().slice(0, 8000) : '' })
}
