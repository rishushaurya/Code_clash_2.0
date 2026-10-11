// POST /api/events  (Bearer token)  { events: TwinEvent[] }  Append the twin's events to the event log.
// GET  /api/events?days=30  (Bearer token)  Summary for the report: counts by kind and the actions taken.
// The event log is the action-taken record auditors ask for (for example NAAC 7.1.6).

import { z } from 'zod'
import { recentEvents, table } from '../_lib/db.js'
import { json, readBody, requireWorkspace } from '../_lib/http.js'

const db = () => table('events')

const EventSchema = z.object({
  id: z.string().max(64),
  ts: z.number(),
  roomId: z.string().max(12).nullable(),
  kind: z.enum(['status', 'alert', 'recommendation', 'command', 'ack']),
  text: z.string().max(300),
})

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const d = db()
  if (!d) return json({ error: 'Server storage is not configured' }, 503)
  const body = await readBody(req, z.object({ events: z.array(EventSchema).min(1).max(200) }), 100_000)
  if (body instanceof Response) return body
  const rows = body.events.map((e) => ({ ts: new Date(e.ts).toISOString(), room_id: e.roomId, kind: e.kind, payload: { text: e.text, site: id, clientId: e.id } }))
  const res = await fetch(d.url, { method: 'POST', headers: { ...d.headers, prefer: 'return=minimal' }, body: JSON.stringify(rows) })
  return res.ok ? json({ ok: true, stored: rows.length }) : json({ error: 'Storage unavailable' }, 502)
}

export async function GET(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  if (!db()) return json({ error: 'Server storage is not configured' }, 503)
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 30))
  const rows = await recentEvents(id, days)
  if (!rows) return json({ error: 'Storage unavailable' }, 502)
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1
  return json({
    days,
    counts,
    actions: rows.filter((r) => r.kind === 'command' || r.kind === 'ack').slice(0, 30).map((r) => ({ ts: r.ts, roomId: r.room_id, text: r.payload.text ?? '' })),
  })
}
