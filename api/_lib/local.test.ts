// A copy running on someone's own computer, with no Supabase and no WORKSPACE_SECRET: every route must work
// from the local file store.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { route } from '../router.js'
import { localRest, localSecret } from './local.js'

const dir = mkdtempSync(join(tmpdir(), 'pratibimb-local-'))
const call = async (path: string, body?: unknown, token?: string, method = body === undefined ? 'GET' : 'POST') => {
  const res = await route(
    new Request(`http://localhost/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) }),
  )
  return { status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> }
}

beforeAll(() => {
  process.env.PRATIBIMB_STORAGE = 'local'
  process.env.PRATIBIMB_DATA_DIR = dir
  for (const k of ['WORKSPACE_SECRET', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k]
})
afterAll(() => {
  delete process.env.PRATIBIMB_STORAGE
  delete process.env.PRATIBIMB_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('local storage', () => {
  it('runs workspaces, sites, events, keys and the tick without Supabase', async () => {
    expect((await call('status')).data).toMatchObject({ workspaces: true, local: true })

    const created = await call('workspace', { mode: 'create', name: 'Home Lab', password: 'local-pass-1' })
    expect(created.status).toBe(200)
    const token = created.data.token as string
    expect((await call('workspace', { mode: 'create', name: 'Home Lab', password: 'x-other-pass' })).status).toBe(409)
    expect((await call('workspace', { mode: 'open', name: 'Home Lab', password: 'wrong-pass-1' })).status).toBe(401)
    expect((await call('workspace', { mode: 'open', name: 'Home Lab', password: 'local-pass-1' })).status).toBe(200)

    const site = { version: 1, organization: '', buildingName: 'Home', location: null, currency: 'INR', tariffPerKwh: 8, gridKgPerKwh: 0.7, emptyDelayS: 300, leftOnProbability: 0.4, alertLanguages: ['en'], hours: { from: 9, to: 17, days: [0, 1, 2, 3, 4] }, autoOff: { enabled: false, minutes: 10 }, floors: [{ level: 0, name: 'Ground floor' }], rooms: [] }
    expect((await call('site', site, token, 'PUT')).status).toBe(200)
    expect(((await call('site', undefined, token)).data.site as { buildingName: string }).buildingName).toBe('Home')

    expect((await call('events', { events: [{ id: 'e1', ts: Date.now(), roomId: null, kind: 'command', text: 'Switch off (local test)' }] }, token)).status).toBe(200)
    expect(((await call('events?days=1', undefined, token)).data.actions as unknown[]).length).toBe(1)

    // A key is stored encrypted: the file never holds the value, and the API answers only its last four characters.
    expect((await call('keys', { name: 'groq', value: 'gsk_local_secret_value_1234' }, token, 'PUT')).status).toBe(200)
    const keys = (await call('keys', undefined, token)).data.keys as { name: string; set: boolean; last4?: string }[]
    expect(keys.find((k) => k.name === 'groq')).toMatchObject({ set: true, last4: '1234' })
    expect(readFileSync(join(dir, 'store.json'), 'utf8')).not.toContain('gsk_local_secret_value')

    expect((await call('health')).data).toMatchObject({ checks: { storage: 'ok', workspaces: 'ok' } })

    // Camera readings are stored, and the minute tick (run by the dev server locally) works the twin out from them.
    const reading = { roomId: 'LH-1', cameraId: 'LH-1/cam-1', sourceKind: 'webcam', ts: Date.now(), headcount: 3, zones: {}, confidence: 0.9 }
    expect((await call('reading', { readings: [reading] }, token)).status).toBe(200)
    expect((await call('tick', {}, 'not-the-secret')).status).toBe(401)
    expect((await call('tick', {}, localSecret())).status).toBe(200)
    expect((await call('state', undefined, token)).status).toBe(200)
  })

  it('answers the PostgREST filters the server uses', async () => {
    await localRest('events', { method: 'POST', body: JSON.stringify([{ ts: '2026-10-01T00:00:00Z', kind: 'alert', payload: { site: 'a' } }, { ts: '2026-10-05T00:00:00Z', kind: 'ack', payload: { site: 'b' } }]) })
    const got = async (q: string) => (await (await localRest(`events?${q}`)).json()) as { kind: string }[]
    expect((await got('payload->>site=eq.a&select=kind')).map((r) => r.kind)).toEqual(['alert'])
    expect((await got('ts=gte.2026-10-02&kind=in.(ack,alert)')).map((r) => r.kind)).toEqual(['ack'])
    expect((await got('or=(kind.eq.alert,payload->>site.eq.b)&order=ts.desc&limit=1')).map((r) => r.kind)).toEqual(['ack'])
    expect((await localRest('rpc/rate_hit', { method: 'POST', body: '{}' })).status).toBe(404)
  })
})
