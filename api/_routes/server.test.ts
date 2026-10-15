// The 24/7 twin, bring-your-own-keys, Telegram per workspace, device connections and roles, called through the
// router like Vercel does, against a small in-memory stand-in for Supabase's REST API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Site } from '../../src/shared/types'
import { route } from '../router.js'
import { signInvite, signToken, type Role } from '../_lib/auth.js'
import { aiCandidates, decrypt, encrypt, publicUrl } from '../_lib/keys.js'
import { shellyChannel } from './connections.js'
import { webhookSecret } from './telegram.js'

const SECRET = 'test-secret-that-is-at-least-32-characters'
const PLUG_HOST = 'https://93.184.215.14' // a public address literal: passes the private-network check with no DNS

type Row = Record<string, unknown>
const KEYS: Record<string, string[]> = {
  sites: ['id'],
  workspaces: ['id'],
  room_inputs: ['workspace', 'key'],
  twin_state: ['workspace'],
  room_hourly: ['workspace', 'room_id', 'hour'],
  secrets: ['workspace', 'name'],
  sessions: ['id'],
}

/** Enough of PostgREST for these routes: eq, neq, gte, lte, lt, in, is, like filters; upsert; patch; delete */
function fakeSupabase(outside: (url: URL, init: RequestInit) => Response | undefined = () => undefined) {
  const db: Record<string, Row[]> = {}
  const broadcasts: { topic: string; event: string; payload: Record<string, unknown> }[] = []
  const field = (row: Row, k: string) => (k.includes('->>') ? (row[k.split('->>')[0]] as Row | undefined)?.[k.split('->>')[1]] : row[k])
  const test = (row: Row, k: string, v: string) => {
    const [op, ...rest] = v.split('.')
    const val = rest.join('.')
    const f = field(row, k)
    if (op === 'eq') return String(f) === val
    if (op === 'neq') return String(f) !== val
    if (op === 'gte') return String(f) >= val
    if (op === 'lte') return String(f) <= val
    if (op === 'lt') return String(f) < val
    if (op === 'in') return val.slice(1, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(f))
    if (op === 'is') return val === 'null' ? f == null : f != null
    if (op === 'like') return new RegExp(`^${val.replace(/\*/g, '.*')}$`).test(String(f))
    return true
  }
  const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (url.hostname !== 'example.supabase.co') return outside(url, init) ?? new Response('{"ok":false}', { status: 404 })
    if (url.pathname.startsWith('/realtime/')) {
      broadcasts.push(...JSON.parse(String(init.body)).messages)
      return new Response('{}')
    }
    if (url.pathname === '/rest/v1/rpc/rate_hit') return new Response('1')
    const name = url.pathname.split('/').pop()!
    const table = (db[name] ??= [])
    const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit', 'on_conflict', 'or'].includes(k))
    const or = url.searchParams.get('or')
    const matches = (r: Row) =>
      filters.every(([k, v]) => test(r, k, v)) &&
      (!or || or.slice(1, -1).split(',').some((c) => { const [k, ...v] = c.split('.'); return test(r, k, v.join('.')) }))
    const method = init.method ?? 'GET'
    if (method === 'GET') return new Response(JSON.stringify(table.filter(matches)))
    if (method === 'POST') {
      const now = new Date().toISOString()
      for (const r of [JSON.parse(String(init.body))].flat() as Row[]) {
        const row: Row = { ts: now, updated_at: now, ...(name === 'events' || name === 'settings_log' ? { id: crypto.randomUUID() } : {}), ...r }
        const key = KEYS[name]
        const i = key ? table.findIndex((x) => key.every((k) => x[k] === row[k])) : -1
        if (i >= 0 && name === 'workspaces') return new Response('{}', { status: 409 })
        if (i >= 0) table[i] = { ...table[i], ...row }
        else table.push(row)
      }
      return new Response(null, { status: 201 })
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(String(init.body))
      table.forEach((r, i) => matches(r) && (table[i] = { ...r, ...patch }))
      return new Response(null, { status: 204 })
    }
    if (method === 'DELETE') {
      db[name] = table.filter((r) => !matches(r))
      return new Response(null, { status: 204 })
    }
    return new Response('{}', { status: 405 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { db, broadcasts, fetchMock, calls: (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part)) }
}

const call = (path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) =>
  route(
    new Request(`http://localhost/api/${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...(init.token && { authorization: `Bearer ${init.token}` }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  )

/** A signed-in session of `role`, with its row in sessions */
function member(fake: ReturnType<typeof fakeSupabase>, role: Role = 'owner', id = 'acme') {
  const sid = crypto.randomUUID()
  ;(fake.db.sessions ??= []).push({ id: sid, workspace: id, role, label: 'test', created_at: new Date().toISOString(), revoked_at: null })
  return { sid, token: signToken(id, Date.now(), { sid, role }) }
}

const site = (over: Partial<Site> = {}): Site => ({
  version: 1,
  organization: 'Acme College',
  buildingName: 'Main',
  location: null,
  currency: 'INR',
  tariffPerKwh: 10,
  gridKgPerKwh: 0.7,
  emptyDelayS: 60,
  leftOnProbability: 0.4,
  alertLanguages: ['en'],
  hours: { from: 9, to: 17, days: [0, 1, 2, 3, 4] },
  autoOff: { enabled: false, minutes: 1 },
  floors: [{ level: 0, name: 'Ground' }],
  rooms: [
    {
      id: 'LH-1',
      name: 'Lecture Hall 1',
      floor: 0,
      type: 'lecture_hall',
      capacity: 100,
      areaM2: 100,
      volumeM3: 300,
      windowSide: false,
      devices: [
        { id: 'LH-1/light-1', type: 'light', ratedW: 20, zone: 'L1', brickClass: 'Luminaire' },
        { id: 'LH-1/light-2', type: 'light', ratedW: 20, brickClass: 'Luminaire' },
        { id: 'LH-1/fan-1', type: 'fan', ratedW: 75, brickClass: 'Fan' },
      ],
    },
  ],
  ...over,
})

const camera = (headcount: number, lights: boolean) => ({ roomId: 'LH-1', cameraId: 'LH-1/cam-1', sourceKind: 'webcam', ts: Date.now(), headcount, zones: { L1: lights }, confidence: 0.9 })

beforeEach(() => {
  vi.stubEnv('WORKSPACE_SECRET', SECRET)
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
  vi.stubEnv('GROQ_API_KEY', '')
  vi.stubEnv('GEMINI_API_KEY', '')
  vi.stubEnv('COMMAND_WEBHOOK_URL', '')
  vi.stubEnv('CRON_SECRET', 'cron-secret-123456')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('key encryption', () => {
  it('round-trips, and refuses a ciphertext moved to another key name or workspace, or tampered with', () => {
    const ct = encrypt('acme', 'groq', 'gsk_live_value_1234')
    expect(ct).not.toContain('gsk_live')
    expect(decrypt('acme', 'groq', ct)).toBe('gsk_live_value_1234')
    expect(decrypt('acme', 'openai', ct)).toBeNull()
    expect(decrypt('beta', 'groq', ct)).toBeNull()
    const [v, iv, tag, data] = ct.split('.')
    expect(decrypt('acme', 'groq', [v, iv, tag, `A${data.slice(1)}`].join('.'))).toBeNull()
    vi.stubEnv('WORKSPACE_SECRET', 'another-secret-that-is-at-least-32-chars')
    expect(decrypt('acme', 'groq', ct)).toBeNull()
  })

  it('accepts only public https addresses for customer servers', async () => {
    expect(await publicUrl('http://93.184.215.14')).toMatchObject({ error: expect.stringContaining('https') })
    for (const bad of ['https://127.0.0.1', 'https://10.1.2.3', 'https://192.168.1.10:8123', 'https://169.254.169.254/latest', 'https://[::1]', 'https://localhost', 'https://ha.local', 'https://user:pw@93.184.215.14'])
      expect(await publicUrl(bad)).toHaveProperty('error')
    expect(await publicUrl('https://93.184.215.14/v1/')).toEqual({ url: 'https://93.184.215.14/v1' })
  })
})

describe('/api/keys', () => {
  it('stores a key encrypted, shows only its last four, and logs the change without the value', async () => {
    const fake = fakeSupabase()
    const { token } = member(fake)
    const res = await call('keys', { method: 'PUT', token, body: { name: 'groq', value: 'gsk_secret_value_9876' } })
    expect(await res.json()).toEqual({ name: 'groq', set: true, last4: '9876' })
    const row = fake.db.secrets[0]
    expect(JSON.stringify(row)).not.toContain('gsk_secret_value')
    expect(decrypt('acme', 'groq', String(row.ciphertext))).toBe('gsk_secret_value_9876')
    expect(fake.db.settings_log[0]).toMatchObject({ workspace: 'acme', action: 'key.set', detail: { name: 'groq', last4: '9876' } })

    const listed = await (await call('keys', { token })).json()
    expect(JSON.stringify(listed)).not.toContain('gsk_secret_value')
    expect(listed.keys.find((k: { name: string }) => k.name === 'groq')).toEqual({ name: 'groq', set: true, last4: '9876' })
    expect(listed.keys.find((k: { name: string }) => k.name === 'openai')).toEqual({ name: 'openai', set: false })
    expect(listed.ai.tasks.chat.provider).toBe('groq')

    expect((await call('keys?name=groq', { method: 'DELETE', token })).status).toBe(200)
    expect(fake.db.secrets).toHaveLength(0)
    expect(fake.db.settings_log.at(-1)).toMatchObject({ action: 'key.delete', detail: { name: 'groq' } })
  })

  it('refuses private or plain-http server addresses, and anyone but the owner', async () => {
    const fake = fakeSupabase()
    const { token } = member(fake)
    expect((await call('keys', { method: 'PUT', token, body: { name: 'home_assistant', value: 'long-lived-token', baseUrl: 'https://192.168.1.5:8123' } })).status).toBe(400)
    expect((await call('keys', { method: 'PUT', token, body: { name: 'custom', value: 'k-1234' } })).status).toBe(400)
    const manager = member(fake, 'manager')
    expect((await call('keys', { method: 'PUT', token: manager.token, body: { name: 'groq', value: 'gsk_1234' } })).status).toBe(403)
    expect((await call('keys', { token: manager.token })).status).toBe(403)
    expect(fake.db.secrets ?? []).toHaveLength(0)
  })

  it('tests a key against its provider with the stored value, and records the result', async () => {
    const fake = fakeSupabase((url, init) => {
      if (url.href === 'https://api.groq.com/openai/v1/models')
        return (init.headers as Record<string, string>).authorization === 'Bearer gsk_good_1234' ? new Response(JSON.stringify({ data: [{ id: 'llama' }, { id: 'gpt-oss' }] })) : new Response('{}', { status: 401 })
    })
    const { token } = member(fake)
    await call('keys', { method: 'PUT', token, body: { name: 'groq', value: 'gsk_good_1234' } })
    expect(await (await call('keys/test', { token, body: { name: 'groq' } })).json()).toEqual({ ok: true, models: ['gpt-oss', 'llama'] })
    expect(fake.db.secrets[0]).toMatchObject({ ok: true, error: null })
    await call('keys', { method: 'PUT', token, body: { name: 'groq', value: 'gsk_bad_5678' } })
    const bad = await (await call('keys/test', { token, body: { name: 'groq' } })).json()
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('401') })
    expect(JSON.stringify(bad)).not.toContain('gsk_bad')
  })

  it('gives a browser only the Google Maps key', async () => {
    const fake = fakeSupabase()
    const { token } = member(fake)
    await call('keys', { method: 'PUT', token, body: { name: 'google_maps', value: 'AIza-maps-key' } })
    await call('keys', { method: 'PUT', token, body: { name: 'openai', value: 'sk-openai-key' } })
    const viewer = member(fake, 'viewer')
    const got = await (await call('keys/client', { token: viewer.token })).json()
    expect(got).toEqual({ google_maps: 'AIza-maps-key' })
  })
})

describe('aiCandidates', () => {
  it("tries the workspace's chosen provider and model first, then its fallbacks, then the deployment's keys", async () => {
    vi.stubEnv('GROQ_API_KEY', 'deployment-groq')
    const fake = fakeSupabase()
    const { token } = member(fake)
    await call('keys', { method: 'PUT', token, body: { name: 'openai', value: 'sk-own-1234' } })
    await call('keys', { method: 'PUT', token, body: { name: 'anthropic', value: 'sk-ant-1234' } })
    const ai = { tasks: { chat: { provider: 'openai', model: 'gpt-x' }, report: { provider: 'groq', model: '' }, vision: { provider: 'gemini', model: '' }, speech: { provider: 'groq', model: '' } }, fallback: ['anthropic'], useDeploymentKeys: true }
    expect((await call('keys/ai', { method: 'PUT', token, body: ai })).status).toBe(200)
    const list = await aiCandidates('acme', 'chat')
    expect(list.map((c) => [c.provider, c.model, c.owner])).toEqual([
      ['openai', 'gpt-x', 'workspace'],
      ['anthropic', 'claude-haiku-5-5', 'workspace'],
      ['groq', 'openai/gpt-oss-120b', 'deployment'],
    ])
    expect(list[0]).toMatchObject({ url: 'https://api.openai.com/v1/chat/completions', apiKey: 'sk-own-1234' })
    // Speech skips providers without a speech model.
    expect((await aiCandidates('acme', 'speech')).map((c) => c.provider)).toEqual(['groq'])

    await call('keys/ai', { method: 'PUT', token, body: { ...ai, useDeploymentKeys: false } })
    expect((await aiCandidates('acme', 'chat')).every((c) => c.owner === 'workspace')).toBe(true)
    await call('keys/ai', { method: 'PUT', token, body: ai })
    vi.stubEnv('DEPLOYMENT_AI_KEYS', 'off')
    expect((await aiCandidates('acme', 'chat')).every((c) => c.owner === 'workspace')).toBe(true)
    expect(await aiCandidates(null, 'chat')).toEqual([])
  })
})

describe('/api/reading and /api/state', () => {
  it("stores each camera's latest reading with the server's clock, merges staff reports per room, and starts a browser from them", async () => {
    const fake = fakeSupabase()
    const { token } = member(fake, 'manager')
    const late = { ...camera(4, true), ts: Date.now() - 600_000 }
    expect((await call('reading', { token, body: { readings: [late] } })).status).toBe(200)
    const row = fake.db.room_inputs[0]
    expect(row).toMatchObject({ workspace: 'acme', key: 'LH-1/cam-1', room_id: 'LH-1', kind: 'camera' })
    expect(Math.abs((row.reading as { ts: number }).ts - Date.now())).toBeLessThan(5000)

    const manual = (type: string, on: boolean) => ({ roomId: 'LH-1', source: 'manual', ts: Date.now(), devices: [{ type, on }] })
    await call('reading', { token, body: { readings: [], sensors: [manual('light', false)] } })
    await call('reading', { token, body: { readings: [], sensors: [manual('fan', true)] } })
    const state = await (await call('state', { token })).json()
    expect(state.sensors['LH-1'].byType).toMatchObject({ light: { on: false, source: 'manual' }, fan: { on: true, source: 'manual' } })
    expect(state.readings).toHaveLength(1)

    const viewer = member(fake, 'viewer')
    expect((await call('reading', { token: viewer.token, body: { readings: [camera(1, true)] } })).status).toBe(403)
    expect((await call('reading', { token, body: { readings: [{ ...camera(1, true), cameraId: '../x' }] } })).status).toBe(400)
  })
})

describe('/api/tick', () => {
  it('runs the twin with no browser: alert, Telegram on the workspace bot, auto-off to the plug, history and heartbeat', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-15T10:00:00Z') })
    const telegram: Record<string, unknown>[] = []
    const switched: Record<string, unknown>[] = []
    const fake = fakeSupabase((url, init) => {
      if (url.href.startsWith('https://api.telegram.org/botown-token/')) {
        telegram.push({ method: url.pathname.split('/').pop(), ...JSON.parse(String(init.body)) })
        return new Response('{"ok":true,"result":{}}')
      }
      if (url.origin === PLUG_HOST && url.pathname === '/v2/devices/api/get')
        return new Response(JSON.stringify([{ id: 'plug1', online: 1, status: { 'switch:0': { output: switched.length === 0, apower: switched.length ? 0 : 75 } } }]))
      if (url.origin === PLUG_HOST && url.pathname === '/v2/devices/api/set/switch') {
        switched.push(JSON.parse(String(init.body)))
        return new Response('{}')
      }
    })
    const { token } = member(fake)
    await call('site', { method: 'PUT', token, body: site({ autoOff: { enabled: true, minutes: 1 } }) })
    await call('keys', { method: 'PUT', token, body: { name: 'telegram', value: 'own-token' } })
    await call('keys', { method: 'PUT', token, body: { name: 'shelly_cloud', value: 'shelly-auth', baseUrl: PLUG_HOST } })
    await call('connections', { method: 'PUT', token, body: { shelly: [{ roomId: 'LH-1', id: 'plug1', channel: 0, target: 'fans', power: false }] } })
    fake.db.sites.push({ id: 'acme/telegram', site: { bot: 'acme_bot', chatId: '-100500' } })

    const tick = async (seconds: number, people: number) => {
      vi.setSystemTime(Date.now() + seconds * 1000)
      await call('reading', { token, body: { readings: [camera(people, true)] } })
      const res = await call('tick', { body: {}, headers: { authorization: 'Bearer cron-secret-123456' } })
      expect(res.status).toBe(200)
      return res.json()
    }
    expect((await call('tick', { body: {} })).status).toBe(401)

    await tick(0, 5)
    const first = await tick(60, 0) // nobody seen: inside the empty delay
    expect(first.results[0]).toMatchObject({ workspace: 'acme', alerts: 0 })
    const state = () => (fake.db.twin_state.find((r) => r.workspace === 'acme')!.state as { rooms: Record<string, { status: string; watts: number; deviceOn: Record<string, boolean>; deviceSource: Record<string, string> }> }).rooms['LH-1']
    expect(state().status).toBe('occupied')
    expect(state().deviceSource).toMatchObject({ 'LH-1/light-1': 'camera', 'LH-1/light-2': 'inferred', 'LH-1/fan-1': 'sensor' })

    const second = await tick(70, 0) // past the 60 s delay: waste
    expect(state()).toMatchObject({ status: 'waste', watts: 115 })
    expect(second.results[0]).toMatchObject({ alerts: 1, telegram: 1, autoOff: 0 })
    const alert = telegram.find((t) => t.method === 'sendMessage')!
    expect(alert).toMatchObject({ chat_id: '-100500' })
    expect(String(alert.text)).toContain('LH-1')
    expect(fake.db.events.some((e) => e.kind === 'alert' && (e.payload as Row).text === 'LH-1: empty with load')).toBe(true)

    const third = await tick(60, 0) // empty delay plus one minute: switched off once, on the plug
    expect(third.results[0]).toMatchObject({ alerts: 0, telegram: 0, autoOff: 1 })
    expect(switched).toEqual([{ id: 'plug1', channel: 0, on: false }])
    expect(fake.broadcasts.some((b) => b.event === 'command' && b.payload.origin === 'policy')).toBe(true)
    await tick(60, 0)
    expect(switched).toHaveLength(1)

    const hours = await (await call('history?room=LH-1', { token })).json()
    expect(hours.hours).toHaveLength(1)
    expect(hours.hours[0]).toMatchObject({ roomId: 'LH-1', observedMinutes: 4 })
    expect(hours.hours[0].wasteKwh).toBeGreaterThan(0)
    expect(await (await call('status')).json()).toMatchObject({ serverTick: true })
    expect((await call('history?from=2026-01-01&to=2026-10-01', { token })).status).toBe(400)
  })

  it('reads Gen2 and Gen1 Shelly status', () => {
    expect(shellyChannel({ 'switch:1': { output: true, apower: 12.5 } }, 1)).toEqual({ on: true, watts: 12.5 })
    expect(shellyChannel({ relays: [{ ison: false }], meters: [{ power: 0 }] }, 0)).toEqual({ on: false, watts: 0 })
    expect(shellyChannel(undefined, 0)).toEqual({ on: undefined, watts: undefined })
  })
})

describe('Telegram per workspace', () => {
  it("connects the workspace's own bot, links the first chat that writes, and takes taps only from it", async () => {
    vi.stubEnv('PUBLIC_URL', 'https://pratibimb.example')
    const telegram: Record<string, unknown>[] = []
    const fake = fakeSupabase((url, init) => {
      if (!url.href.startsWith('https://api.telegram.org/bot123456:')) return undefined
      const method = url.pathname.split('/').pop()
      telegram.push({ method, ...JSON.parse(String(init.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'acme_bot' } : true }))
    })
    const { token } = member(fake)
    await call('keys', { method: 'PUT', token, body: { name: 'telegram', value: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' } })
    const connected = await (await call('telegram/connect', { token, body: {} })).json()
    expect(connected).toMatchObject({ ok: true, bot: '@acme_bot', chat: null })
    expect(telegram.find((t) => t.method === 'setWebhook')).toMatchObject({ url: 'https://pratibimb.example/api/telegram?ws=acme', secret_token: webhookSecret('acme') })

    const hook = (body: unknown, secret = webhookSecret('acme')) => call('telegram?ws=acme', { body, headers: { 'x-telegram-bot-api-secret-token': secret } })
    expect((await hook({ message: { text: 'hi', chat: { id: -1 } } }, 'wrong')).status).toBe(401)
    await hook({ message: { text: 'hello', chat: { id: -100777, title: 'Facility staff' } } })
    expect(await (await call('telegram/connect', { token })).json()).toMatchObject({ bot: 'acme_bot', chat: { id: '-100777', title: 'Facility staff' } })
    await hook({ message: { text: 'me too', chat: { id: -100999 } } })
    expect(await (await call('telegram/connect', { token })).json()).toMatchObject({ chat: { id: '-100777' } })

    await hook({ callback_query: { id: 'q1', data: 'off:acme:LH-1', message: { chat: { id: -100999 } } } })
    expect(fake.broadcasts.some((b) => b.event === 'command')).toBe(false)
    await hook({ callback_query: { id: 'q2', data: 'off:beta:LH-1', message: { chat: { id: -100777 } } } })
    expect(fake.broadcasts.some((b) => b.event === 'command')).toBe(false)
    await hook({ callback_query: { id: 'q3', data: 'off:acme:LH-1', message: { chat: { id: -100777 } } } })
    expect(fake.broadcasts.find((b) => b.event === 'command')?.payload).toMatchObject({ roomId: 'LH-1', origin: 'telegram' })
  })

  it('needs an https address for the webhook', async () => {
    const fake = fakeSupabase((url) => (url.hostname === 'api.telegram.org' ? new Response('{"ok":true,"result":{"username":"b"}}') : undefined))
    const { token } = member(fake)
    await call('keys', { method: 'PUT', token, body: { name: 'telegram', value: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' } })
    const res = await call('telegram/connect', { token, body: {} })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('PUBLIC_URL')
  })
})

describe('roles, sessions and the workspace', () => {
  it('signs in with a revocable session, invites by role, and enforces the role on writes', async () => {
    const fake = fakeSupabase()
    const owner = await (await call('workspace', { body: { mode: 'create', name: 'Acme', password: 'correct horse' } })).json()
    expect(owner).toMatchObject({ id: 'acme', role: 'owner' })
    expect(fake.db.sessions).toHaveLength(1)

    const { invite } = await (await call('workspace/invite', { token: owner.token, body: { role: 'viewer' } })).json()
    const viewer = await (await call('workspace', { body: { mode: 'join', invite } })).json()
    expect(viewer).toMatchObject({ id: 'acme', role: 'viewer' })
    expect((await call('workspace', { body: { mode: 'join', invite: `${invite}x` } })).status).toBe(401)
    expect((await call('workspace', { body: { mode: 'join', invite: signInvite('acme', 'owner', 1, Date.now() - 2 * 86_400_000) } })).status).toBe(401)

    expect((await call('site', { token: viewer.token })).status).not.toBe(403)
    expect((await call('site', { method: 'PUT', token: viewer.token, body: site() })).status).toBe(403)
    expect((await call('command', { token: viewer.token, body: { id: crypto.randomUUID(), ts: 1, roomId: 'LH-1', target: 'all', state: 'off', origin: 'ui' } })).status).toBe(403)
    expect((await call('workspace', { token: viewer.token })).status).toBe(200)
    expect(await (await call('workspace', { token: viewer.token })).json()).not.toHaveProperty('ingestKey')

    const list = await (await call('sessions', { token: owner.token })).json()
    expect(list.sessions).toHaveLength(2)
    const other = list.sessions.find((s: { current: boolean }) => !s.current)
    expect((await call(`sessions?id=${other.id}`, { method: 'DELETE', token: owner.token })).status).toBe(200)
    expect((await call('site', { token: viewer.token })).status).toBe(401)
    expect(fake.db.settings_log.some((r) => r.action === 'session.revoke')).toBe(true)
  })

  it('changes the password and signs every other session out', async () => {
    const fake = fakeSupabase()
    const owner = await (await call('workspace', { body: { mode: 'create', name: 'Acme', password: 'correct horse' } })).json()
    const second = await (await call('workspace', { body: { mode: 'open', name: 'Acme', password: 'correct horse' } })).json()
    expect((await call('workspace/password', { method: 'PUT', token: owner.token, body: { current: 'wrong pass', next: 'battery staple' } })).status).toBe(401)
    expect((await call('workspace/password', { method: 'PUT', token: owner.token, body: { current: 'correct horse', next: 'battery staple' } })).status).toBe(200)
    expect((await call('site', { token: second.token })).status).toBe(401)
    expect((await call('site', { token: owner.token })).status).not.toBe(401)
    expect((await call('workspace', { body: { mode: 'open', name: 'Acme', password: 'battery staple' } })).status).toBe(200)
    expect(fake.db.settings_log.some((r) => r.action === 'password.change')).toBe(true)
  })

  it('exports the workspace without key values, and deletes every row it owns', async () => {
    const fake = fakeSupabase()
    const owner = await (await call('workspace', { body: { mode: 'create', name: 'Acme', password: 'correct horse' } })).json()
    await call('site', { method: 'PUT', token: owner.token, body: site() })
    await call('keys', { method: 'PUT', token: owner.token, body: { name: 'openai', value: 'sk-very-secret-1234' } })
    fake.db.sites.push({ id: 'beta', site: {} })
    fake.db.room_inputs = [{ workspace: 'acme', key: 'LH-1/cam-1' }, { workspace: 'beta', key: 'X/cam-1' }]
    const dump = await (await call('workspace/export', { token: owner.token })).text()
    expect(dump).toContain('"last4":"1234"')
    expect(dump).not.toContain('sk-very-secret')
    expect(dump).not.toContain('ciphertext')
    expect((await call('workspace', { method: 'DELETE', token: owner.token, body: { password: 'nope nope' } })).status).toBe(401)
    expect((await call('workspace', { method: 'DELETE', token: owner.token, body: { password: 'correct horse' } })).status).toBe(200)
    expect(fake.db.workspaces).toHaveLength(0)
    expect(fake.db.sites.map((r) => r.id)).toEqual(['beta'])
    expect(fake.db.room_inputs).toEqual([{ workspace: 'beta', key: 'X/cam-1' }])
    expect(fake.db.secrets).toHaveLength(0)
  })

  it('counts rate limits in the database, so they hold across server instances', async () => {
    const fake = fakeSupabase()
    fake.fetchMock.mockImplementationOnce(async () => new Response('11'))
    expect((await call('workspace', { body: { mode: 'open', name: 'Acme', password: 'correct horse' } })).status).toBe(429)
    expect(fake.calls('rpc/rate_hit')).toHaveLength(1)
    expect(JSON.stringify(fake.calls('rpc/rate_hit')[0][1])).not.toContain('local') // the address is stored only as a keyed hash
  })
})

describe('/api/doctor', () => {
  it('lists every check with a fix for each failing one', async () => {
    const fake = fakeSupabase()
    const { token } = member(fake, 'manager')
    const res = await (await call('doctor', { token })).json()
    const names = res.checks.map((c: { name: string }) => c.name)
    expect(names).toEqual(expect.arrayContaining(['Server storage', 'Workspace secret', 'Server tick (24/7 twin)', 'Site', 'AI', 'Telegram alerts']))
    for (const c of res.checks) expect(c.ok || c.fix.length > 10).toBe(true)
    expect(res.checks.find((c: { name: string }) => c.name === 'Server tick (24/7 twin)')).toMatchObject({ ok: false, detail: 'Has never run' })
    expect((await call('doctor', { token: member(fake, 'viewer').token })).status).toBe(403)
  })
})
