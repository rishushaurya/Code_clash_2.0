// Copies the WebAssembly runtimes into public/ so they are served from this site (the CSP allows only 'self'
// for scripts) and work offline on stage: MediaPipe for computer vision, ONNX Runtime for the Assistant's voice.
import { cpSync, existsSync, mkdirSync } from 'node:fs'

const from = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(from)) cpSync(from, 'public/mediapipe/wasm', { recursive: true })

const ort = 'node_modules/@huggingface/transformers/dist'
if (existsSync(ort)) {
  mkdirSync('public/ort', { recursive: true })
  for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) cpSync(`${ort}/${f}`, `public/ort/${f}`)
}
