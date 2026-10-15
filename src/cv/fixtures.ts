// Finds fixtures in the picture so nobody has to draw every box by hand. All of it runs on small frames in this
// browser; no frame leaves the device.
// Lights: the person switches them off, then on; what got brighter is a light. Fans: ten seconds of the fan
// running; what keeps changing is a fan. Screens: the detector's COCO `tv` and `laptop` boxes.

import type { Frame } from './lightZones'

export interface Found {
  /** Fractions of the picture, 0 to 1 */
  x: number
  y: number
  w: number
  h: number
}

/** Grid cell in pixels of the 320 px probe frame: 80 x 45 cells, coarse enough to ignore noise */
const CELL = 4
/** Smallest fixture, in cells (a ceiling tube far away still covers a few) */
const MIN_CELLS = 3
/** At most this many proposals: a room's lights rarely exceed it, and more is noise */
const MAX_FOUND = 12

/** Average of several frames of one size, so a single noisy frame does not decide */
export function averageFrames(frames: Frame[]): Frame {
  const { width, height } = frames[0]
  const sum = new Float32Array(width * height * 4)
  for (const f of frames) for (let i = 0; i < sum.length; i++) sum[i] += f.data[i]
  const data = new Uint8ClampedArray(sum.length)
  for (let i = 0; i < sum.length; i++) data[i] = sum[i] / frames.length
  return { width, height, data }
}

/** Per-cell value grid of a frame, from a per-pixel function */
function grid(frame: Frame, pixel: (i: number) => number) {
  const cols = Math.floor(frame.width / CELL)
  const rows = Math.floor(frame.height / CELL)
  const out = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let s = 0
      for (let y = r * CELL; y < (r + 1) * CELL; y++) for (let x = c * CELL; x < (c + 1) * CELL; x++) s += pixel((y * frame.width + x) * 4)
      out[r * cols + c] = s / (CELL * CELL)
    }
  return { cols, rows, out }
}

const luma = (d: Frame['data'], i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]

/**
 * Groups cells above `threshold` into blobs (8-connected) and answers their boxes, padded by one cell, largest first.
 * seniordev: plain flood fill on a 80x45 grid, a few thousand cells; a union-find pass if grids ever grow.
 */
export function blobs(values: Float32Array, cols: number, rows: number, threshold: number): Found[] {
  const seen = new Uint8Array(values.length)
  const found: (Found & { cells: number })[] = []
  for (let start = 0; start < values.length; start++) {
    if (seen[start] || values[start] < threshold) continue
    let [x0, y0, x1, y1, cells] = [cols, rows, 0, 0, 0]
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      const cx = i % cols
      const cy = (i - cx) / cols
      cells++
      ;[x0, y0, x1, y1] = [Math.min(x0, cx), Math.min(y0, cy), Math.max(x1, cx), Math.max(y1, cy)]
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          const n = ny * cols + nx
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[n] && values[n] >= threshold) {
            seen[n] = 1
            stack.push(n)
          }
        }
    }
    if (cells < MIN_CELLS) continue
    const px = Math.max(0, x0 - 1)
    const py = Math.max(0, y0 - 1)
    found.push({ x: px / cols, y: py / rows, w: (Math.min(cols, x1 + 2) - px) / cols, h: (Math.min(rows, y1 + 2) - py) / rows, cells })
  }
  return found
    .sort((a, b) => b.cells - a.cells)
    .slice(0, MAX_FOUND)
    .map(({ x, y, w, h }) => ({ x, y, w, h }))
}

/** Reading order: top to bottom in bands, then left to right, so L1, L2... map the way people count fixtures */
export const readingOrder = (found: Found[]) => [...found].sort((a, b) => Math.round((a.y + a.h / 2) * 4) - Math.round((b.y + b.h / 2) * 4) || a.x - b.x)

/**
 * Lights: what got clearly brighter between the "off" and "on" pictures. A cell counts when it brightened by at
 * least `minRise` (0-255) and by at least 40 % of the strongest rise, so one bright tube does not drown the rest.
 */
export function findLights(off: Frame, on: Frame, minRise = 30): Found[] {
  const a = grid(off, (i) => luma(off.data, i))
  const b = grid(on, (i) => luma(on.data, i))
  const rise = b.out.map((v, i) => v - a.out[i])
  const max = Math.max(0, ...rise)
  if (max < minRise) return []
  return readingOrder(blobs(rise, a.cols, a.rows, Math.max(minRise, max * 0.4)))
}

/**
 * Fans: the share of consecutive frame pairs in which each cell changed by more than `minChange` (0-255).
 * Turning blades change a cell nearly every time; a person walking by changes it once or twice, so they stay out.
 */
export function findMotion(frames: Frame[], minChange = 8, minShare = 0.5): Found[] {
  if (frames.length < 2) return []
  let share: Float32Array | null = null
  let size = { cols: 0, rows: 0 }
  for (let k = 1; k < frames.length; k++) {
    const prev = frames[k - 1]
    const cur = frames[k]
    const g = grid(cur, (i) => Math.abs(cur.data[i + 1] - prev.data[i + 1]))
    size = g
    const moved = g.out.map((v) => (v > minChange ? 1 / (frames.length - 1) : 0))
    share = share ? share.map((v, i) => v + moved[i]) : moved
  }
  return readingOrder(blobs(share!, size.cols, size.rows, minShare))
}

/** Screens: detector boxes (video pixels) as picture fractions, the frame that saw the most of them */
export function findScreens(seen: { x: number; y: number; w: number; h: number }[][], videoW: number, videoH: number): Found[] {
  const best = seen.reduce((a, b) => (b.length > a.length ? b : a), [])
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return readingOrder(best.map((b) => ({ x: clamp(b.x / videoW), y: clamp(b.y / videoH), w: clamp(b.w / videoW), h: clamp(b.h / videoH) })))
}
