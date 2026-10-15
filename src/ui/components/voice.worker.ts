// The Assistant's natural voice: Kokoro-82M (hexgrad, Apache-2.0) through kokoro-js, running in this worker so
// the page never stutters. The model downloads once from Hugging Face and the browser caches it; text never
// leaves the device. WebGPU on computers that have it, WebAssembly everywhere else.

import { env, KokoroTTS } from 'kokoro-js'

// The ONNX runtime is served from this site (scripts/copy-mediapipe.mjs), not a CDN.
env.wasmPaths = '/ort/'

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
type Voice = keyof KokoroTTS['voices']

const gpu = 'gpu' in navigator && !/Mobi|Android/i.test(navigator.userAgent)
let tts: Promise<KokoroTTS> | null = null
const load = () =>
  (tts ??= KokoroTTS.from_pretrained(MODEL, {
    // WebGPU wants full precision (kokoro-js README); about 90 MB quantised on WebAssembly.
    ...(gpu ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' }),
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) postMessage({ progress: Math.round(p.progress ?? 0) })
    },
  }))

// One sentence at a time: the model runs one inference at once, so requests queue.
let queue = Promise.resolve()
self.onmessage = (e: MessageEvent<{ id: number; text?: string; voice?: Voice; speed?: number }>) => {
  const { id, text, voice, speed } = e.data
  queue = queue.then(async () => {
    try {
      const model = await load()
      if (!text) return postMessage({ id, ready: true })
      const out = await model.generate(text, { voice, speed })
      const audio = out.audio as Float32Array<ArrayBuffer>
      postMessage({ id, audio, rate: out.sampling_rate }, { transfer: [audio.buffer] })
    } catch (err) {
      tts = null
      postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
  })
}
