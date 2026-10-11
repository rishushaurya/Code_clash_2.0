// POST /api/report  { workspace, key, roomId }  Public: anyone on the public view can say "lights are left on here".
// The public view's link carries the workspace and its public key. The tip only raises an alert for staff to
// check; it never changes device states, so it cannot be abused to fake savings.

import { z } from 'zod'
import { authConfigured, channels, same } from '../_lib/auth.js'
import { broadcast, json, rateLimit, readBody } from '../_lib/http.js'
import { RoomIdSchema } from '../_lib/schemas.js'

export async function POST(req: Request) {
  const limited = rateLimit(req, 5)
  if (limited) return limited
  const body = await readBody(req, z.object({ workspace: z.string().regex(/^[a-z0-9-]{3,32}$/), key: z.string().max(40), roomId: RoomIdSchema }), 500)
  if (body instanceof Response) return body
  if (!authConfigured() || !same(body.key, channels(body.workspace).publicKey)) return json({ error: 'Unknown public view' }, 403)
  const delivered = await broadcast(body.workspace, 'tip', { roomId: body.roomId, ts: Date.now() })
  return json({ ok: delivered }, delivered ? 200 : 503)
}
