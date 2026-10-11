// POST /api/workspace  { mode: 'create' | 'open', name, password }  ->  session
// GET  /api/workspace  (Bearer token)  ->  the workspace's channels and sensor key, to refresh a session
// A workspace keeps one customer's site, cameras, live channel and events apart from everyone else's.

import { z } from 'zod'
import { authConfigured, channels, checkPassword, hashPassword, ingestKey, signToken, workspaceId } from '../_lib/auth.js'
import { storageProblem, table } from '../_lib/db.js'
import { json, logJson, rateLimit, readBody, requireWorkspace, storageError } from '../_lib/http.js'

const Body = z.object({
  mode: z.enum(['create', 'open']),
  name: z.string().trim().min(3).max(40),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
})

const session = (id: string, name: string) => ({ token: signToken(id), id, name, ...channels(id) })

export async function POST(req: Request) {
  const limited = rateLimit(req, 10)
  if (limited) return limited
  const d = table('workspaces')
  // The browser falls back to a workspace kept on this device when the server cannot hold one.
  if (!d || !authConfigured()) return json({ error: 'This server has no workspace storage', local: true }, 503)
  // A wrong setting would otherwise pass as "Name or password is wrong" (the public key reads an empty table).
  if (storageProblem()) return storageError(null)
  const body = await readBody(req, Body, 1_000)
  if (body instanceof Response) return body
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
    return json(session(id, body.name))
  }

  const res = await fetch(`${d.url}?id=eq.${id}&select=name,password_hash`, { headers: d.headers }).catch((e: Error) => e)
  if (!(res instanceof Response) || !res.ok) return storageError(res)
  const [row] = (await res.json()) as { name: string; password_hash: string }[]
  // Same answer for an unknown name and a wrong password, so names cannot be probed.
  if (!row || !(await checkPassword(body.password, row.password_hash))) return json({ error: 'Name or password is wrong' }, 401)
  return json(session(id, row.name))
}

export function GET(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  return json({ id, ...channels(id), ingestKey: ingestKey(id) })
}
