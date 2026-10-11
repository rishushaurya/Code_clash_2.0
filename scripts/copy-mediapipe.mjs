// Copies MediaPipe's WebAssembly runtime into public/ so computer vision works offline on stage.
import { cpSync, existsSync } from 'node:fs'

const from = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(from)) cpSync(from, 'public/mediapipe/wasm', { recursive: true })
