// Cameras of the workspace: their saved settings (name, room boundary, device zones, calibration) and
// what each one last sent. Settings follow the workspace to every device: kept in this browser, saved
// to the server one camera at a time, and announced on the live channel so other screens update at once.

import { create } from 'zustand'
import { zonesOf } from '@/shared/site'
import type { CameraConfig, CameraZone, CvReading, Room } from '@/shared/types'
import { apiFetch, ns, online } from '@/shared/workspace'
import { on, send } from '@/twin/realtime'

const KEY = ns('pratibimb:cameras')
const ID = /^[A-Za-z0-9-]{1,12}\/cam-\d{1,2}$/

function load(): Record<string, CameraConfig> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, CameraConfig>
  } catch {
    return {}
  }
}

export const useCameras = create<{ cameras: Record<string, CameraConfig>; seen: Record<string, CvReading> }>(() => ({
  cameras: typeof localStorage === 'undefined' ? {} : load(),
  seen: {},
}))

function apply(id: string, config: CameraConfig | null) {
  useCameras.setState((s) => {
    const cameras = { ...s.cameras }
    if (config) cameras[id] = config
    else delete cameras[id]
    try {
      localStorage.setItem(KEY, JSON.stringify(cameras))
    } catch {
      // Storage blocked: the server copy still has it.
    }
    return { cameras }
  })
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

/** Save one camera's settings (null removes it) here, on the server and on every open screen */
export function saveCamera(id: string, config: CameraConfig | null) {
  apply(id, config)
  send('camera', { id, config })
  if (!online()) return
  // Marking and calibrating change zones in bursts: upload once they settle.
  clearTimeout(pending.get(id))
  pending.set(
    id,
    setTimeout(() => {
      pending.delete(id)
      void apiFetch('/api/cameras', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, config }) }).catch(() => undefined)
    }, 1200),
  )
}

/** Take the server's settings, keeping whichever copy of each camera is newer */
export async function syncCameras() {
  if (!online()) return
  try {
    const res = await apiFetch('/api/cameras')
    if (!res.ok) return
    const { cameras } = (await res.json()) as { cameras: Record<string, CameraConfig> }
    const mine = useCameras.getState().cameras
    for (const [id, c] of Object.entries(cameras)) if (ID.test(id) && (!mine[id] || mine[id].updatedAt < c.updatedAt)) apply(id, c)
  } catch {
    // Offline: this device's copy stands.
  }
}

on('camera', (m) => {
  if (!ID.test(m?.id ?? '')) return
  const mine = useCameras.getState().cameras[m.id]
  if (m.config === null) return mine && apply(m.id, null)
  if (typeof m.config?.updatedAt === 'number' && Array.isArray(m.config.zones) && (!mine || mine.updatedAt < m.config.updatedAt)) apply(m.id, m.config)
})
on('reading', (r) => {
  if (typeof r?.cameraId === 'string') useCameras.setState((s) => ({ seen: { ...s.seen, [r.cameraId]: r } }))
})

export function nextCameraId(roomId: string) {
  const { cameras } = useCameras.getState()
  let n = 1
  while (cameras[`${roomId}/cam-${n}`]) n++
  return `${roomId}/cam-${n}`
}

/** A new camera's zones: an unmarked room boundary and one unmarked zone per device zone of the room */
export const defaultZones = (room: Room): CameraZone[] => [
  { id: 'ROOM', kind: 'region', x: 0, y: 0, w: 0, h: 0 },
  ...zonesOf(room).map(({ id, kind }) => ({ id, kind, x: 0, y: 0, w: 0, h: 0 })),
]

/** Saved zones, plus any device zone the room gained since (new lights in Setup), in a stable order */
export function zonesFor(room: Room, saved: CameraZone[] = []): CameraZone[] {
  return defaultZones(room).map((z) => saved.find((s) => s.id === z.id) ?? z)
}

export const cameraNumber = (id: string) => id.split('/cam-')[1] ?? ''
