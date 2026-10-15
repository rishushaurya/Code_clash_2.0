// Which of a room's devices any camera can see. A device is watched when a camera of the room has
// marked the zone it belongs to. Setup says 4 lights, cameras mark 2: the room shows "2 of 4 lights watched".

import type { CameraConfig, DeviceType, Room } from '@/shared/types'

export interface Coverage {
  type: DeviceType
  total: number
  watched: number
}

export function coverage(room: Room, cameras: CameraConfig[]): Coverage[] {
  const marked = new Set(cameras.filter((c) => c.roomId === room.id).flatMap((c) => c.zones.filter((z) => z.kind !== 'region' && z.w > 0).map((z) => z.id)))
  const byType = new Map<DeviceType, Coverage>()
  for (const d of room.devices) {
    const c = byType.get(d.type) ?? { type: d.type, total: 0, watched: 0 }
    c.total++
    if (d.zone && marked.has(d.zone)) c.watched++
    byType.set(d.type, c)
  }
  return [...byType.values()]
}
