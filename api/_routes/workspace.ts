// POST   /api/workspace  { mode: 'create' | 'open', name, password } or { mode: 'join', invite }  ->  session
// GET    /api/workspace  (Bearer token)  ->  the workspace's channels, role, and (manager or owner) sensor key
// DELETE /api/workspace  (owner)  { password }  Deletes the workspace and every row it owns
// PUT    /api/workspace/password  (owner)  { current, next }  New password; every other session is signed out
// POST   /api/workspace/invite    (owner)  { role, days? }  ->  an invite key for a link that signs in with that role
// GET    /api/workspace/export    (owner)  Everything the workspace stored, as JSON (keys only as their last four)
// A workspace keeps one customer's site, cameras, live channel and events apart from everyone else's.

import { z } from 'zod'
import { authConfigured, channels, checkPassword, hashPassword, ingestKey, newSessionId, readInvite, signInvite, signToken, workspaceId, type Role } from '../_lib/auth.js'
import { rest, rows, settingsLog, storageProblem, table } from '../_lib/db.js'
import { forgetSession, json, limit, logJson, readBody, requireRole, storageError } from '../_lib/http.js'
import { getKey } from '../_lib/keys.js'
import { tg } from './telegram.js'

const Password = z.string().min(8, 'Use at least 8 characters').max(200)
const Body = z.discriminatedUnion('mode', [
  z.object({ mode: z.enum(['create', 'open']), name: z.string().trim().min(3).max(40), password: Password }),
  z.object({ mode: z.literal('join'), invite: z.string().max(200) }),
])

/** "Chrome on Windows": enough to tell sessions apart in Team and access, nothing more */
function device(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'another system'
  return `${browser} on ${os}`
}

/** A new session: a row in sessions (so it can be listed and revoked) and the signed token naming it */
async function session(req: Request, id: string, name: string, role: Role) {
  const sid = newSessionId()
  const res = await rest('sessions', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ id: sid, workspace: id, role, label: device(req.headers.get('user-agent') ?? '') }) })
  // 404: the sessions table is not created yet; the token still works, it just cannot be listed or revoked.
  if (res && !res.ok && res.status !== 404) return storageError(res)
  return json({ token: signToken(id, Date.now(), { sid, role }), id, name, role, ...channels(id) })
}

export async function POST(req: Request) {
  const limited = await limit(req, 10)
  if (limited) return limited
  const d = table('workspaces')
  // The browser falls back to a workspace kept on this device when the server cannot hold one.
  if (!d || !authConfigured()) return json({ error: 'This server has no workspace storage', local: true }, 503)
  // A wrong setting would otherwise pass as "Name or password is wrong" (the public key reads an empty table).
  if (storageProblem()) return storageError(null)
  const body = await readBody(req, Body, 1_000)
  if (body instanceof Response) return body

  if (body.mode === 'join') {
    const invite = readInvite(body.invite)
    if (!invite) return json({ error: 'This invite link has expired or is not valid. Ask the owner for a new one.' }, 401)
    const found = await rows<{ name: string }>(`workspaces?id=eq.${invite.id}&select=name`)
    if (!found) return storageError(null)
    if (!found[0]) return json({ error: 'This workspace no longer exists' }, 404)
    return session(req, invite.id, found[0].name, invite.role)
  }

  const id = workspaceId(body.name)
  if (!id) return json({ error: 'Use letters or digits in the name' }, 400)
  if (body.mode === 'create') {
    const res = await fetch(d.url, {
      method: 'POST',
      headers: { ...d.headers, prefer: 'return=minimal' },
      body: JSON.stringify({ id, name: body.name, password_hash: await hashPassword(body.password) }),
    }).catch((e: Error) => e)
    if (res instanceof Response && res.status === 409) return json({ error: 'That name is taken. Open it with its password, or choose another name.' }, 409)
    if (!(res instanceof Response) || !res.ok) return storageError(res)
    logJson('info', 'workspace created', { id })
    return session(req, id, body.name, 'owner')
  }

  const res = await fetch(`${d.url}?id=eq.${id}&select=name,password_hash`, { headers: d.headers }).catch((e: Error) => e)
  if (!(res instanceof Response) || !res.ok) return storageError(res)
  const [row] = (await res.json()) as { name: string; password_hash: string }[]
  // Same answer for an unknown name and a wrong password, so names cannot be probed.
  if (!row || !(await checkPassword(body.password, row.password_hash))) return json({ error: 'Name or password is wrong' }, 401)
  // The password is the owner's: whoever knows it signs in as owner.
  return session(req, id, row.name, 'owner')
}

