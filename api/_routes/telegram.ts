// Telegram. Each workspace can bring its own bot (Keys and AI: paste the token, press Connect); the deployment's
// bot (TELEGRAM_BOT_TOKEN) serves the workspaces that have none.
//
// POST /api/telegram?ws=<id>  Webhook of a workspace's own bot. Telegram sends the secret this server derived
//   for that workspace. The first message in a chat within 15 minutes of Connect links that chat: no /chatid.
// POST /api/telegram          Webhook of the deployment's bot (TELEGRAM_WEBHOOK_SECRET). "/chatid" replies with
//   the chat's id, for Setup.
// In both, a "Switch off" tap becomes a command for the workspace named in the button, but only from the
// chat linked to that workspace.
// POST /api/telegram/connect  (owner)  { relink? }  Sets the webhook of the workspace's bot and opens the link window.
// GET  /api/telegram/connect  The bot's name and the linked chat, for the settings page to show.

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Command } from '../../src/shared/types'
import { authConfigured, derived } from '../_lib/auth.js'
import { readDoc, settingsLog, telegramChat, writeDoc } from '../_lib/db.js'
import { json, logJson, readBody, requireRole, safeEqual, storageError } from '../_lib/http.js'
import { getKey } from '../_lib/keys.js'
import { dispatchCommand } from './connections.js'

interface Update {
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } }
  message?: { text?: string; chat: { id: number; title?: string; username?: string; first_name?: string } }
}

/** The stored link of a workspace's own bot: its name, the linked chat, and until when a chat may link */
interface Link {
  bot?: string
  chatId?: string
  chatTitle?: string
  linkUntil?: number
}

const LINK_WINDOW_MS = 15 * 60_000
const ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

/** Telegram's webhook secret for a workspace's bot: derived, so nothing needs storing */
export const webhookSecret = (workspace: string) => derived(`telegram:${workspace}`, 40)

/** One Bot API call; never throws */
export async function tg(token: string, method: string, body: unknown = {}): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
    return (await res.json()) as { ok: boolean; result?: unknown; description?: string }
  } catch {
    return { ok: false, description: 'Telegram is not reachable' }
  }
}

/** The bot that speaks for a workspace: its own, else the deployment's */
export async function botFor(workspace: string): Promise<string | null> {
  const own = await getKey(workspace, 'telegram').catch(() => null)
  return own?.value ?? process.env.TELEGRAM_BOT_TOKEN ?? null
}

/** This site's public address: PUBLIC_URL when set, else the address the request came to */
export function publicOrigin(req: Request) {
  const set = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '')
  if (set) return set
  const url = new URL(req.url)
  return `${req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')}://${req.headers.get('x-forwarded-host') ?? url.host}`
}

const readLink = async (workspace: string): Promise<Link> => {
  const doc = await readDoc(workspace, 'telegram')
  return doc && doc !== 'unavailable' ? (doc.value as Link) : {}
}

