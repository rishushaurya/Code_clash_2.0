// C11: two devices creating the same camera number must not overwrite each other's zones.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { route } from '../router.js'
import { signToken } from '../_lib/auth.js'

const put = (body: object) =>
  route(new Request('http://localhost/api/cameras', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken('acme')}` }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.stubEnv('WORKSPACE_SECRET', 'test-secret-that-is-at-least-32-characters')
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('PUT /api/cameras', () => {
  const theirs = { roomId: 'LH-1', name: 'Camera 1', zones: [], updatedAt: 5 }
  const mine = { roomId: 'LH-1', name: 'Camera 1', zones: [], updatedAt: 6 }

  it('refuses to create a camera id that exists, and accepts an update that names the copy it replaces', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response(null, { status: 201 }) : new Response(JSON.stringify([{ site: { cameras: { 'LH-1/cam-1': theirs } }, updated_at: 'x' }])),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect((await put({ id: 'LH-1/cam-1', config: mine })).status).toBe(409)
    expect(fetchMock).toHaveBeenCalledTimes(1) // read only, nothing written
    expect((await put({ id: 'LH-1/cam-2', config: mine })).status).toBe(200)
    expect((await put({ id: 'LH-1/cam-1', config: mine, base: 5 })).status).toBe(200)
    expect((await put({ id: 'LH-1/cam-1', config: null })).status).toBe(200)
  })
})
