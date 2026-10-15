// GET /api/digest  Weekly summary per workspace from the stored event log, sent to each workspace's linked
// Telegram chat through its own bot (else the deployment's). Run by Vercel Cron
// (vercel.json), which calls it with "Authorization: Bearer <CRON_SECRET>". Built only from real events.
// Cron delivery can repeat; a repeated digest is harmless, so no lock is kept.

import { recentEvents, table, telegramChat } from '../_lib/db.js'
import { json, safeEqual } from '../_lib/http.js'
import { botFor, tg } from './telegram.js'

export function weeklyDigest(rows: { room_id: string | null; kind: string; payload: { text?: string } }[]) {
  const count = (k: string) => rows.filter((r) => r.kind === k).length
  const wasteByRoom = new Map<string, number>()
  for (const r of rows) if (r.kind === 'alert' && r.room_id && r.payload.text?.includes('empty with load')) wasteByRoom.set(r.room_id, (wasteByRoom.get(r.room_id) ?? 0) + 1)
  const top = [...wasteByRoom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const confirmed = rows.filter((r) => r.kind === 'ack' && r.payload.text?.includes('confirmed')).length
  const lines = [
    'Pratibimb weekly digest',
    `Empty rooms found with power on: ${[...wasteByRoom.values()].reduce((a, b) => a + b, 0)} times.`,
    `Switch-off commands: ${count('command')}; confirmed off: ${confirmed}.`,
    top.length ? `Rooms to watch: ${top.map(([room, n]) => `${room} (${n})`).join(', ')}.` : 'No room was found wasting power this week.',
  ]
  return { text: lines.join('\n'), alerts: count('alert'), commands: count('command'), confirmed, top }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || !safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return json({ error: 'Unauthorized' }, 401)
  const d = table('sites')
  if (!d) return json({ error: 'Server storage is not configured' }, 503)
  // Workspaces with a chat: chosen in Setup (in the site), or linked to their own bot (document <id>/telegram).
  const res = await fetch(`${d.url}?or=(site->>telegramChatId.not.is.null,id.like.*%2Ftelegram)&select=id&limit=1000`, { headers: d.headers })
  if (!res.ok) return json({ error: 'Storage unavailable' }, 502)
  const ids = [...new Set(((await res.json()) as { id: string }[]).map((r) => r.id.split('/')[0]))]
  let sent = 0
  for (const id of ids) {
    const [token, chat] = await Promise.all([botFor(id), telegramChat(id)])
    if (!token || !chat) continue
    const rows = await recentEvents(id, 7)
    if (!rows) continue
    if ((await tg(token, 'sendMessage', { chat_id: chat, text: weeklyDigest(rows).text })).ok) sent++
  }
  return json({ workspaces: ids.length, sent })
}
