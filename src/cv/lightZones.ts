// Device zones without machine learning. Lights and screens: the mean brightness of a marked box,
// compared with its "on" and "off" references, with a hysteresis band against flicker.
// Fans: how much the box changes between frames.

import type { CameraZone } from '@/shared/types'
import { CALIBRATION_MIN_GAP, LIGHT_HYSTERESIS } from '@/shared/config'

/** A camera zone while it runs: the saved settings plus what the camera measures now */
export interface Zone extends Omit<CameraZone, 'kind'> {
  on?: boolean
  /** Latest measured value: brightness, or motion for fan zones */
  lum?: number
  /** brightness for lights and screens, motion for fans */
  kind?: CameraZone['kind']
}

/** An RGBA picture: ImageData in the browser, a plain object in tests */
export type Frame = Pick<ImageData, 'width' | 'height' | 'data'>

/** Mean luminance (0-255) of a zone in an RGBA frame */
export function meanLuminance(frame: Frame, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>) {
  const x0 = Math.floor(z.x * frame.width)
  const y0 = Math.floor(z.y * frame.height)
  const x1 = Math.ceil((z.x + z.w) * frame.width)
  const y1 = Math.ceil((z.y + z.h) * frame.height)
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4
      sum += 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2]
      n++
    }
  }
  return n ? sum / n : 0
}

/** On and off recordings at least CALIBRATION_MIN_GAP apart: the one rule the marking panel and the classifier share */
export const isCalibrated = (z: Pick<Zone, 'onRef' | 'offRef'>) => z.onRef !== undefined && z.offRef !== undefined && Math.abs(z.onRef - z.offRef) >= CALIBRATION_MIN_GAP

/** The reference wall patch: brightness zones are read relative to it, so daylight and auto-exposure cancel out */
export const REF = 'REF'

/** A device zone that reports: marked, and calibrated unless it is a fan (fans also work from raw motion) */
export const zoneReady = (z: Pick<Zone, 'id' | 'kind' | 'w' | 'onRef' | 'offRef'>) => z.kind !== 'region' && z.id !== REF && z.w > 0 && (z.kind === 'motion' || isCalibrated(z))

/**
 * A brightness zone as a share of the reference patch, scaled so a zone as bright as the wall reads 64 and the
 * scale fits the 0-255 calibration range (a fixture up to four times the wall). Without a marked patch: raw luminance.
 */
export function relativeLuminance(zoneLum: number, refLum: number | undefined) {
  if (refLum === undefined) return zoneLum
  return Math.min(255, (64 * zoneLum) / Math.max(refLum, 1))
}

/** On above the midpoint plus the band, off below it minus the band, unchanged in between */
export function classify(z: Zone, luminance: number): boolean | undefined {
  if (!isCalibrated(z)) return undefined
  const mid = (z.onRef! + z.offRef!) / 2
  const band = (Math.abs(z.onRef! - z.offRef!) * LIGHT_HYSTERESIS) / 2
  const brighterWhenOn = z.onRef! > z.offRef!
  const high = luminance > mid + band
  const low = luminance < mid - band
  if (high) return brighterWhenOn
  if (low) return !brighterWhenOn
  return z.on
}

export const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : 0
}

/** Mean absolute change (0-255) inside a zone between two frames: turning fan blades move, still ones do not. */
export function meanMotion(prev: Frame, frame: Frame, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>) {
  if (prev.width !== frame.width || prev.height !== frame.height) return 0
  const x0 = Math.floor(z.x * frame.width)
  const y0 = Math.floor(z.y * frame.height)
  const x1 = Math.ceil((z.x + z.w) * frame.width)
  const y1 = Math.ceil((z.y + z.h) * frame.height)
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4
      sum += Math.abs(frame.data[i + 1] - prev.data[i + 1]) // green channel carries most of the luminance
      n++
    }
  }
  return n ? sum / n : 0
}

/** Brightness zones need on/off references; motion zones also work uncalibrated with a default threshold. */
export function classifyZone(z: Zone, value: number, motionThreshold: number): boolean | undefined {
  if (isCalibrated(z)) return classify(z, value)
  return z.kind === 'motion' ? value > motionThreshold : undefined
}

/** A person counts when the bottom-centre of their box (their feet) is inside the room boundary. */
export function insideRegion(box: { x: number; y: number; w: number; h: number }, region: Zone | undefined, frameW: number, frameH: number) {
  if (!region?.w) return true
  const fx = (box.x + box.w / 2) / frameW
  const fy = (box.y + box.h) / frameH
  return fx >= region.x && fx <= region.x + region.w && fy >= region.y && fy <= region.y + region.h
}
