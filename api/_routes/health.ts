// GET /api/health  For uptime monitors and for setting up: 200 when the server runs and, if storage is
// configured, Supabase answers. When it does not, `detail` says why, naming the setting to fix. No secrets.

import { authConfigured } from '../_lib/auth.js'
import { keyKind, storageProblem, supabase, table } from '../_lib/db.js'
import { json } from '../_lib/http.js'

export async function GET() {
  const started = Date.now()
  const d = table('sites')
  let storage: 'ok' | 'down' | 'not configured' = 'not configured'
  let detail = storageProblem()
  if (d && !detail) {
    try {
      const res = await fetch(`${d.url}?select=id&limit=1`, { headers: d.headers, signal: AbortSignal.timeout(4000) })
      storage = res.ok ? 'ok' : 'down'
      if (!res.ok) detail = `Supabase answered ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`
    } catch (e) {
      storage = 'down'
      detail = `Supabase is not reachable (${(e as Error).message}). Check VITE_SUPABASE_URL.`
    }
  } else if (d) storage = 'down'
  const sb = supabase()
  return json(
    {
      status: storage === 'down' ? 'degraded' : 'ok',
      checks: { server: 'ok', storage, workspaces: storage === 'ok' && authConfigured() ? 'ok' : authConfigured() ? 'needs storage' : 'WORKSPACE_SECRET missing or under 32 characters' },
      ...(sb && { serverKey: keyKind(sb.headers.apikey) }),
      ...(detail && { detail }),
      ms: Date.now() - started,
    },
    storage === 'down' ? 503 : 200,
  )
}
