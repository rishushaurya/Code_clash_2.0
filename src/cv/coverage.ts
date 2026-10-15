// Which of a room's devices any camera can see. A device is watched when a camera of the room has a zone for it
// that reports: marked, and calibrated unless it is a fan. Setup says 4 lights, cameras watch 2: "2 of 4 lights watched".

import type { CameraConfig, DeviceType, Room } from '@/shared/types'
import { zoneReady } from './lightZones'

export interface Coverage {
  type: DeviceType
  total: number
  watched: number
}

export function coverage(room: Room, cameras: CameraConfig[]): Coverage[] {
  const ready = new Set(cameras.filter((c) => c.roomId === room.id).flatMap((c) => c.zones.filter(zoneReady).map((z) => z.id)))
  const byType = new Map<DeviceType, Coverage>()
  for (const d of room.devices) {
    const c = byType.get(d.type) ?? { type: d.type, total: 0, watched: 0 }
    c.total++
    if (d.zone && ready.has(d.zone)) c.watched++
    byType.set(d.type, c)
  }
  return [...byType.values()]
}

const PLURAL: Record<DeviceType, [string, string]> = { light: ['light', 'lights'], fan: ['fan', 'fans'], ac: ['AC', 'ACs'], projector: ['projector', 'projectors'], pc: ['PC', 'PCs'] }

/** "2 of 4 lights watched" */
export const coverageText = (c: Coverage) => `${c.watched} of ${c.total} ${PLURAL[c.type][c.total === 1 ? 0 : 1]} watched`
