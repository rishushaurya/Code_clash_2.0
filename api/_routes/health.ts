// GET /api/health  For uptime monitors: 200 when the server runs and, if storage is configured, Supabase answers.

import { table } from '../_lib/db.js'
import { json } from '../_lib/http.js'

export async function GET() {
  const started = Date.now()
  const d = table('sites')
  let storage: 'ok' | 'down' | 'not configured' = 'not configured'
  if (d) {
    try {
      const res = await fetch(`${d.url}?select=id&limit=1`, { headers: d.headers, signal: AbortSignal.timeout(4000) })
      storage = res.ok ? 'ok' : 'down'
    } catch {
      storage = 'down'
    }
  }
  return json({ status: storage === 'down' ? 'degraded' : 'ok', checks: { server: 'ok', storage }, ms: Date.now() - started }, storage === 'down' ? 503 : 200)
}