export async function GET(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  return json({ id: c.id, role: c.role, ...channels(c.id), ...(c.role !== 'viewer' && { ingestKey: ingestKey(c.id) }) })
}

/** The password, checked again before anything that cannot be undone */
async function passwordOk(id: string, password: string) {
  const found = await rows<{ password_hash: string }>(`workspaces?id=eq.${id}&select=password_hash`)
  return found === null ? null : Boolean(found[0] && (await checkPassword(password, found[0].password_hash)))
}

export async function password(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const limited = await limit(req, 5)
  if (limited) return limited
  const body = await readBody(req, z.object({ current: z.string().max(200), next: Password }), 1_000)
  if (body instanceof Response) return body
  const ok = await passwordOk(c.id, body.current)
  if (ok === null) return storageError(null)
  if (!ok) return json({ error: 'The current password is wrong' }, 401)
  const res = await rest(`workspaces?id=eq.${c.id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ password_hash: await hashPassword(body.next) }) })
  if (!res?.ok) return storageError(res ?? undefined)
  // Everyone else signs in again; this session stays.
  await rest(`sessions?workspace=eq.${c.id}&revoked_at=is.null${c.sid ? `&id=neq.${c.sid}` : ''}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) })
  await settingsLog(c.id, 'password.change')
  return json({ ok: true })
}

export async function invite(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const body = await readBody(req, z.object({ role: z.enum(['owner', 'manager', 'viewer']), days: z.number().int().min(1).max(30).default(7) }), 200)
  if (body instanceof Response) return body
  await settingsLog(c.id, 'invite.create', { role: body.role, days: body.days })
  return json({ invite: signInvite(c.id, body.role, body.days), role: body.role, expiresAt: Date.now() + body.days * 86_400_000 })
}

/** Every table and its filter for one workspace's rows */
const owned = (id: string): [string, string][] => [
  ['sites', `or=(id.eq.${id},id.like.${id}%2F*)`],
  ['events', `payload->>site=eq.${id}`],
  ['room_inputs', `workspace=eq.${id}`],
  ['twin_state', `workspace=eq.${id}`],
  ['room_hourly', `workspace=eq.${id}`],
  ['secrets', `workspace=eq.${id}`],
  ['settings_log', `workspace=eq.${id}`],
  ['sessions', `workspace=eq.${id}`],
]

export async function exportData(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const columns: Record<string, string> = { secrets: 'name,last4,base_url,tested_at,ok,error,updated_at', sessions: 'id,role,label,created_at,revoked_at' }
  const out: Record<string, unknown> = { workspace: (await rows(`workspaces?id=eq.${c.id}&select=id,name,created_at`))?.[0] ?? null, exportedAt: new Date().toISOString() }
  for (const [name, filter] of owned(c.id)) {
    const list = await rows<Record<string, unknown>>(`${name}?${filter}&select=${columns[name] ?? '*'}&limit=100000`)
    // Never a key, even encrypted.
    for (const r of list ?? []) delete r.ciphertext
    out[name] = list ?? 'unavailable'
  }
  await settingsLog(c.id, 'workspace.export')
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${c.id}.pratibimb-export.json"` } })
}

export async function DELETE(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const limited = await limit(req, 5)
  if (limited) return limited
  const body = await readBody(req, z.object({ password: z.string().max(200) }), 500)
  if (body instanceof Response) return body
  const ok = await passwordOk(c.id, body.password)
  if (ok === null) return storageError(null)
  if (!ok) return json({ error: 'The password is wrong' }, 401)
  // The workspace's own bot stops calling this server.
  const bot = await getKey(c.id, 'telegram').catch(() => null)
  if (bot) await tg(bot.value, 'deleteWebhook')
  const failed: string[] = []
  for (const [name, filter] of owned(c.id)) {
    const res = await rest(`${name}?${filter}`, { method: 'DELETE' })
    if (!res?.ok && res?.status !== 404) failed.push(name)
  }
  const gone = await rest(`workspaces?id=eq.${c.id}`, { method: 'DELETE' })
  if (!gone?.ok) failed.push('workspaces')
  if (c.sid) forgetSession(c.sid)
  logJson('info', 'workspace deleted', { id: c.id, failed })
  return failed.length ? json({ error: `Some data could not be deleted: ${failed.join(', ')}. Try again.` }, 502) : json({ ok: true })
}
