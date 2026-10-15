// Bring your own keys. Each workspace stores its own provider keys on the server, encrypted with AES-256-GCM
// under a key derived (HKDF-SHA256) from WORKSPACE_SECRET and the workspace id. The key's name is bound in
// as associated data, so a ciphertext cannot be moved to another name or workspace. Values are decrypted
// only inside server routes, never returned to a browser (except google_maps, by design) and never logged.
//
// aiCandidates() is the Gate 1 contract the AI routes call: the workspace's own keys and AiSettings first,
// then the deployment's environment keys when both the workspace and the operator allow it.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { AiProvider, AiSettings, AiTask, KeyName, KeyStatus } from '../../src/shared/types'
import { serverSecret } from './auth.js'
import { readDoc, rows } from './db.js'

export const KEY_NAMES = ['groq', 'gemini', 'openai', 'anthropic', 'openrouter', 'custom', 'telegram', 'google_maps', 'command_webhook', 'shelly_cloud', 'home_assistant'] as const satisfies readonly KeyName[]
export const AI_PROVIDERS = ['groq', 'gemini', 'openai', 'anthropic', 'openrouter', 'custom'] as const satisfies readonly AiProvider[]
/** Keys that only work together with the address of the server they belong to */
export const NEEDS_URL: readonly KeyName[] = ['custom', 'command_webhook', 'shelly_cloud', 'home_assistant']

// --- Encryption -----------------------------------------------------------------------------------

const keyFor = (workspace: string) => Buffer.from(hkdfSync('sha256', serverSecret()!, 'pratibimb-secrets-v1', `workspace:${workspace}`, 32))

