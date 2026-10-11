// POST /api/ai/surveyor  { roomId, image }  ->  { items: [{ label, box: [ymin, xmin, ymax, xmax] }] }
// AI Surveyor: a photo of a room's ceiling becomes a device list. Boxes are 0-1000, Gemini's native format.
// The person confirms the counts before anything changes in the twin.

import { z } from 'zod'
import { json, logJson, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiConfigured, chatJson } from '../../_lib/llm.js'
import { RoomIdSchema } from '../../_lib/schemas.js'

const LABELS = ['light', 'fan', 'ac', 'projector', 'pc'] as const

const Out = z.object({
  items: z
    .array(
      z.object({
        label: z.enum(LABELS),
        box: z.tuple([z.number(), z.number(), z.number(), z.number()]).transform((b) => b.map((v) => Math.min(1000, Math.max(0, v))) as [number, number, number, number]),
      }),
    )
    .max(200),
})

const SYSTEM = `You survey classrooms for an energy audit. Find every electrical device in the photo.
Labels: light (tube light or ceiling light), fan (ceiling or wall fan), ac (air conditioner indoor unit), projector, pc (desktop computer or monitor).
Return one item per physical device with its bounding box as [ymin, xmin, ymax, xmax] scaled 0 to 1000.
Ignore people. If unsure, leave it out. Reply with JSON only: {"items": [{"label", "box"}]}.`

const Body = z.object({
  roomId: RoomIdSchema,
  image: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/, 'image must be a base64 data URL'),
})

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  if (!aiConfigured()) return json({ error: 'No AI key configured' }, 503)
  const limited = rateLimit(req, 6)
  if (limited) return limited
  const body = await readBody(req, Body, 2_000_000)
  if (body instanceof Response) return body
  try {
    const out = await chatJson(SYSTEM, `Room ${body.roomId}. List its devices.`, Out, () => [], body.image)
    return json(out)
  } catch (e) {
    logJson('warn', 'surveyor failed', { roomId: body.roomId, error: String(e).slice(0, 300) })
    return json({ error: 'AI unavailable' }, 502)
  }
}
