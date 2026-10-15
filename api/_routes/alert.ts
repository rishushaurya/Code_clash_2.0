// POST /api/alert  (Bearer token, manager or owner)  { facts, languages? }
// Sends a Telegram alert with a one-tap "Switch off" button, in the site's chosen languages, through the
// workspace's own bot (else the deployment's) to the chat linked to the workspace. The chat id is read from
// storage, never from the request. The minute tick sends the same alert when no browser is open.
// Every number in the message comes from the facts; the text around it is fixed.

import { z } from 'zod'
import { telegramChat } from '../_lib/db.js'
import { json, logEvent, readBody, requireRole } from '../_lib/http.js'
import { FactsSchema } from '../_lib/schemas.js'
import { botFor, tg } from './telegram.js'

const NAMES: Record<string, string> = { light: 'lights', fan: 'fans', ac: 'ACs', projector: 'projectors', pc: 'PCs' }

type Facts = z.infer<typeof FactsSchema>

function money(v: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
  } catch {
    return `${currency} ${v.toFixed(2)}`
  }
}

const LINES: Record<'en' | 'hi' | 'kn', (f: Facts, cost: string) => string> = {
  en: (f, cost) => `Pratibimb alert: ${f.roomId} (${f.roomName}) is empty but drawing ${f.wattsNow} W, about ${cost} per hour.`,
  hi: (f, cost) => `हिंदी: ${f.roomId} खाली है, फिर भी ${f.wattsNow} W बिजली खर्च हो रही है (${cost} प्रति घंटा).`,
  kn: (f, cost) => `ಕನ್ನಡ: ${f.roomId} ಖಾಲಿಯಿದೆ, ಆದರೂ ${f.wattsNow} W ವಿದ್ಯುತ್ ಬಳಕೆಯಾಗುತ್ತಿದೆ (ಗಂಟೆಗೆ ${cost}).`,
}

export function alertText(f: Facts, languages: (keyof typeof LINES)[] = ['en']) {
  const cost = money(f.costPerHourNow, f.currency)
  const devices = f.devicesOn.map((d) => `${d.count} ${NAMES[d.type]}`).join(', ')
  return [LINES.en(f, cost), devices ? `On: ${devices}.` : '', ...languages.filter((l) => l !== 'en').map((l) => LINES[l](f, cost))].filter(Boolean).join('\n')
}

/** Sends the alert; null when the workspace has no bot or no linked chat, false when Telegram refuses */
export async function sendAlert(workspace: string, facts: Facts, languages?: (keyof typeof LINES)[]) {
  const [token, chatId] = await Promise.all([botFor(workspace), telegramChat(workspace)])
  if (!token || !chatId) return null
  const sent = await tg(token, 'sendMessage', {
    chat_id: chatId,
    text: alertText(facts, languages),
    reply_markup: { inline_keyboard: [[{ text: `Switch off ${facts.roomId}`, callback_data: `off:${workspace}:${facts.roomId}` }]] },
  })
  await logEvent(workspace, facts.roomId, 'alert', { channel: 'telegram', ok: sent.ok })
  return sent.ok
}

export async function POST(req: Request) {
  const c = await requireRole(req, 'manager')
  if (c instanceof Response) return c
  const body = await readBody(req, z.object({ facts: FactsSchema, commandId: z.string().optional(), languages: z.array(z.enum(['en', 'hi', 'kn'])).max(3).optional() }))
  if (body instanceof Response) return body
  const ok = await sendAlert(c.id, body.facts, body.languages)
  if (ok === null) return json({ error: 'Telegram is not configured for this workspace' }, 503)
  return json({ ok }, ok ? 200 : 502)
}
