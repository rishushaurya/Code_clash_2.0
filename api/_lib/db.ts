// Storage for server functions: Supabase's REST API (service-role key; never sent to the browser), or, on a
// computer running Pratibimb without Supabase, the same calls answered from a local file (local.ts).

import { localRest, localSecret } from './local.js'

/** An environment value as pasted into a dashboard: without surrounding spaces, line breaks or quotes */
export function setting(...names: string[]) {
  for (const name of names) {
    const v = process.env[name]?.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
    if (v) return v
  }
  return undefined
}

/** What the server key is, so the public key pasted in its place is named instead of failing as "unavailable" */
export function keyKind(key: string): 'secret' | 'service_role' | 'publishable' | 'anon' | 'unknown' {
  if (key.startsWith('sb_secret_')) return 'secret'
  if (key.startsWith('sb_publishable_')) return 'publishable'
  try {
    const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role
    return role === 'service_role' ? 'service_role' : role === 'anon' ? 'anon' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** A setting that cannot work, in words a person can act on; null when the settings look right */
export function storageProblem(): string | null {
  const sb = supabase()
  if (!sb) return null
  if (!/^https:\/\/[^/\s]+$/.test(sb.url)) return 'VITE_SUPABASE_URL must be the project URL, like https://<project-ref>.supabase.co'
  const kind = keyKind(sb.headers.apikey)
  if (kind === 'publishable' || kind === 'anon') return 'SUPABASE_SERVICE_ROLE_KEY holds the public key. Use the secret key (sb_secret_...) or the legacy service_role key.'
  return null
}

/**
 * Supabase's address and the server's headers. SUPABASE_SERVICE_ROLE_KEY holds either a secret key
 * (sb_secret_...) or a legacy service_role key. Secret keys are not JWTs, so they go in `apikey` only;
 * Supabase rejects them in Authorization. Legacy keys are JWTs and go in both.
 */
export function supabase() {
  // The project URL, also when the REST address (…/rest/v1/) was pasted instead.
  const url = setting('SUPABASE_URL', 'VITE_SUPABASE_URL')?.replace(/(\/rest\/v1)?\/*$/, '')
  const key = setting('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' }
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`
  return { url, headers }
}

/**
 * Local storage on this computer instead of Supabase. Automatic for a copy without Supabase keys that is not
 * running on Vercel; PRATIBIMB_STORAGE=local or =supabase decides it explicitly. Tests opt in themselves.
 */
export function localMode() {
  const mode = process.env.PRATIBIMB_STORAGE?.trim().toLowerCase()
  if (mode === 'local') return true
  if (mode === 'supabase') return false
  return !process.env.VERCEL && !process.env.VITEST && !supabase()
}

/** Somewhere to keep workspaces, sites, events and keys: Supabase, or the local file */
export const storageReady = () => localMode() || supabase() !== null

/** CRON_SECRET, or this computer's own secret when running locally */
export const cronSecret = () => setting('CRON_SECRET') ?? (localMode() ? localSecret() : undefined)

export type TableName = 'events' | 'sites' | 'workspaces' | 'room_inputs' | 'twin_state' | 'room_hourly' | 'secrets' | 'settings_log' | 'sessions'

export function table(name: TableName) {
  const sb = supabase()
  return sb ? { url: `${sb.url}/rest/v1/${name}`, headers: sb.headers } : null
}

/**
 * One PostgREST call: `rest('room_inputs?workspace=eq.acme')`. Null when storage is not configured or not
 * reachable, so callers decide what a missing answer means.
 */
export async function rest(path: string, init: RequestInit = {}): Promise<Response | null> {
  if (localMode()) return localRest(path, init)
  const sb = supabase()
  if (!sb) return null
  return fetch(`${sb.url}/rest/v1/${path}`, { ...init, headers: { ...sb.headers, ...(init.headers as Record<string, string>) }, signal: init.signal ?? AbortSignal.timeout(8000) }).catch(() => null)
}

/** Rows of a GET, or null when storage is missing or failing */
export async function rows<T>(path: string): Promise<T[] | null> {
  const res = await rest(path)
  const body = res?.ok ? await res.json().catch(() => null) : null
  return Array.isArray(body) ? (body as T[]) : null
}

/** Insert or replace rows (upsert on the primary key) */
export const upsert = (name: TableName, body: unknown, onConflict?: string) =>
  rest(`${name}${onConflict ? `?on_conflict=${onConflict}` : ''}`, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body) })

/** Who changed which setting, and when; never a key's value */
export async function settingsLog(workspace: string, action: string, detail: Record<string, unknown> = {}) {
  await rest('settings_log', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ workspace, action, detail }) })
}

export interface EventRow {
  ts: string
  room_id: string | null
  kind: string
  payload: { text?: string }
}

/** Events of one workspace since `days` ago, newest first; null when storage is missing or failing. */
export async function recentEvents(workspace: string, days: number): Promise<EventRow[] | null> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return rows<EventRow>(`events?ts=gte.${since}&payload->>site=eq.${workspace}&select=ts,room_id,kind,payload&order=ts.desc&limit=5000`)
}

/**
 * A stored JSON document of a workspace: its site ("site"), camera settings ("cameras"), AI choices ("ai"),
 * device connections ("connections") or linked Telegram chat ("telegram")
 */
export type Doc = 'site' | 'cameras' | 'ai' | 'connections' | 'telegram'
export const docId = (workspace: string, doc: Doc) => (doc === 'site' ? workspace : `${workspace}/${doc}`)

export async function readDoc(workspace: string, doc: Doc): Promise<{ value: unknown; updatedAt: string } | null | 'unavailable'> {
  const found = await rows<{ site: unknown; updated_at: string }>(`sites?id=eq.${encodeURIComponent(docId(workspace, doc))}&select=site,updated_at`)
  if (!found) return 'unavailable'
  return found[0] ? { value: found[0].site ?? null, updatedAt: found[0].updated_at } : null
}

/** Saves the document; returns Supabase's response (or the network error) for the caller to judge */
export async function writeDoc(workspace: string, doc: Doc, value: unknown): Promise<Response | Error> {
  const res = await rest('sites', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: docId(workspace, doc), site: value, updated_at: new Date().toISOString() }),
  })
  return res ?? new Error('Server storage is not configured')
}

/** The Telegram chat linked to a workspace: the one that first wrote to its bot, else the one chosen in Setup */
export async function telegramChat(workspace: string): Promise<string | null> {
  const valid = (c: unknown) => (typeof c === 'string' && /^-?\d{1,20}$/.test(c) ? c : null)
  const linked = await readDoc(workspace, 'telegram')
  const chat = linked && linked !== 'unavailable' ? valid((linked.value as { chatId?: unknown } | null)?.chatId) : null
  if (chat) return chat
  const doc = await readDoc(workspace, 'site')
  return doc && doc !== 'unavailable' ? valid((doc.value as { telegramChatId?: unknown } | null)?.telegramChatId) : null
}
