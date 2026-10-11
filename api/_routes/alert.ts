// POST /api/alert  (Bearer token)  { facts, languages? }
// Sends a Telegram alert with a one-tap "Switch off" button, in the site's chosen languages,
// to the chat the workspace set in Setup. The chat id is read from the stored site, never from the request.
// Every number in the message comes from the facts; the text around it is fixed.

import { z } from 'zod'
import { telegramChat } from '../_lib/db.js'
import { json, logEvent, readBody, requireWorkspace } from '../_lib/http.js'
import { FactsSchema } from '../_lib/schemas.js'

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

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const body = await readBody(req, z.object({ facts: FactsSchema, commandId: z.string().optional(), languages: z.array(z.enum(['en', 'hi', 'kn'])).max(3).optional() }))
  if (body instanceof Response) return body
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = token ? await telegramChat(id) : null
  if (!token || !chatId) return json({ error: 'Telegram is not configured for this workspace' }, 503)

  const { facts } = body
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: alertText(facts, body.languages),
      reply_markup: { inline_keyboard: [[{ text: `Switch off ${facts.roomId}`, callback_data: `off:${id}:${facts.roomId}` }]] },
    }),
  })
  await logEvent(id, facts.roomId, 'alert', { channel: 'telegram', ok: res.ok })
  return json({ ok: res.ok }, res.ok ? 200 : 502)
}
