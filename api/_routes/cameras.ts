// GET /api/cameras  (Bearer token)  Every camera of the workspace with its zones and calibration.
// PUT /api/cameras  (Bearer token)  { id, config | null, base? }  Save or remove one camera. `base` is the updatedAt of
//   the copy being replaced; without it the save creates the camera, and an id that already exists answers 409.
// Kept apart from the site, so a phone calibrating a camera never overwrites setup edits made elsewhere.

import { z } from 'zod'
import { readDoc, writeDoc } from '../_lib/db.js'
import { json, readBody, requireWorkspace, storageError } from '../_lib/http.js'

const unit = z.number().min(0).max(1)
export const CameraConfigSchema = z.object({
  roomId: z.string().regex(/^[A-Za-z0-9-]{1,12}$/),
  name: z.string().max(40),
  zones: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Z]{1,4}\d{0,2}$/),
        kind: z.enum(['region', 'brightness', 'motion']),
        x: unit,
        y: unit,
        w: unit,
        h: unit,
        onRef: z.number().min(0).max(255).optional(),
        offRef: z.number().min(0).max(255).optional(),
      }),
    )
    .max(20),
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  updatedAt: z.number(),
})
const CameraId = z.string().regex(/^[A-Za-z0-9-]{1,12}\/cam-\d{1,2}$/)

export async function GET(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const doc = await readDoc(id, 'cameras')
  if (doc === 'unavailable') return json({ error: 'Server storage is not configured or unavailable' }, 503)
  return json({ cameras: (doc?.value as { cameras?: unknown } | undefined)?.cameras ?? {} })
}

export async function PUT(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const body = await readBody(req, z.object({ id: CameraId, config: CameraConfigSchema.nullable(), base: z.number().optional() }), 20_000)
  if (body instanceof Response) return body
  const doc = await readDoc(id, 'cameras')
  if (doc === 'unavailable') return json({ error: 'Server storage is not configured or unavailable' }, 503)
  // seniordev: read-modify-write per camera; two cameras saved in the same instant can lose one save, which the next save repeats.
  const cameras = { ...((doc?.value as { cameras?: Record<string, unknown> } | undefined)?.cameras ?? {}) }
  // Two devices creating the same number would overwrite each other's zones: the second takes the next number.
  if (body.config && body.base === undefined && cameras[body.id]) return json({ error: 'This camera number is taken; take the next one' }, 409)
  if (body.config) cameras[body.id] = body.config
  else delete cameras[body.id]
  if (Object.keys(cameras).length > 200) return json({ error: 'At most 200 cameras per workspace' }, 400)
  const res = await writeDoc(id, 'cameras', { cameras })
  return res instanceof Response && res.ok ? json({ ok: true }) : storageError(res)
}
