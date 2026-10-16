// GET    /api/sessions        (owner)  Every signed-in session of the workspace: role, device, when, and which is yours
// DELETE /api/sessions?id=    (owner, or anyone for their own session)  Signs that session out, everywhere,
//                             within 30 seconds (each server instance remembers a check that long)

import { rest, settingsLog } from '../_lib/db.js'
import { forgetSession, json, requireRole, storageError } from '../_lib/http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function GET(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const res = await rest(`sessions?workspace=eq.${c.id}&revoked_at=is.null&select=id,role,label,created_at&order=created_at.desc&limit=500`)
  // 404: the sessions table is not created yet. Sign-in still works; only the device list waits for supabase/schema.sql.
  if (res?.status === 404) return json({ sessions: [], setup: true })
  if (!res?.ok) return storageError(res ?? null)
  const list = (await res.json()) as { id: string; role: string; label: string | null; created_at: string }[]
  return json({ sessions: list.map((s) => ({ id: s.id, role: s.role, device: s.label, createdAt: Date.parse(s.created_at), current: s.id === c.sid })) })
}

export async function DELETE(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return json({ error: 'Unknown session' }, 400)
  if (id !== c.sid && c.role !== 'owner') return json({ error: 'Only a workspace owner can do this' }, 403)
  const res = await rest(`sessions?workspace=eq.${c.id}&id=eq.${id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) })
  if (!res?.ok) return storageError(res ?? undefined)
  forgetSession(id)
  await settingsLog(c.id, 'session.revoke', { session: id, self: id === c.sid })
  return json({ ok: true })
}
