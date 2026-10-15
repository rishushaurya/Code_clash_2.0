// Bring your own keys (docs/PLAN.md section 8, Gate 1 Keys API). Values are encrypted (api/_lib/keys.ts),
// never sent back (only the last four characters), never logged; every change is written to settings_log.
//
// GET    /api/keys              (owner)   { keys: KeyStatus[], ai: AiSettings, deployment }
// PUT    /api/keys              (owner)   { name, value, baseUrl? } -> KeyStatus
// DELETE /api/keys?name=        (owner)
// POST   /api/keys/test         (owner)   { name } -> { ok, error?, detail?, models? }; the result is stored too
// PUT    /api/keys/ai           (owner)   AiSettings
// GET    /api/keys/client       (member)  { google_maps }: the one key a browser uses by design (restrict it to
//                                          your domain in Google Cloud); no other key ever reaches a browser

import { z } from 'zod'
import { rest, settingsLog, upsert, writeDoc } from '../_lib/db.js'
import { json, limit, readBody, requireRole, storageError } from '../_lib/http.js'
import { AI_PROVIDERS, KEY_NAMES, NEEDS_URL, aiSettings, deploymentProviders, encrypt, getKey, keyStatus, publicUrl, secretRows, testKey } from '../_lib/keys.js'
import { readConnections } from './connections.js'
import { publicOrigin } from './telegram.js'

const Name = z.enum(KEY_NAMES)
const Provider = z.enum(AI_PROVIDERS)
const Choice = z.object({ provider: Provider, model: z.string().trim().max(120).regex(/^[A-Za-z0-9._:/@-]*$/, 'a model id') })

export const AiSettingsSchema = z.object({
  tasks: z.object({ chat: Choice, report: Choice, vision: Choice, speech: Choice }),
  fallback: z.array(Provider).max(AI_PROVIDERS.length),
  useDeploymentKeys: z.boolean(),
})

export async function GET(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const [list, ai] = await Promise.all([secretRows(c.id), aiSettings(c.id)])
  if (!list) return storageError(null)
  return json({ keys: KEY_NAMES.map((n) => keyStatus(n, list.find((r) => r.name === n))), ai, deployment: deploymentProviders() })
}

export async function PUT(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const body = await readBody(req, z.object({ name: Name, value: z.string().trim().min(4).max(4000), baseUrl: z.string().trim().max(500).optional() }), 10_000)
  if (body instanceof Response) return body
  let baseUrl: string | null = null
  if (NEEDS_URL.includes(body.name)) {
    if (!body.baseUrl) return json({ error: 'Add the server address for this key' }, 400)
    const checked = await publicUrl(body.baseUrl)
    if ('error' in checked) return json({ error: checked.error }, 400)
    baseUrl = checked.url
  }
  const row = { workspace: c.id, name: body.name, ciphertext: encrypt(c.id, body.name, body.value), last4: body.value.slice(-4), base_url: baseUrl, tested_at: null, ok: null, error: null, updated_at: new Date().toISOString() }
  const res = await upsert('secrets', row)
  if (!res?.ok) return storageError(res ?? undefined)
  await settingsLog(c.id, 'key.set', { name: body.name, last4: row.last4, ...(baseUrl && { baseUrl }) })
  return json(keyStatus(body.name, { ...row, name: body.name }))
}

export async function DELETE(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const name = Name.safeParse(new URL(req.url).searchParams.get('name'))
  if (!name.success) return json({ error: 'Unknown key name' }, 400)
  const res = await rest(`secrets?workspace=eq.${c.id}&name=eq.${name.data}`, { method: 'DELETE' })
  if (!res?.ok) return storageError(res ?? undefined)
  await settingsLog(c.id, 'key.delete', { name: name.data })
  return json({ ok: true })
}

export async function test(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  // Each test calls a provider: keep a stuck button from hammering it.
  const limited = await limit(req, 20)
  if (limited) return limited
  const body = await readBody(req, z.object({ name: Name }), 200)
  if (body instanceof Response) return body
  const key = await getKey(c.id, body.name)
  if (!key) return json({ error: 'That key is not set' }, 404)
  const shellyIds = body.name === 'shelly_cloud' ? (await readConnections(c.id)).shelly.map((e) => e.id) : undefined
  const result = await testKey(body.name, key, { workspace: c.id, origin: publicOrigin(req), shellyIds })
  await rest(`secrets?workspace=eq.${c.id}&name=eq.${body.name}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ tested_at: new Date().toISOString(), ok: result.ok, error: result.error ?? null }),
  })
  return json(result)
}

export async function putAi(req: Request) {
  const c = await requireRole(req, 'owner')
  if (c instanceof Response) return c
  const body = await readBody(req, AiSettingsSchema, 5_000)
  if (body instanceof Response) return body
  const res = await writeDoc(c.id, 'ai', body)
  if (!(res instanceof Response) || !res.ok) return storageError(res)
  await settingsLog(c.id, 'ai.settings', { chat: body.tasks.chat.provider, report: body.tasks.report.provider, vision: body.tasks.vision.provider, speech: body.tasks.speech.provider, useDeploymentKeys: body.useDeploymentKeys })
  return json({ ok: true })
}

export async function client(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  return json({ google_maps: (await getKey(c.id, 'google_maps'))?.value ?? null })
}
