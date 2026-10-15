// GET /api/doctor  (manager or owner)  Every connection of the workspace, tested end to end now:
// [{ name, ok, detail, fix }]. `fix` says exactly what to do when a check fails. Never shows a key.

import type { KeyName, Site } from '../../src/shared/types'
import { authConfigured } from '../_lib/auth.js'
import { readDoc, rows, storageProblem, supabase, telegramChat } from '../_lib/db.js'
import { json, limit, requireRole } from '../_lib/http.js'
import { aiCandidates, testKey, workspaceKeys } from '../_lib/keys.js'
import { readConnections } from './connections.js'
import type { InputRow } from './reading.js'
import { TICK_HEALTHY_MS } from './status.js'
import { publicOrigin } from './telegram.js'

export interface Check {
  name: string
  ok: boolean
  detail: string
  fix: string
}

const LABEL: Record<KeyName, string> = {
  groq: 'Groq key',
  gemini: 'Google Gemini key',
  openai: 'OpenAI key',
  anthropic: 'Anthropic key',
  openrouter: 'OpenRouter key',
  custom: 'OpenAI-compatible AI server',
  telegram: 'Telegram bot',
  google_maps: 'Google Maps key',
  command_webhook: 'Command webhook',
  shelly_cloud: 'Shelly Cloud',
  home_assistant: 'Home Assistant',
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s ago` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`)

export async function GET(req: Request) {
  const c = await requireRole(req, 'manager')
  if (c instanceof Response) return c
  const limited = await limit(req, 10)
  if (limited) return limited
  const now = Date.now()
  const checks: Check[] = []
  const add = (name: string, ok: boolean, detail: string, fix = '') => checks.push({ name, ok, detail, fix: ok ? '' : fix })

  const problem = storageProblem()
  const beat = await rows<{ updated_at: string }>('twin_state?workspace=eq._tick&select=updated_at')
  add('Server storage', Boolean(supabase()) && !problem && beat !== null, problem ?? (beat === null ? 'Supabase did not answer, or the tables are missing' : 'Supabase answers'), 'Check the Supabase keys on the server and run supabase/schema.sql in the Supabase SQL editor (docs/DEPLOY.md, section 4).')
  add('Workspace secret', authConfigured(), authConfigured() ? 'Set' : 'Missing or shorter than 32 characters', 'Set WORKSPACE_SECRET on the server (docs/DEPLOY.md, section 3).')
  add('Live channel', Boolean(process.env.VITE_SUPABASE_ANON_KEY), process.env.VITE_SUPABASE_ANON_KEY ? 'Phones, cameras and sensors reach the twin over the internet' : 'No public Supabase key', 'Set VITE_SUPABASE_ANON_KEY and deploy again.')
  const tickAt = beat?.[0] ? Date.parse(beat[0].updated_at) : null
  add(
    'Server tick (24/7 twin)',
    tickAt !== null && now - tickAt < TICK_HEALTHY_MS,
    tickAt ? `Last run ${ago(now - tickAt)}` : 'Has never run',
    'Schedule /api/tick every minute with pg_cron (the commented block at the end of supabase/schema.sql), with CRON_SECRET set on the server.',
  )

  const [keys, site, conn, inputs, chat, ai] = await Promise.all([
    workspaceKeys(c.id),
    readDoc(c.id, 'site'),
    readConnections(c.id),
    rows<InputRow>(`room_inputs?workspace=eq.${c.id}&select=key,room_id,kind,ts`),
    telegramChat(c.id),
    aiCandidates(c.id, 'chat'),
  ])
  const rooms = site && site !== 'unavailable' ? ((site.value as Site).rooms ?? []) : []
  add('Site', rooms.length > 0, rooms.length ? `${rooms.length} rooms` : 'No rooms saved on the server', 'Open Settings, Site, add your rooms and Save.')
  add('AI', ai.length > 0, ai.length ? `${ai.length} provider${ai.length > 1 ? 's' : ''} to try, first ${ai[0].provider} (${ai[0].owner === 'workspace' ? 'your key' : 'the deployment'})` : 'No AI key', 'Add an AI key in Settings, Keys and AI. Without one the app writes advice from templates.')

  // Every stored key, tested against its provider now.
  const shellyIds = conn.shelly.map((e) => e.id)
  const tested = await Promise.all(
    (Object.entries(keys) as [KeyName, { value: string; baseUrl?: string }][]).map(async ([name, key]) => ({ name, r: await testKey(name, key, { workspace: c.id, origin: publicOrigin(req), shellyIds }).catch((e: Error) => ({ ok: false, error: e.message })) })),
  )
  for (const { name, r } of tested) add(LABEL[name], r.ok, r.ok ? ('detail' in r && r.detail) || 'The provider accepted the key' : (r.error ?? 'Failed'), `Copy the ${LABEL[name]} again into Settings, Keys and AI, then press Test.`)

  const bot = keys.telegram ? 'your own bot' : process.env.TELEGRAM_BOT_TOKEN ? "the deployment's bot" : null
  add('Telegram alerts', Boolean(bot && chat), !bot ? 'No bot' : chat ? `Alerts go to a linked chat through ${bot}` : `No chat linked to ${bot}`, bot ? 'Press Connect under Telegram in Settings, Keys and AI, then send any message to the bot from your staff group within 15 minutes.' : 'Create a bot with @BotFather, paste its token in Settings, Keys and AI, and press Connect.')
  const webhook = keys.command_webhook ? 'your webhook' : process.env.COMMAND_WEBHOOK_URL ? "the deployment's webhook" : null
  if (!keys.command_webhook) add('Command webhook', true, webhook ? `Commands go to ${webhook}` : 'Not used: commands go to the twin, plugs and Home Assistant', '')

  const known = new Set(rooms.map((r) => r.id))
  const unknown = [...conn.shelly.map((e) => e.roomId), ...conn.homeAssistant.map((e) => e.roomId)].filter((id) => !known.has(id))
  if (conn.shelly.length || conn.homeAssistant.length)
    add('Device connections', !unknown.length && (!conn.shelly.length || Boolean(keys.shelly_cloud)) && (!conn.homeAssistant.length || Boolean(keys.home_assistant)), `${conn.shelly.length} Shelly, ${conn.homeAssistant.length} Home Assistant${unknown.length ? `; unknown rooms: ${[...new Set(unknown)].join(', ')}` : ''}`, unknown.length ? 'Fix the room ids in Devices and integrations; they must match your site.' : 'Add the Shelly Cloud or Home Assistant key in Settings, Keys and AI.')

  for (const cam of (inputs ?? []).filter((r) => r.kind === 'camera')) {
    const age = now - Date.parse(cam.ts)
    add(`Camera ${cam.key}`, age < 60_000, `Last reading ${ago(age)}`, 'Open Cameras on the device that runs this camera and press Start; keep the page open and the device awake.')
  }
  const sensors = (inputs ?? []).filter((r) => r.kind === 'sensor')
  if (sensors.length) {
    const latest = Math.max(...sensors.map((r) => Date.parse(r.ts)))
    add('Sensors', now - latest < 15 * 60_000, `${sensors.length} room${sensors.length > 1 ? 's' : ''} with sensor readings; last ${ago(now - latest)}`, 'Check that your sensors or Home Assistant still post to /api/ingest with the sensor key (docs/INTEGRATIONS.md).')
  }
  return json({ checks, ok: checks.every((x) => x.ok) })
}
