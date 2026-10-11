// GET /api/site  (Bearer token)  The workspace's site, so every device (a phone camera, a second screen) sees the same rooms.
// PUT /api/site  (Bearer token)  Replace it. The browser validates the full schema on load.

import { z } from 'zod'
import { readDoc, writeDoc } from '../_lib/db.js'
import { json, readBody, requireWorkspace } from '../_lib/http.js'

const SiteBody = z.object({ version: z.literal(1), rooms: z.array(z.unknown()).max(2000), floors: z.array(z.unknown()).min(1) }).passthrough()

export async function GET(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const doc = await readDoc(id, 'site')
  if (doc === 'unavailable') return json({ error: 'Server storage is not configured or unavailable' }, 503)
  return json(doc ? { site: doc.value, updatedAt: doc.updatedAt } : { site: null })
}

export async function PUT(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const body = await readBody(req, SiteBody, 1_000_000)
  if (body instanceof Response) return body
  return (await writeDoc(id, 'site', body)) ? json({ ok: true }) : json({ error: 'Storage unavailable' }, 502)
}
