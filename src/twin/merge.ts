// Several cameras can watch one room. Merge their latest readings into one view.

import { CAMERA_FRESH_MS } from '@/shared/config'
import type { CvReading, Room } from '@/shared/types'

export interface MergedView {
  headcount: number
  zones: Record<string, boolean>
  confidence: number
  cameras: number
}

/**
 * Head-count: 'max' when views overlap (no double counting), 'sum' when cameras split the room.
 * Zones (lights, fans, screens): on if any fresh camera sees them on. Stale cameras are ignored.
 */
export function mergeReadings(room: Room, latestByCamera: CvReading[], now: number): MergedView | null {
  const fresh = latestByCamera.filter((r) => r.roomId === room.id && now - r.ts <= CAMERA_FRESH_MS)
  if (!fresh.length) return null
  const counts = fresh.map((r) => r.headcount)
  const zones: Record<string, boolean> = {}
  for (const r of fresh) for (const [z, on] of Object.entries(r.zones)) zones[z] = zones[z] || on
  return {
    headcount: room.cameraMerge === 'sum' ? counts.reduce((a, b) => a + b, 0) : Math.max(...counts),
    zones,
    confidence: fresh.reduce((a, r) => a + r.confidence, 0) / fresh.length,
    cameras: fresh.length,
  }
}
