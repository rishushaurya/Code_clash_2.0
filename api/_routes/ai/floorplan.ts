// POST /api/ai/floorplan  { image }  ->  { floors: [{ name, rooms: [{ name, x, y, w, h }] }] }
// A photo of a floor plan or evacuation map becomes room rectangles for the 3D model. Positions are fractions
// of the picture (0 to 1, from the top left). The model's numbers are checked by code: anything outside the
// picture is clipped, slivers and duplicates are dropped. Nothing is saved; the person reviews it in 3D first.

import { z } from 'zod'
import { json, rateLimit, readBody, requireWorkspace } from '../../_lib/http.js'
import { aiFailure, chatJson } from '../../_lib/llm.js'

const num = z.unknown().transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : NaN))
const Raw = z.object({
  floors: z
    .unknown()
    .transform((v) => (Array.isArray(v) ? v.slice(0, 20) : []))
    .pipe(
      z.array(
        z
          .object({
            name: z.unknown().transform((v) => (typeof v === 'string' ? v.trim().slice(0, 40) : '')),
            rooms: z
              .unknown()
              .transform((v) => (Array.isArray(v) ? v.slice(0, 200) : []))
              .pipe(z.array(z.object({ name: z.unknown().transform((v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '')), x: num, y: num, w: num, h: num }).nullable().catch(null))),
          })
          .nullable()
          .catch(null),
      ),
    ),
})
type RawPlan = z.infer<typeof Raw>

export interface FloorPlan {
  floors: { name: string; rooms: { name: string; x: number; y: number; w: number; h: number }[] }[]
}

const SYSTEM = `You read photos of building floor plans and evacuation maps.
Find every room drawn on the plan. For each room give its label as written (or "Room 1", "Room 2" when unlabelled) and its bounding rectangle as fractions of the whole picture: x and y of the top-left corner, w and h, each from 0 to 1.
Leave out corridors, stairs, lifts, toilets and shafts unless they are labelled as rooms. If the picture shows several floors, list each floor separately with its name as written (for example "Ground floor").
Never guess a room that is not drawn. Reply with JSON only: {"floors": [{"name", "rooms": [{"name", "x", "y", "w", "h"}]}]}.`

const Body = z.object({ image: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/, 'image must be a base64 data URL') })

const MIN = 0.01
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Clips rectangles to the picture and drops slivers, out-of-picture boxes, repeats and empty floors */
export function checkPlan(raw: RawPlan): FloorPlan {
  const floors = raw.floors.flatMap((f, i) => {
    if (!f) return []
    const seen = new Set<string>()
    const rooms = f.rooms.flatMap((r, j) => {
      if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite)) return []
      const x = Math.max(0, r.x)
      const y = Math.max(0, r.y)
      const w = Math.min(1, r.x + r.w) - x
      const h = Math.min(1, r.y + r.h) - y
      if (w < MIN || h < MIN || x >= 1 || y >= 1) return []
      const box = { name: r.name || `Room ${j + 1}`, x: r3(x), y: r3(y), w: r3(w), h: r3(h) }
      const key = `${box.x},${box.y},${box.w},${box.h}`
      if (seen.has(key)) return []
      seen.add(key)
      return [box]
    })
    return rooms.length ? [{ name: f.name || (i === 0 ? 'Ground floor' : `Floor ${i}`), rooms }] : []
  })
  return { floors }
}

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const limited = rateLimit(req, 6)
  if (limited) return limited
  const body = await readBody(req, Body, 4_000_000)
  if (body instanceof Response) return body
  try {
    const plan = checkPlan(
      await chatJson({ workspace: id, task: 'vision' }, SYSTEM, 'Find the rooms on this floor plan.', Raw, (p) => (checkPlan(p).floors.length ? [] : ['No room rectangles were found; list each drawn room with x, y, w, h as fractions from 0 to 1']), body.image),
    )
    return json(plan)
  } catch (e) {
    return aiFailure(e, 'floorplan', { workspace: id })
  }
}
