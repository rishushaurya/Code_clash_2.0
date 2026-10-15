// Voice in and out. In: record with MediaRecorder, then the server writes it down (api/_routes/ai/transcribe.ts),
// so it works in every browser; in a conversation the recording ends by itself when the person stops talking.
// Out: English answers in a natural human voice (Kokoro-82M, on this device, voice.worker.ts), one sentence at a
// time so the first words start quickly; Hindi and Kannada, or before the voice has downloaded, use the most
// natural voice the device has.

import { create } from 'zustand'

export const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'

/** Silence after speech that ends a hands-free question, and the level that counts as speech (RMS, 0 to 1) */
const SILENCE_MS = 1300
const SPEECH_RMS = 0.02

/**
 * Starts recording from the microphone. `stop()` ends it and returns the audio; it also ends by itself after
 * `maxMs`, or, with `untilSilence`, once the person has spoken and then stayed quiet. `done` resolves either way.
 */
export async function startRecording(maxMs = 180_000, { untilSilence = false } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
  // 32 kbit/s keeps speech clear and a long description under the server's upload limit.
  const rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  let watch: ReturnType<typeof setInterval> | undefined
  let meter: AudioContext | undefined
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      clearInterval(watch)
      void meter?.close()
      stream.getTracks().forEach((t) => t.stop())
      resolve(new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'audio/webm' }))
    }
  })
  rec.start(1000)
  const stop = () => rec.state !== 'inactive' && rec.stop()
  const timer = setTimeout(stop, maxMs)
  if (untilSilence) {
    meter = new AudioContext()
    const analyser = meter.createAnalyser()
    meter.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let heard = false
    let quietSince = 0
    watch = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length)
      if (rms > SPEECH_RMS) {
        heard = true
        quietSince = 0
      } else if (heard) {
        quietSince ||= Date.now()
        if (Date.now() - quietSince > SILENCE_MS) stop()
      }
    }, 100)
  }
  return {
    done,
    stop() {
      clearTimeout(timer)
      stop()
      return done
    },
  }
}

/** Why the microphone could not start, in words a person can act on */
export function micError(e: unknown) {
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError') return 'Microphone permission is off. Allow it in the address bar, then press Speak again.'
  if (name === 'NotFoundError') return 'No microphone was found on this device.'
  return 'The microphone could not start. You can type instead.'
}

/** Why voice input failed: the microphone, a missing speech key, or the provider's reason */
export function voiceError(e: unknown) {
  const name = e instanceof Error ? e.name : ''
  if (['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(name)) return micError(e)
  const message = e instanceof Error ? e.message : ''
  if (message.startsWith('Add an AI key')) return 'Voice needs a Groq or OpenAI key in Settings, Keys and AI. You can type instead.'
  if (message && !message.startsWith('/api') && !message.startsWith('offline')) return `${message}. You can type instead.`
  return 'The voice service is not available just now. You can type instead.'
}

// ---- Speaking ----

/** The best-graded Kokoro voices (kokoro-js README): two American, one British, one male */
export const VOICES = [
  { id: 'af_heart', label: 'Heart, warm' },
  { id: 'af_bella', label: 'Bella, bright' },
  { id: 'bf_emma', label: 'Emma, British' },
  { id: 'am_michael', label: 'Michael, calm' },
] as const
export type VoiceId = (typeof VOICES)[number]['id']

const VOICE_KEY = 'pratibimb:assistant-voice'
const readVoice = (): VoiceId => {
  try {
    const v = localStorage.getItem(VOICE_KEY)
    return VOICES.find((x) => x.id === v)?.id ?? 'af_heart'
  } catch {
    return 'af_heart'
  }
}

/** idle: not downloaded yet; loading: downloading or starting (progress in percent); ready; failed: the device voice is used */
export const useVoice = create<{ voice: VoiceId; state: 'idle' | 'loading' | 'ready' | 'failed'; progress: number; speaking: boolean }>(() => ({
  voice: typeof localStorage === 'undefined' ? 'af_heart' : readVoice(),
  state: 'idle',
  progress: 0,
  speaking: false,
}))

export function chooseVoice(voice: VoiceId) {
  useVoice.setState({ voice })
  try {
    localStorage.setItem(VOICE_KEY, voice)
  } catch {
    // The choice lasts for this page.
  }
}

/** Words a voice reads well: units and symbols spelled out, room ids letter by letter */
export function forSpeech(text: string) {
  return text
    .replace(/\b([A-Z]{1,4})-(\d+)\b/g, (_, l: string, n: string) => `${l.split('').join(' ')} ${n}`)
    .replace(/₹\s?/g, 'rupees ')
    .replace(/\bkWh\b/g, 'kilowatt hours')
    .replace(/(\d)\s?kW\b/g, '$1 kilowatts')
    .replace(/(\d)\s?W\b/g, '$1 watts')
    .replace(/\bCO2\b|CO₂/g, 'C O 2')
    .replace(/\bppm\b/g, 'parts per million')
    .replace(/\/\s?(hr|hour)\b/g, ' an hour')
    .replace(/\/\s?month\b/g, ' a month')
    .replace(/(\d)\s?%/g, '$1 percent')
    .replace(/\s?°\s?C\b/g, ' degrees')
}

/** Sentences to speak one by one; very short ones join the next so the rhythm stays natural */
export function sentences(text: string) {
  const parts = text.match(/[^.!?\n]+[.!?]+["')\]]*|[^.!?\n]+$/gm)?.map((s) => s.trim()).filter(Boolean) ?? []
  const out: string[] = []
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < 30) out[out.length - 1] += ` ${p}`
    else out.push(p)
  }
  return out
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: { audio?: Float32Array<ArrayBuffer>; rate?: number }) => void; reject: (e: Error) => void }>()

function call(msg: { text?: string; voice?: VoiceId }) {
  if (!worker) {
    worker = new Worker(new URL('./voice.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const d = e.data
      if (d.progress !== undefined) return useVoice.setState({ progress: d.progress })
      const p = pending.get(d.id)
      pending.delete(d.id)
      if (d.error) p?.reject(new Error(d.error))
      else p?.resolve(d)
    }
    worker.onerror = () => {
      useVoice.setState({ state: 'failed' })
      pending.forEach((p) => p.reject(new Error('voice worker failed')))
      pending.clear()
    }
  }
  const id = ++seq
  return new Promise<{ audio?: Float32Array<ArrayBuffer>; rate?: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ id, ...msg })
  })
}

