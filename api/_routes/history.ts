// GET /api/history?room=&from=&to=  (Bearer token)  Hourly roll-ups written by the minute tick, for Trends and
// month-long audit evidence. `from` and `to` take ISO dates or epoch milliseconds; the last 7 days by default.

import { rows } from '../_lib/db.js'
import { json, requireRole, storageError } from '../_lib/http.js'

const MAX_DAYS = 93

const time = (v: string | null) => (v === null ? NaN : /^\d+$/.test(v) ? Number(v) : Date.parse(v))

export async function GET(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  const p = new URL(req.url).searchParams
  const room = p.get('room')
  if (room !== null && !/^[A-Za-z0-9-]{1,12}$/.test(room)) return json({ error: 'Unknown room id' }, 400)
  const to = Number.isFinite(time(p.get('to'))) ? time(p.get('to')) : Date.now()
  const from = Number.isFinite(time(p.get('from'))) ? time(p.get('from')) : to - 7 * 86_400_000
  if (from > to || to - from > MAX_DAYS * 86_400_000) return json({ error: `Choose a range of at most ${MAX_DAYS} days` }, 400)
  const list = await rows<Record<string, unknown>>(
    `room_hourly?workspace=eq.${c.id}${room ? `&room_id=eq.${room}` : ''}&hour=gte.${new Date(from).toISOString()}&hour=lte.${new Date(to).toISOString()}` +
      '&select=room_id,hour,kwh,cost,waste_kwh,waste_cost,occupied_minutes,observed_minutes&order=hour.asc&limit=50000',
  )
  if (!list) return storageError(null)
  return json({
    from,
    to,
    hours: list.map((r) => ({ roomId: r.room_id, hour: Date.parse(String(r.hour)), kwh: r.kwh, cost: r.cost, wasteKwh: r.waste_kwh, wasteCost: r.waste_cost, occupiedMinutes: r.occupied_minutes, observedMinutes: r.observed_minutes })),
  })
}
