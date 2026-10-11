// POST /api/telegram  Telegram webhook, one bot for the whole deployment.
// Verifies Telegram's secret header. A "Switch off" tap becomes a command for the workspace named in the
// button, but only when it comes from the chat that workspace chose. "/chatid" in any chat replies with the
// chat's id, so a workspace can paste it into Setup.
// Register once: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<app>/api/telegram&secret_token=<SECRET>

import { randomUUID } from 'node:crypto'
import { telegramChat } from '../_lib/db.js'
import { broadcast, forwardCommand, json, logEvent, logJson, safeEqual } from '../_lib/http.js'

interface Update {
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } }
  message?: { text?: string; chat: { id: number } }
}

async function telegram(method: string, body: unknown) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || !safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) return json({ error: 'Unauthorized' }, 401)

  const update = (await req.json().catch(() => ({}))) as Update
  // Always answer 200 to Telegram for anything we ignore, or it retries.
  if (update.message?.text && /^\/(chatid|start)\b/.test(update.message.text)) {
    await telegram('sendMessage', { chat_id: update.message.chat.id, text: `This chat's id is ${update.message.chat.id}. Paste it into Pratibimb: Setup, Integrations, Telegram chat id.` })
    return json({ ok: true })
  }
  const q = update.callback_query
  const m = /^off:([a-z0-9-]{3,32}):([A-Za-z0-9-]{1,12})$/.exec(q?.data ?? '')
  if (!q || !m) return json({ ok: true })
  const [, workspace, roomId] = m
  if (String(q.message?.chat.id) !== (await telegramChat(workspace))) {
    await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'This chat is not linked to that workspace' })
    return json({ ok: true })
  }

  const cmd = { id: randomUUID(), ts: Date.now(), roomId, target: 'all', state: 'off', origin: 'telegram' }
  const [sent] = await Promise.all([broadcast(workspace, 'command', cmd), forwardCommand(workspace, cmd)])
  await logEvent(workspace, roomId, 'command', cmd)
  logJson('info', 'telegram command', { workspace, roomId, broadcast: sent })
  await telegram('answerCallbackQuery', { callback_query_id: q.id, text: sent ? `Switching off ${roomId}` : 'Twin is offline' })
  if (q.message) await telegram('sendMessage', { chat_id: q.message.chat.id, text: `Command sent: switch off ${roomId}. Watch the twin for camera confirmation.` })
  return json({ ok: true })
}