export async function POST(req: Request) {
  const ws = new URL(req.url).searchParams.get('ws')
  const header = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
  let token: string | null
  if (ws !== null) {
    if (!ID.test(ws) || !authConfigured() || !safeEqual(header, webhookSecret(ws))) return json({ error: 'Unauthorized' }, 401)
    token = (await getKey(ws, 'telegram'))?.value ?? null
  } else {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!secret || !safeEqual(header, secret)) return json({ error: 'Unauthorized' }, 401)
    token = process.env.TELEGRAM_BOT_TOKEN ?? null
  }
  // Always answer 200 to Telegram for anything we ignore, or it retries.
  if (!token) return json({ ok: true })
  const update = (await req.json().catch(() => ({}))) as Update
  const msg = update.message

  if (msg?.chat && ws !== null) {
    const chat = String(msg.chat.id)
    const link = await readLink(ws)
    if (!link.chatId && (link.linkUntil ?? 0) > Date.now()) {
      const chatTitle = msg.chat.title ?? msg.chat.username ?? msg.chat.first_name ?? chat
      const saved = await writeDoc(ws, 'telegram', { ...link, chatId: chat, chatTitle, linkUntil: 0 })
      if (saved instanceof Response && saved.ok) {
        await settingsLog(ws, 'telegram.link', { chat: chatTitle })
        await tg(token, 'sendMessage', { chat_id: msg.chat.id, text: `This chat is now linked to the Pratibimb workspace "${ws}". Alerts, switch-off buttons and the weekly digest will arrive here.` })
      }
    } else if (link.chatId === chat && /^\/(start|status)\b/.test(msg.text ?? '')) {
      await tg(token, 'sendMessage', { chat_id: msg.chat.id, text: `This chat is linked to the Pratibimb workspace "${ws}".` })
    }
    return json({ ok: true })
  }
  if (msg?.text && /^\/(chatid|start)\b/.test(msg.text)) {
    await tg(token, 'sendMessage', { chat_id: msg.chat.id, text: `This chat's id is ${msg.chat.id}. Paste it into Pratibimb: Setup, Integrations, Telegram chat id.` })
    return json({ ok: true })
  }

  const q = update.callback_query
  const m = /^off:([a-z0-9-]{3,32}):([A-Za-z0-9-]{1,12})$/.exec(q?.data ?? '')
  if (!q || !m) return json({ ok: true })
  const [, workspace, roomId] = m
  // A workspace's own bot acts only for its workspace.
  if ((ws !== null && workspace !== ws) || String(q.message?.chat.id) !== (await telegramChat(workspace))) {
    await tg(token, 'answerCallbackQuery', { callback_query_id: q.id, text: 'This chat is not linked to that workspace' })
    return json({ ok: true })
  }

  const cmd: Command = { id: randomUUID(), ts: Date.now(), roomId, target: 'all', state: 'off', origin: 'telegram' }
  const { broadcasted, devices } = await dispatchCommand(workspace, cmd)
  logJson('info', 'telegram command', { workspace, roomId, broadcast: broadcasted, devices })
  await tg(token, 'answerCallbackQuery', { callback_query_id: q.id, text: broadcasted || devices ? `Switching off ${roomId}` : 'Twin is offline' })
  if (q.message) await tg(token, 'sendMessage', { chat_id: q.message.chat.id, text: `Command sent: switch off ${roomId}. Watch the twin for camera confirmation.` })
  return json({ ok: true })
}

export async function connectGET(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  const link = await readLink(c.id)
  return json({ bot: link.bot ?? null, chat: link.chatId ? { id: link.chatId, title: link.chatTitle ?? link.chatId } : null, linkUntil: link.linkUntil || null })
}

export async function connectPOST(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const body = await readBody(req, z.object({ relink: z.boolean().optional() }), 200)
  if (body instanceof Response) return body
  const key = await getKey(c.id, 'telegram')
  if (!key) return json({ error: 'Add your bot token first (Keys and AI, Telegram)' }, 400)
  const me = await tg(key.value, 'getMe')
  const bot = (me.result as { username?: string } | undefined)?.username
  if (!me.ok || !bot) return json({ error: 'Telegram refused the bot token. Copy it again from @BotFather.' }, 400)
  const origin = publicOrigin(req)
  if (!origin.startsWith('https://')) return json({ error: `Telegram can only call an https address, and this site is ${origin}. Set PUBLIC_URL to the deployed address.` }, 400)
  const set = await tg(key.value, 'setWebhook', {
    url: `${origin}/api/telegram?ws=${c.id}`,
    secret_token: webhookSecret(c.id),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
  if (!set.ok) return json({ error: `Telegram did not accept the webhook: ${set.description ?? 'unknown reason'}` }, 502)
  const old = await readLink(c.id)
  const keep = old.chatId && !body.relink
  const link: Link = { bot, ...(keep && { chatId: old.chatId, chatTitle: old.chatTitle }), linkUntil: keep ? 0 : Date.now() + LINK_WINDOW_MS }
  const saved = await writeDoc(c.id, 'telegram', link)
  if (!(saved instanceof Response) || !saved.ok) return storageError(saved)
  await settingsLog(c.id, 'telegram.connect', { bot, relink: Boolean(body.relink) })
  return json({
    ok: true,
    bot: `@${bot}`,
    chat: link.chatId ? { id: link.chatId, title: link.chatTitle } : null,
    linkUntil: link.linkUntil || null,
    next: link.chatId ? 'Alerts go to the linked chat.' : `Add @${bot} to your staff group (or open it), and send any message within 15 minutes to link that chat.`,
  })
}
