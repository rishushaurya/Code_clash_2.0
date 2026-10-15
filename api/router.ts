// Every /api/* request lands here and goes to its handler in api/_routes.
// One function instead of one per file: Vercel's free plan allows 12 functions per deployment, and folders
// starting with "_" are not deployed as functions of their own. On Vercel, vercel.json rewrites /api/<path>
// to /api/router?path=<path> (a [...catch-all] file name matched only one path segment there, so /api/ai/*
// never arrived); the dev server passes the original path.

import { json, logJson } from './_lib/http.js'
import * as copilot from './_routes/ai/copilot.js'
import * as design from './_routes/ai/design.js'
import * as floorplan from './_routes/ai/floorplan.js'
import * as recommend from './_routes/ai/recommend.js'
import * as aiReport from './_routes/ai/report.js'
import * as setup from './_routes/ai/setup.js'
import * as surveyor from './_routes/ai/surveyor.js'
import * as transcribe from './_routes/ai/transcribe.js'
import * as alert from './_routes/alert.js'
import * as cameras from './_routes/cameras.js'
import * as command from './_routes/command.js'
import * as connections from './_routes/connections.js'
import * as digest from './_routes/digest.js'
import * as doctor from './_routes/doctor.js'
import * as events from './_routes/events.js'
import * as health from './_routes/health.js'
import * as history from './_routes/history.js'
import * as ingest from './_routes/ingest.js'
import * as keys from './_routes/keys.js'
import * as reading from './_routes/reading.js'
import * as report from './_routes/report.js'
import * as sessions from './_routes/sessions.js'
import * as site from './_routes/site.js'
import * as state from './_routes/state.js'
import * as status from './_routes/status.js'
import * as telegram from './_routes/telegram.js'
import * as tick from './_routes/tick.js'
import * as workspace from './_routes/workspace.js'

type Handler = (req: Request) => Response | Promise<Response>

const ROUTES: Record<string, Record<string, unknown>> = {
  'ai/copilot': copilot,
  'ai/design': design,
  'ai/floorplan': floorplan,
  'ai/recommend': recommend,
  'ai/report': aiReport,
  'ai/setup': setup,
  'ai/surveyor': surveyor,
  'ai/transcribe': transcribe,
  alert,
  cameras,
  command,
  connections,
  digest,
  doctor,
  events,
  health,
  history,
  ingest,
  keys: { GET: keys.GET, PUT: keys.PUT, DELETE: keys.DELETE },
  'keys/test': { POST: keys.test },
  'keys/ai': { PUT: keys.putAi },
  'keys/client': { GET: keys.client },
  reading,
  report,
  sessions,
  site,
  state,
  status,
  telegram: { POST: telegram.POST },
  'telegram/connect': { GET: telegram.connectGET, POST: telegram.connectPOST },
  tick: { GET: tick.GET, POST: tick.POST },
  workspace: { GET: workspace.GET, POST: workspace.POST, DELETE: workspace.DELETE },
  'workspace/password': { PUT: workspace.password },
  'workspace/invite': { POST: workspace.invite },
  'workspace/export': { GET: workspace.exportData },
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = (url.searchParams.get('path') ?? url.pathname.replace(/^\/api\//, '')).replace(/^\/+|\/+$/g, '')
  if (!Object.hasOwn(ROUTES, path)) return json({ error: 'Not found' }, 404)
  const handler = ROUTES[path][req.method]
  if (typeof handler !== 'function') return json({ error: 'Method not allowed' }, 405)
  try {
    return await (handler as Handler)(req)
  } catch (e) {
    logJson('error', 'unhandled', { path, error: String(e).slice(0, 300) })
    return json({ error: 'Internal error' }, 500)
  }
}

export { route as DELETE, route as GET, route as POST, route as PUT }
