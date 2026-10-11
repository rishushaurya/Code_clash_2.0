// Every /api/* request lands here and goes to its handler in api/_routes.
// One function instead of one per file: Vercel's free plan allows 12 functions per deployment, and folders
// starting with "_" are not deployed as functions of their own. On Vercel, vercel.json rewrites /api/<path>
// to /api/router?path=<path> (a [...catch-all] file name matched only one path segment there, so /api/ai/*
// never arrived); the dev server passes the original path.

import { json, logJson } from './_lib/http.js'
import * as copilot from './_routes/ai/copilot.js'
import * as recommend from './_routes/ai/recommend.js'
import * as aiReport from './_routes/ai/report.js'
import * as setup from './_routes/ai/setup.js'
import * as surveyor from './_routes/ai/surveyor.js'
import * as transcribe from './_routes/ai/transcribe.js'
import * as alert from './_routes/alert.js'
import * as cameras from './_routes/cameras.js'
import * as command from './_routes/command.js'
import * as digest from './_routes/digest.js'
import * as events from './_routes/events.js'
import * as health from './_routes/health.js'
import * as ingest from './_routes/ingest.js'
import * as report from './_routes/report.js'
import * as site from './_routes/site.js'
import * as status from './_routes/status.js'
import * as telegram from './_routes/telegram.js'
import * as workspace from './_routes/workspace.js'

type Handler = (req: Request) => Response | Promise<Response>

const ROUTES: Record<string, Record<string, unknown>> = {
  'ai/copilot': copilot,
  'ai/recommend': recommend,
  'ai/report': aiReport,
  'ai/setup': setup,
  'ai/surveyor': surveyor,
  'ai/transcribe': transcribe,
  alert,
  cameras,
  command,
  digest,
  events,
  health,
  ingest,
  report,
  site,
  status,
  telegram,
  workspace,
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

export { route as GET, route as POST, route as PUT }
