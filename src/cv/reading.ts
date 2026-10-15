// What a camera sends every 2 s, and when it must stay silent. A camera that has not detected yet, or whose
// picture stopped (unplugged, frozen, muted stream), sends nothing, so the twin marks it offline instead of
// trusting an old head-count.

import type { CameraSourceKind, CvReading } from '@/shared/types'
import { median, zoneReady, type Zone } from './lightZones'

/** No detection for this long: the picture has stopped and readings stop with it */
export const DETECTION_STALE_MS = 3000

export interface Measured {
  roomId: string
  cameraId: string
  sourceKind: CameraSourceKind
  /** People counted in the last detections, newest last */
  counts: number[]
  /** Scores of the people counted in the latest detection */
  scores: number[]
  /** The best person candidate the detector rejected in the latest detection */
  nearMiss: number
  zones: Zone[]
  /** When a detection last ran (ms), undefined before the first */
  lastDetectAt: number | undefined
}

/**
 * Confidence of the head-count: the mean score of the people counted; with nobody counted, how sure the detector
 * is that nobody is there (one minus its best rejected candidate).
 */
export const confidenceOf = (scores: number[], nearMiss: number) => Number((scores.length ? scores.reduce((a, s) => a + s, 0) / scores.length : 1 - nearMiss).toFixed(2))

export function buildReading(m: Measured, now: number): CvReading | null {
  if (m.lastDetectAt === undefined || !m.counts.length || now - m.lastDetectAt > DETECTION_STALE_MS) return null
  const zones: Record<string, boolean> = {}
  for (const z of m.zones) if (z.on !== undefined && zoneReady({ ...z, kind: z.kind ?? 'brightness' })) zones[z.id] = z.on
  return {
    roomId: m.roomId,
    cameraId: m.cameraId,
    sourceKind: m.sourceKind,
    ts: now,
    headcount: median(m.counts),
    zones,
    confidence: confidenceOf(m.scores, m.nearMiss),
  }
}