export function encrypt(workspace: string, name: string, plain: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyFor(workspace), iv)
  c.setAAD(Buffer.from(`${workspace}:${name}`))
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${data.toString('base64')}`
}

/** The plain value, or null when the ciphertext was tampered with, moved, or WORKSPACE_SECRET changed */
export function decrypt(workspace: string, name: string, ciphertext: string): string | null {
  const [v, iv, tag, data] = ciphertext.split('.')
  if (v !== 'v1' || !iv || !tag || !data || !serverSecret()) return null
  try {
    const d = createDecipheriv('aes-256-gcm', keyFor(workspace), Buffer.from(iv, 'base64'))
    d.setAAD(Buffer.from(`${workspace}:${name}`))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

// --- Stored keys ----------------------------------------------------------------------------------

export interface SecretRow {
  name: KeyName
  ciphertext: string
  last4: string | null
  base_url: string | null
  tested_at: string | null
  ok: boolean | null
  error: string | null
}

export interface StoredKey {
  value: string
  baseUrl?: string
}

export const secretRows = (workspace: string) => rows<SecretRow>(`secrets?workspace=eq.${encodeURIComponent(workspace)}&select=name,ciphertext,last4,base_url,tested_at,ok,error`)

/** Every key the workspace stored, decrypted; empty when storage is missing */
export async function workspaceKeys(workspace: string): Promise<Partial<Record<KeyName, StoredKey>>> {
  const out: Partial<Record<KeyName, StoredKey>> = {}
  for (const r of (await secretRows(workspace)) ?? []) {
    const value = decrypt(workspace, r.name, r.ciphertext)
    if (value) out[r.name] = { value, ...(r.base_url && { baseUrl: r.base_url }) }
  }
  return out
}

export const getKey = async (workspace: string, name: KeyName) => (await workspaceKeys(workspace))[name] ?? null

export const keyStatus = (name: KeyName, r?: SecretRow): KeyStatus =>
  r
    ? {
        name,
        set: true,
        ...(r.last4 && { last4: r.last4 }),
        ...(r.base_url && { baseUrl: r.base_url }),
        ...(r.tested_at && { testedAt: Date.parse(r.tested_at) }),
        ...(r.ok !== null && { ok: r.ok }),
        ...(r.error && { error: r.error }),
      }
    : { name, set: false }

// --- Addresses customers type in ------------------------------------------------------------------

const privateV4 = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
}
const privateIp = (ip: string) => {
  if (isIP(ip) === 4) return privateV4(ip)
  const v6 = ip.toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  if (mapped) return privateV4(mapped[1])
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff') || v6.startsWith('64:ff9b')
}

/**
 * A customer's server address, checked before the server calls it: https only, no credentials in it, and
 * every address it resolves to must be public, so a key cannot make this server call into a private network.
 * seniordev: checked at save and before each call; DNS could still change between the check and the fetch.
 */
export async function publicUrl(raw: string): Promise<{ url: string } | { error: string }> {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { error: 'That is not a web address' }
  }
  if (u.protocol !== 'https:') return { error: 'Use an https:// address' }
  if (u.username || u.password) return { error: 'Leave the user name and password out of the address' }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|test)$/.test(host)) return { error: 'Use the public address of the server, not a local one' }
  const addresses = isIP(host) ? [host] : await lookup(host, { all: true }).then((a) => a.map((x) => x.address), () => [])
  if (!addresses.length) return { error: `Cannot find ${host}` }
  if (addresses.some(privateIp)) return { error: 'That address is on a private network; the server cannot reach it' }
  return { url: u.toString().replace(/\/+$/, '') }
}

/** fetch for addresses customers typed: checked first, no redirects, a timeout */
export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  const checked = await publicUrl(raw)
  if ('error' in checked) throw new Error(checked.error)
  return fetch(raw, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(8000) })
}

// --- AI providers ---------------------------------------------------------------------------------

export const DEFAULT_AI: AiSettings = {
  tasks: { chat: { provider: 'groq', model: '' }, report: { provider: 'groq', model: '' }, vision: { provider: 'gemini', model: '' }, speech: { provider: 'groq', model: '' } },
  fallback: ['groq', 'gemini'],
  useDeploymentKeys: true,
}

/** The workspace's AI choices (stored like the camera settings, as the document <id>/ai) */
export async function aiSettings(workspace: string): Promise<AiSettings> {
  const doc = await readDoc(workspace, 'ai')
  const v = doc && doc !== 'unavailable' ? (doc.value as Partial<AiSettings>) : {}
  return { ...DEFAULT_AI, ...v, tasks: { ...DEFAULT_AI.tasks, ...v.tasks } }
}

const CHAT_URL: Record<Exclude<AiProvider, 'gemini' | 'custom'>, string> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  // Anthropic's OpenAI-compatible endpoint
  anthropic: 'https://api.anthropic.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
}

/** Used when the workspace leaves the model empty. A provider without a model for a task is skipped for it. */
const DEFAULT_MODEL: Record<AiProvider, Partial<Record<AiTask, string>>> = {
  groq: { chat: 'openai/gpt-oss-120b', report: 'openai/gpt-oss-120b', speech: 'whisper-large-v3-turbo' },
  gemini: { chat: 'gemini-flash-latest', report: 'gemini-flash-latest', vision: 'gemini-flash-latest' },
  openai: { chat: 'gpt-5-mini', report: 'gpt-5-mini', vision: 'gpt-5-mini', speech: 'whisper-1' },
  anthropic: { chat: 'claude-haiku-5-5', report: 'claude-haiku-5-5', vision: 'claude-haiku-5-5' },
  openrouter: { chat: 'openrouter/auto', report: 'openrouter/auto', vision: 'openrouter/auto' },
  custom: {},
}
/** Providers with a speech-to-text model on an OpenAI-compatible API */
const SPEECH: AiProvider[] = ['groq', 'openai', 'custom']

export interface AiCandidate {
  provider: AiProvider
  /** OpenAI-compatible chat completions URL, or Gemini's generateContent URL */
  url: string
  apiKey: string
  model: string
  /** 'workspace' when the customer's own key, 'deployment' when the operator's */
  owner: 'workspace' | 'deployment'
}

function candidate(provider: AiProvider, model: string, apiKey: string, owner: AiCandidate['owner'], baseUrl?: string): AiCandidate {
  const url =
    provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      : provider === 'custom'
        ? `${baseUrl}/chat/completions`
        : CHAT_URL[provider]
  return { provider, url, apiKey, model, owner }
}

/** The operator can keep customers off the deployment's own AI quota: DEPLOYMENT_AI_KEYS=off */
export const deploymentKeysAllowed = () => process.env.DEPLOYMENT_AI_KEYS?.trim().toLowerCase() !== 'off'

/** Which AI providers the deployment itself has keys for (and lets workspaces use) */
export function deploymentProviders(): Record<AiProvider, boolean> {
  const on = deploymentKeysAllowed()
  return { groq: on && Boolean(process.env.GROQ_API_KEY), gemini: on && Boolean(process.env.GEMINI_API_KEY), openai: false, anthropic: false, openrouter: false, custom: false }
}

function deploymentCandidates(task: AiTask): AiCandidate[] {
  const env = process.env
  const groqModel = (task === 'vision' ? env.GROQ_VISION_MODEL : task === 'speech' ? 'whisper-large-v3-turbo' : env.GROQ_MODEL) || (task === 'vision' ? '' : 'openai/gpt-oss-120b')
  const groq = env.GROQ_API_KEY && groqModel ? [candidate('groq', groqModel, env.GROQ_API_KEY, 'deployment')] : []
  const geminiModels = [...new Set([env.GEMINI_MODEL?.trim() || 'gemini-flash-latest', 'gemini-flash-lite-latest'])]
  const geminis = env.GEMINI_API_KEY && task !== 'speech' ? geminiModels.map((m) => candidate('gemini', m, env.GEMINI_API_KEY!, 'deployment')) : []
  return task === 'vision' ? [...geminis, ...groq] : [...groq, ...geminis]
}

/** The ordered list of providers, models and keys an AI call of this workspace and task tries */
export async function aiCandidates(workspaceId: string | null, task: AiTask): Promise<AiCandidate[]> {
  const out: AiCandidate[] = []
  if (workspaceId) {
    const [settings, keys] = await Promise.all([aiSettings(workspaceId), workspaceKeys(workspaceId)])
    const choice = settings.tasks[task]
    for (const p of new Set([choice.provider, ...settings.fallback])) {
      const k = keys[p]
      const model = (p === choice.provider && choice.model) || DEFAULT_MODEL[p][task]
      if (!k || !model || (task === 'speech' && !SPEECH.includes(p)) || (p === 'custom' && !k.baseUrl)) continue
      out.push(candidate(p, model, k.value, 'workspace', k.baseUrl))
    }
    if (!settings.useDeploymentKeys) return out
  }
  return deploymentKeysAllowed() ? [...out, ...deploymentCandidates(task)] : out
}

// --- Testing a key against its provider -----------------------------------------------------------

export interface KeyTest {
  ok: boolean
  error?: string
  /** What the provider said about the key, for example the bot's name */
  detail?: string
  models?: string[]
}

const refused = (status: number) => (status === 401 || status === 403 ? `The key was refused (${status}). Copy it again from the provider.` : `The provider answered ${status}. Try again later.`)

async function getJson(url: string, init: RequestInit = {}, own = false): Promise<{ res: Response; body: Record<string, unknown> } | { error: string }> {
  try {
    const res = own ? await safeFetch(url, init) : await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
    return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  } catch (e) {
    return { error: `Could not reach the server: ${(e as Error).message}`.slice(0, 200) }
  }
}

const ids = (list: unknown, field = 'id', strip = '') =>
  Array.isArray(list)
    ? list
        .map((m) => String((m as Record<string, unknown>)[field] ?? '').replace(strip, ''))
        .filter(Boolean)
        .sort()
        .slice(0, 300)
    : undefined

async function openAiModels(url: string, value: string, own = false): Promise<KeyTest> {
  const r = await getJson(url, { headers: { authorization: `Bearer ${value}` } }, own)
  if ('error' in r) return { ok: false, error: r.error }
  return r.res.ok ? { ok: true, models: ids(r.body.data) } : { ok: false, error: refused(r.res.status) }
}

/**
 * Calls the provider with the key, harmlessly: list models for AI providers, getMe for Telegram, the 3D tiles
 * root for Google Maps (sent with this site's address as Referer, so a key restricted to the site passes),
 * a status call for Shelly Cloud and Home Assistant, and a signed ping for the command webhook.
 * Never echoes the key: provider texts are passed through `redact`.
 */
export async function testKey(name: KeyName, key: StoredKey, ctx: { workspace: string; origin: string; shellyIds?: string[] }): Promise<KeyTest> {
  const { value, baseUrl } = key
  const redact = (t: unknown) => String(t ?? '').split(value).join('***').slice(0, 200)
  switch (name) {
    case 'groq':
      return openAiModels('https://api.groq.com/openai/v1/models', value)
    case 'openai':
      return openAiModels('https://api.openai.com/v1/models', value)
    case 'custom':
      return baseUrl ? openAiModels(`${baseUrl}/models`, value, true) : { ok: false, error: 'Add the server address' }
    case 'openrouter': {
      const r = await getJson('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${value}` } })
      if ('error' in r) return { ok: false, error: r.error }
      if (!r.res.ok) return { ok: false, error: refused(r.res.status) }
      const m = await getJson('https://openrouter.ai/api/v1/models')
      return { ok: true, models: 'error' in m ? undefined : ids(m.body.data) }
    }
    case 'anthropic': {
      const r = await getJson('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' } })
      if ('error' in r) return { ok: false, error: r.error }
      return r.res.ok ? { ok: true, models: ids(r.body.data) } : { ok: false, error: refused(r.res.status) }
    }
    case 'gemini': {
      const r = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': value } })
      if ('error' in r) return { ok: false, error: r.error }
      if (!r.res.ok) return { ok: false, error: refused(r.res.status) }
      const chat = Array.isArray(r.body.models) ? r.body.models.filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent')) : []
      return { ok: true, models: ids(chat, 'name', 'models/') }
    }
    case 'telegram': {
      if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(value)) return { ok: false, error: 'A bot token looks like 123456789:ABC... (from @BotFather)' }
      const r = await getJson(`https://api.telegram.org/bot${value}/getMe`)
      if ('error' in r) return { ok: false, error: redact(r.error) }
      const bot = r.body.result as { username?: string } | undefined
      return r.res.ok && bot?.username ? { ok: true, detail: `@${bot.username}` } : { ok: false, error: refused(r.res.status) }
    }
    case 'google_maps': {
      const r = await getJson(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(value)}`, { headers: { referer: `${ctx.origin}/` } })
      if ('error' in r) return { ok: false, error: redact(r.error) }
      const message = (r.body.error as { message?: string } | undefined)?.message
      return r.res.ok ? { ok: true, detail: 'Map Tiles API answered' } : { ok: false, error: redact(message ?? refused(r.res.status)) }
    }
    case 'shelly_cloud': {
      if (!baseUrl) return { ok: false, error: 'Add the server address from the Shelly app (User settings, Authorization cloud key)' }
      const shellyIds = (ctx.shellyIds ?? []).slice(0, 10)
      const r = shellyIds.length
        ? await getJson(`${baseUrl}/v2/devices/api/get?auth_key=${encodeURIComponent(value)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: shellyIds, select: ['status'] }) }, true)
        : await getJson(`${baseUrl}/device/all_status`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `auth_key=${encodeURIComponent(value)}` }, true)
      if ('error' in r) return { ok: false, error: redact(r.error) }
      if (!r.res.ok || r.body.isok === false) return { ok: false, error: redact(r.body.error ?? refused(r.res.status)) }
      const online = Array.isArray(r.body) ? r.body.filter((d: { online?: number }) => d.online).length : 0
      return { ok: true, detail: shellyIds.length ? `${online} of ${shellyIds.length} devices online` : 'Shelly Cloud accepted the key' }
    }
    case 'home_assistant': {
      if (!baseUrl) return { ok: false, error: 'Add the address of your Home Assistant (https, reachable from the internet)' }
      const r = await getJson(`${baseUrl}/api/`, { headers: { authorization: `Bearer ${value}` } }, true)
      if ('error' in r) return { ok: false, error: redact(r.error) }
      return r.res.ok ? { ok: true, detail: String(r.body.message ?? 'API running') } : { ok: false, error: refused(r.res.status) }
    }
    case 'command_webhook': {
      if (!baseUrl) return { ok: false, error: 'Add the webhook address' }
      const body = JSON.stringify({ type: 'ping', workspace: ctx.workspace, ts: Date.now() })
      try {
        const res = await safeFetch(baseUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pratibimb-signature': `sha256=${createHmac('sha256', value).update(body).digest('hex')}` }, body })
        return res.ok ? { ok: true, detail: `Your server answered ${res.status}` } : { ok: false, error: `Your server answered ${res.status}` }
      } catch (e) {
        return { ok: false, error: redact((e as Error).message) }
      }
    }
  }
}
