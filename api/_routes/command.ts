// POST /api/command  (Bearer token, manager or owner)
// Logs a command, broadcasts it to the workspace's twin on other devices, and sends it to the customer's own
// systems: the signed command webhook, and the connected smart plugs and Home Assistant (api/_routes/connections.ts).

import { json, readBody, requireRole } from '../_lib/http.js'
import { CommandSchema } from '../_lib/schemas.js'
import { dispatchCommand } from './connections.js'

export async function POST(req: Request) {
  const c = await requireRole(req, 'manager')
  if (c instanceof Response) return c
  const cmd = await readBody(req, CommandSchema, 2_000)
  if (cmd instanceof Response) return cmd
  return json({ ok: true, ...(await dispatchCommand(c.id, cmd)) })
}
