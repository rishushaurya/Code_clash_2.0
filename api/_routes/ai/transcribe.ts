// POST /api/ai/transcribe?lang=en|hi|kn  (Bearer token)  body: recorded audio  ->  { text }
// Voice for Set up with AI and the Assistant, in every browser: the page records with MediaRecorder and this
// route writes it down with the workspace's speech key (Groq Whisper, OpenAI transcription, or a custom
// OpenAI-compatible server). The browsers' own speech recognition is missing in Firefox and switched off in
// Brave. The audio is passed through and never stored.

import { json, rateLimit, requireWorkspace } from '../../_lib/http.js'
import { aiFailure, transcribeAudio } from '../../_lib/llm.js'

const TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']
/** Vercel accepts request bodies up to 4.5 MB; at the 32 kbit/s the page records, that is about 15 minutes */
const MAX_BYTES = 4_000_000

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const limited = rateLimit(req, 10)
  if (limited) return limited
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!TYPES.includes(type)) return json({ error: 'Send recorded audio (webm, ogg, mp4, mp3 or wav)' }, 415)
  const audio = await req.arrayBuffer()
  if (!audio.byteLength) return json({ error: 'The recording is empty' }, 400)
  if (audio.byteLength > MAX_BYTES) return json({ error: 'The recording is too long; speak in shorter parts' }, 413)
  try {
    return json({ text: await transcribeAudio({ workspace: id }, audio, type, new URL(req.url).searchParams.get('lang') ?? '') })
  } catch (e) {
    return aiFailure(e, 'transcribe', { workspace: id })
  }
}
