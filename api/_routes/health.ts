// GET /api/health  For uptime monitors and for setting up: 200 when the server runs and, if storage is
// configured, Supabase answers. When it does not, `detail` says why, naming the setting to fix. No secrets.

import { authConfigured } from '../_lib/auth.js'
import { keyKind, localMode, rest, storageProblem, supabase } from '../_lib/db.js'
import { json } from '../_lib/http.js'

export async function GET() {
  const started = Date.now()
  let storage: 'ok' | 'down' | 'not configured' = 'not configured'
  let detail = storageProblem()
  if ((supabase() || localMode()) && !detail) {
    const res = await rest('sites?select=id&limit=1', { signal: AbortSignal.timeout(4000) })
    storage = res?.ok ? 'ok' : 'down'
    if (!res) detail = 'Supabase is not reachable. Check VITE_SUPABASE_URL.'
    else if (!res.ok) detail = `Supabase answered ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`
  } else if (supabase()) storage = 'down'
  const sb = supabase()
  return json(
    {
      status: storage === 'down' ? 'degraded' : 'ok',
      checks: { server: 'ok', storage, workspaces: storage === 'ok' && authConfigured() ? 'ok' : authConfigured() ? 'needs storage' : 'WORKSPACE_SECRET missing or under 32 characters' },
      ...(sb && { serverKey: keyKind(sb.headers.apikey) }),
      ...(localMode() && { storageKind: 'local file (.pratibimb-data)' }),
      ...(detail && { detail }),
      ms: Date.now() - started,
    },
    storage === 'down' ? 503 : 200,
  )
}
