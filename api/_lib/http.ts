// Helpers shared by the serverless functions: JSON responses, validation, auth, rate limits, Supabase.

import { createHmac } from 'node:crypto'
import type { z } from 'zod'
import { authConfigured, channels, derived, readClaims, readToken, same, type Role, type SessionClaims } from './auth.js'
import { rest, storageProblem, supabase } from './db.js'
import { getKey, safeFetch } from './keys.js'

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

const RANK: Record<Role, number> = { viewer: 0, manager: 1, owner: 2 }
/** Whether a session is still signed in, per server instance for 30 s, so a revoke takes effect within 30 s */
const liveSessions = new Map<string, { ok: boolean; at: number }>()
export const forgetSession = (sid: string) => liveSessions.delete(sid)

async function sessionLive(c: SessionClaims) {
  const hit = liveSessions.get(c.sid!)
  if (hit && Date.now() - hit.at < 30_000) return hit.ok
  const res = await rest(`sessions?id=eq.${c.sid}&workspace=eq.${c.id}&select=revoked_at`)
  // No sessions table yet (404), or storage briefly failing: the signature alone decides, as before roles.
  // A failure is not cached, and is never read as "signed out", which would sign the person out for nothing.
  if (!res?.ok) return true
  const found = (await res.json().catch(() => null)) as { revoked_at: string | null }[] | null
  if (!Array.isArray(found)) return true
  const ok = found.length === 1 && !found[0].revoked_at
  liveSessions.set(c.sid!, { ok, at: Date.now() })
  return ok
}

/**
 * The caller's session from "Authorization: Bearer <token>", with at least the role `min`, or the
 * 401/403/503 to send back. Checks that the session was not signed out (Team and access, or a password change).
 */
export async function requireRole(req: Request, min: Role = 'viewer'): Promise<SessionClaims | Response> {
  if (!authConfigured()) return json({ error: 'Workspaces are not configured on this server' }, 503)
  const c = readClaims((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
  if (!c || (c.sid && !(await sessionLive(c)))) return json({ error: 'Sign in to your workspace again' }, 401)
  if (RANK[c.role] < RANK[min]) return json({ error: `Only a workspace ${min}${min === 'owner' ? '' : ' or owner'} can do this` }, 403)
  return c
}

/** The route a request is for: on Vercel every path arrives as /api/router?path=<route> */
const routeOf = (req: Request) => {
  const url = new URL(req.url)
  return url.searchParams.get('path') ?? url.pathname
}
const callerIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'

// seniordev: in-memory window per server instance; the fallback when the shared limit (below) is not set up.
const hits = new Map<string, { start: number; count: number }>()
export function rateLimit(req: Request, perMinute = 30): Response | null {
  // Per route and address: a busy sensor feed must not lock the same address out of everything else.
  const ip = `${routeOf(req)} ${callerIp(req)}`
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.start > 60_000) hits.set(ip, { start: now, count: 1 })
  else if (++h.count > perMinute) return tooMany()
  return null
}

const tooMany = () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } })

/**
 * Rate limit per route and address, counted in Supabase (function rate_hit, supabase/schema.sql) so it holds
 * across every server instance. The address is stored only as a keyed hash. Falls back to the in-memory
 * window when the function is missing or storage is down.
 */
export async function limit(req: Request, perMinute = 30): Promise<Response | null> {
  if (!authConfigured()) return rateLimit(req, perMinute)
  const res = await rest('rpc/rate_hit', { method: 'POST', body: JSON.stringify({ p_key: derived(`rate:${routeOf(req)}:${callerIp(req)}`, 22), p_window_s: 60 }) })
  const count = res?.ok ? await res.json().catch(() => null) : null
  if (typeof count !== 'number') return rateLimit(req, perMinute)
  return count > perMinute ? tooMany() : null
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
 * Forward a command to the customer's own system (Home Assistant webhook, BMS bridge, PLC gateway): the
 * workspace's own command webhook (Keys and AI), else the deployment's COMMAND_WEBHOOK_URL.
 * Signed with HMAC-SHA256 so the receiver can check it came from this server:
 *   x-pratibimb-signature: sha256=<hex of HMAC(secret, raw body)>
 * The body names the workspace, so one receiver can serve several workspaces.
 */
export async function forwardCommand(workspace: string, cmd: object) {
  const own = await getKey(workspace, 'command_webhook').catch(() => null)
  const url = own?.baseUrl ?? process.env.COMMAND_WEBHOOK_URL
  if (!url) return false
  const body = JSON.stringify({ ...cmd, workspace })
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const secret = own ? own.value : process.env.COMMAND_WEBHOOK_SECRET
  if (secret) headers['x-pratibimb-signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  try {
    const res = own ? await safeFetch(url, { method: 'POST', headers, body }) : await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}
