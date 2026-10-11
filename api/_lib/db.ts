// Supabase REST access for server functions (service-role key; never sent to the browser).

/**
 * Supabase's address and the server's headers. SUPABASE_SERVICE_ROLE_KEY holds either a secret key
 * (sb_secret_...) or a legacy service_role key. Secret keys are not JWTs, so they go in `apikey` only;
 * Supabase rejects them in Authorization. Legacy keys are JWTs and go in both.
 */
export function supabase() {
  // The project URL, also when the REST address (…/rest/v1/) was pasted instead.
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.replace(/(\/rest\/v1)?\/*$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' }
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`
  return { url, headers }
}

export function table(name: 'events' | 'sites' | 'workspaces') {
  const sb = supabase()
  return sb ? { url: `${sb.url}/rest/v1/${name}`, headers: sb.headers } : null
}

export interface EventRow {
  ts: string
  room_id: string | null
  kind: string
  payload: { text?: string }
}

/** Events of one workspace since `days` ago, newest first; null when storage is missing or failing. */
export async function recentEvents(workspace: string, days: number): Promise<EventRow[] | null> {
  const d = table('events')
  if (!d) return null
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const res = await fetch(`${d.url}?ts=gte.${since}&payload->>site=eq.${workspace}&select=ts,room_id,kind,payload&order=ts.desc&limit=5000`, { headers: d.headers })
  return res.ok ? ((await res.json()) as EventRow[]) : null
}

/** A stored JSON document of a workspace: its site ("site") or its camera settings ("cameras") */
export const docId = (workspace: string, doc: 'site' | 'cameras') => (doc === 'site' ? workspace : `${workspace}/cameras`)

export async function readDoc(workspace: string, doc: 'site' | 'cameras'): Promise<{ value: unknown; updatedAt: string } | null | 'unavailable'> {
  const d = table('sites')
  if (!d) return 'unavailable'
  const res = await fetch(`${d.url}?id=eq.${encodeURIComponent(docId(workspace, doc))}&select=site,updated_at`, { headers: d.headers }).catch(() => null)
  if (!res?.ok) return 'unavailable'
  const rows = (await res.json()) as { site: unknown; updated_at: string }[]
  return rows[0] ? { value: rows[0].site, updatedAt: rows[0].updated_at } : null
}

export async function writeDoc(workspace: string, doc: 'site' | 'cameras', value: unknown) {
  const d = table('sites')
  if (!d) return false
  const res = await fetch(d.url, {
    method: 'POST',
    headers: { ...d.headers, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: docId(workspace, doc), site: value, updated_at: new Date().toISOString() }),
  }).catch(() => null)
  return Boolean(res?.ok)
}

/** The Telegram chat a workspace chose in Setup, from its stored site */
export async function telegramChat(workspace: string): Promise<string | null> {
  const doc = await readDoc(workspace, 'site')
  const chat = doc && doc !== 'unavailable' ? (doc.value as { telegramChatId?: unknown }).telegramChatId : null
  return typeof chat === 'string' && /^-?\d{1,20}$/.test(chat) ? chat : null
}