/** Download and start the natural voice in the background (once; the browser caches the model) */
export function prepareVoice() {
  if (useVoice.getState().state !== 'idle' || typeof Worker === 'undefined') return
  useVoice.setState({ state: 'loading', progress: 0 })
  call({})
    .then(() => useVoice.setState({ state: 'ready' }))
    .catch(() => useVoice.setState({ state: 'failed' }))
}

let token = 0
let ctx: AudioContext | null = null
let playing: AudioBufferSourceNode[] = []

export function stopSpeaking() {
  token++
  playing.forEach((s) => {
    try {
      s.stop()
    } catch {
      // Already ended.
    }
  })
  playing = []
  try {
    speechSynthesis.cancel()
  } catch {
    // No speech output on this device.
  }
  useVoice.setState({ speaking: false })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Plays each sentence as soon as it is ready while the next one is being made; a short breath between them */
async function speakNatural(text: string, voice: VoiceId, mine: number) {
  ctx ??= new AudioContext()
  await ctx.resume()
  const parts = sentences(text)
  let at = 0
  let next = call({ text: parts[0], voice })
  for (let i = 0; i < parts.length; i++) {
    const r = await next
    if (i + 1 < parts.length) next = call({ text: parts[i + 1], voice })
    if (mine !== token || !r.audio || !r.rate) return
    const buf = ctx.createBuffer(1, r.audio.length, r.rate)
    buf.copyToChannel(r.audio, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    at = Math.max(at, ctx.currentTime + 0.02)
    src.start(at)
    playing.push(src)
    at += buf.duration + 0.18
  }
  await wait(Math.max(0, (at - ctx.currentTime) * 1000))
}

/** The most natural voice this device offers for the language: neural or online voices first */
function deviceVoice(lang: string) {
  const base = lang.split('-')[0].toLowerCase()
  const score = (v: SpeechSynthesisVoice) => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 4 : 0) + (/google|microsoft/i.test(v.name) ? 2 : 0) + (v.lang.toLowerCase() === lang.toLowerCase() ? 1 : 0)
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(base))
    .sort((a, b) => score(b) - score(a))[0]
}

function speakDevice(text: string, lang: string) {
  return new Promise<void>((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      const v = deviceVoice(lang)
      if (v) u.voice = v
      u.onend = u.onerror = () => resolve()
      speechSynthesis.speak(u)
    } catch {
      resolve()
    }
  })
}

/**
 * Read text aloud, if the device can; the text is on screen either way. Resolves when the voice has finished
 * (or was stopped), so a conversation can listen again right after.
 */
export async function speak(text: string, lang = 'en-IN') {
  stopSpeaking()
  const mine = token
  const said = forSpeech(text)
  const { state, voice } = useVoice.getState()
  useVoice.setState({ speaking: true })
  try {
    if (lang.startsWith('en') && state === 'ready') await speakNatural(said, voice, mine)
    else {
      if (lang.startsWith('en')) prepareVoice()
      await speakDevice(said, lang)
    }
  } catch {
    // The natural voice failed before saying anything: say it with the device's voice instead.
    if (mine === token && !playing.length) await speakDevice(said, lang)
  } finally {
    if (mine === token) useVoice.setState({ speaking: false })
  }
}
