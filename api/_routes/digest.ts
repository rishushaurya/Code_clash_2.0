// GET /api/digest  Weekly summary per workspace from the stored event log, sent to each workspace's
// Telegram chat. Run by Vercel Cron
// (vercel.json), which calls it with "Authorization: Bearer <CRON_SECRET>". Built only from real events.
// Cron delivery can repeat; a repeated digest is harmless, so no lock is kept.

import { recentEvents, table } from '../_lib/db.js'
import { json, safeEqual } from '../_lib/http.js'

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
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!d || !token) return json({ error: 'Server storage or Telegram is not configured' }, 503)
  // Workspaces that chose a Telegram chat; their camera documents (ids with a slash) are skipped.
  const res = await fetch(`${d.url}?site->>telegramChatId=not.is.null&id=not.like.*%2F*&select=id,chat:site->>telegramChatId&limit=200`, { headers: d.headers })
  if (!res.ok) return json({ error: 'Storage unavailable' }, 502)
  const targets = (await res.json()) as { id: string; chat: string }[]
  let sent = 0
  for (const t of targets) {
    if (!/^-?\d{1,20}$/.test(t.chat)) continue
    const rows = await recentEvents(t.id, 7)
    if (!rows) continue
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: t.chat, text: weeklyDigest(rows).text }),
    }).catch(() => null)
    if (r?.ok) sent++
  }
  return json({ workspaces: targets.length, sent })
}
