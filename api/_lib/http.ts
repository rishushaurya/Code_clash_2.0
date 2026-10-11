// Helpers shared by the serverless functions: JSON responses, validation, auth, rate limits, Supabase.

import { createHmac } from 'node:crypto'
import type { z } from 'zod'
import { authConfigured, channels, readToken, same } from './auth.js'
import { storageProblem, supabase } from './db.js'

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** Reads and validates a JSON body. Returns the data, or a 4xx Response to send back. */
export async function readBody<T>(req: Request, schema: z.ZodType<T>, maxBytes = 20_000): Promise<T | Response> {
  const text = await req.text()
  if (text.length > maxBytes) return json({ error: 'Request too large' }, 413)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const parsed = schema.safeParse(body)
  return parsed.success ? parsed.data : json({ error: 'Invalid request', issues: parsed.error.issues.slice(0, 5) }, 400)
}

export const safeEqual = same

/** The caller's workspace from "Authorization: Bearer <token>", or the 401/503 to send back */
export function requireWorkspace(req: Request): string | Response {
  if (!authConfigured()) return json({ error: 'Workspaces are not configured on this server' }, 503)
  const id = readToken((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
  return id ?? json({ error: 'Sign in to your workspace again' }, 401)
}

// seniordev: in-memory window per server instance; good enough to stop a runaway loop, use Upstash or similar for real limits.
const hits = new Map<string, { start: number; count: number }>()
export function rateLimit(req: Request, perMinute = 30): Response | null {
  // Per route and address: a busy sensor feed must not lock the same address out of everything else.
  const ip = `${new URL(req.url).pathname} ${req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'}`
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.start > 60_000) hits.set(ip, { start: now, count: 1 })
  else if (++h.count > perMinute) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { 'retry-after': '60' } })
  return null
}

/** Broadcast on a workspace's private twin channel through Supabase's REST endpoint: no websocket needed in a function. */
export async function broadcast(workspace: string, event: string, payload: unknown) {
  const sb = supabase()
  if (!sb) return false
  try {
    const res = await fetch(`${sb.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: sb.headers,
      body: JSON.stringify({ messages: [{ topic: channels(workspace).channel, event, payload }] }),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Append to the workspace's event log, the action-taken record auditors ask for. */
export async function logEvent(workspace: string, roomId: string | null, kind: string, payload: unknown) {
  const sb = supabase()
  if (!sb) return
  await fetch(`${sb.url}/rest/v1/events`, {
    method: 'POST',
    headers: { ...sb.headers, prefer: 'return=minimal' },
    body: JSON.stringify({ room_id: roomId, kind, payload: { ...(payload as object), site: workspace } }),
  }).catch(() => undefined)
}

/**
 * A failed storage call, explained on screen and in the server log: a wrong setting by name, else what
 * Supabase answered. Supabase's error texts ("Invalid API key", a missing table) carry no secrets.
 */
export async function storageError(res: Response | Error | null | undefined) {
  const detail =
    storageProblem() ??
    (res instanceof Response
      ? `Supabase answered ${res.status}: ${(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`
      : `Supabase is not reachable from the server (${res?.message ?? 'no response'}). Check VITE_SUPABASE_URL.`)
  logJson('error', 'storage', { detail })
  return json({ error: `Storage unavailable. ${detail}` }, 502)
}

/** Structured log line for Vercel's log viewer */
export const logJson = (level: 'info' | 'warn' | 'error', message: string, meta: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }))

/**
 * Forward a command to the customer's own system (Home Assistant webhook, BMS bridge, PLC gateway).
 * Signed with HMAC-SHA256 so the receiver can check it came from this server:
 *   x-pratibimb-signature: sha256=<hex of HMAC(COMMAND_WEBHOOK_SECRET, raw body)>
 * The body names the workspace, so one receiver can serve several workspaces.
 */
export async function forwardCommand(workspace: string, cmd: object) {
  const url = process.env.COMMAND_WEBHOOK_URL
  if (!url) return false
  const body = JSON.stringify({ ...cmd, workspace })
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const secret = process.env.COMMAND_WEBHOOK_SECRET
  if (secret) headers['x-pratibimb-signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}
