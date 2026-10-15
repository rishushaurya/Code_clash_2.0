// POST /api/reading  (Bearer token, manager or owner)  { readings: CvReading[], sensors?: SensorReading[] }
// Cameras post their latest reading every 10 s (besides the live channel every 2 s), and staff reports post
// here too, so the server's minute tick knows each room with no browser open. One row per camera and one per
// room's sensors in room_inputs, replaced each time. Only numbers: nothing else ever leaves a camera.

import { z } from 'zod'
import type { CvReading, SensorReading } from '../../src/shared/types'
import { applySensor, type SensorState } from '../../src/twin/compute.js'
import { rows, upsert } from '../_lib/db.js'
import { json, rateLimit, readBody, requireRole, storageError } from '../_lib/http.js'
import { RoomIdSchema, SensorSchema } from '../_lib/schemas.js'

export const CvSchema = z.object({
  roomId: RoomIdSchema,
  cameraId: z.string().regex(/^[A-Za-z0-9-]{1,12}\/[A-Za-z0-9-]{1,20}$/, 'camera id: <roomId>/cam-<n>'),
  sourceKind: z.enum(['webcam', 'phone', 'usb', 'cctv', 'video_file', 'python_edge']),
  ts: z.number(),
  headcount: z.number().int().min(0).max(2000),
  zones: z.record(z.string().regex(/^[A-Za-z0-9-]{1,12}$/), z.boolean()).refine((z) => Object.keys(z).length <= 64, 'at most 64 zones'),
  // A camera that sees nobody may leave confidence out
  confidence: z.number().min(0).max(1).optional(),
})

export interface InputRow {
  workspace: string
  key: string
  room_id: string
  kind: 'camera' | 'sensor'
  reading: CvReading | SensorState
  ts: string
}

export const sensorKey = (roomId: string) => `sensor:${roomId}`

/**
 * Fold sensor readings into each room's stored sensor state (one row per room) and save it.
 * seniordev: read, merge, write; two posts for one room in the same instant can lose one. Fine for sensors
 * that report every few seconds; a Postgres function would make it atomic.
 */
export async function storeSensors(workspace: string, readings: SensorReading[]) {
  if (!readings.length) return true
  const keys = [...new Set(readings.map((r) => sensorKey(r.roomId)))]
  const old = await rows<InputRow>(`room_inputs?workspace=eq.${workspace}&key=in.(${keys.map((k) => `"${k}"`).join(',')})&select=key,reading`)
  if (!old) return false
  const states = new Map(old.map((r) => [r.key, r.reading as SensorState]))
  for (const r of [...readings].sort((a, b) => a.ts - b.ts)) states.set(sensorKey(r.roomId), applySensor(states.get(sensorKey(r.roomId)), r))
  const ts = new Date().toISOString()
  const res = await upsert('room_inputs', keys.map((key) => ({ workspace, key, room_id: key.slice(7), kind: 'sensor', reading: states.get(key), ts })))
  return Boolean(res?.ok)
}

export async function POST(req: Request) {
  const c = await requireRole(req, 'manager')
  if (c instanceof Response) return c
  const limited = rateLimit(req, 120)
  if (limited) return limited
  const body = await readBody(req, z.object({ readings: z.array(CvSchema).max(50), sensors: z.array(SensorSchema).max(50).optional() }), 100_000)
  if (body instanceof Response) return body
  const now = Date.now()
  // The server's clock decides freshness: a phone whose clock runs late must not look silent.
  const cams = body.readings.map((r) => ({ workspace: c.id, key: r.cameraId, room_id: r.roomId, kind: 'camera', reading: { ...r, ts: now }, ts: new Date(now).toISOString() }))
  const latest = [...new Map(cams.map((r) => [r.key, r])).values()]
  const saved = latest.length ? await upsert('room_inputs', latest) : null
  if (latest.length && !saved?.ok) return storageError(saved ?? undefined)
  const sensors = (body.sensors ?? []).map((r) => ({ ...r, ts: Math.min(r.ts ?? now, now) }))
  if (!(await storeSensors(c.id, sensors))) return storageError(null)
  return json({ ok: true, cameras: latest.length, sensors: sensors.length })
}
