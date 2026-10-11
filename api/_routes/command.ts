// POST /api/command  (Bearer token)
// Logs a command, broadcasts it to the workspace's twin on other devices, and forwards it to the customer's
// own control system through the signed command webhook, if one is configured.

import { broadcast, forwardCommand, json, logEvent, readBody, requireWorkspace } from '../_lib/http.js'
import { CommandSchema } from '../_lib/schemas.js'

export async function POST(req: Request) {
  const id = requireWorkspace(req)
  if (id instanceof Response) return id
  const cmd = await readBody(req, CommandSchema, 2_000)
  if (cmd instanceof Response) return cmd
  const [broadcasted, forwarded] = await Promise.all([broadcast(id, 'command', cmd), forwardCommand(id, cmd)])
  await logEvent(id, cmd.roomId, 'command', cmd)
  return json({ ok: true, broadcasted, forwarded })
}
