import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ungroundedFigures } from './grounding.js'
import { chatJson } from './llm.js'

const facts = { roomId: 'LH-1', costPerHourNow: 5.67 }
const reply = (content: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('chatJson', () => {
  it('rejects an invented figure, asks again, and returns the grounded answer', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ text: 'LH-1 wastes ₹500 an hour' }))
      .mockResolvedValueOnce(reply({ text: 'LH-1 wastes ₹5.67 an hour' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await chatJson('system', 'user', z.object({ text: z.string() }), (o) => ungroundedFigures(o.text, facts))
    expect(out.text).toBe('LH-1 wastes ₹5.67 an hour')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1).content).toContain('₹500')
  })

  it('falls back to Gemini when Groq fails', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test')
    vi.stubEnv('GEMINI_API_KEY', 'test')
    const gemini = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: 'ok' }) }] } }] }))
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('rate limited', { status: 429 })).mockResolvedValueOnce(gemini)
    vi.stubGlobal('fetch', fetchMock)

    expect(await chatJson('s', 'u', z.object({ text: z.string() }))).toEqual({ text: 'ok' })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    // Gemini's own API key header, which takes both AIza and AQ. keys; never a Bearer token.
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': 'test' })
    expect(JSON.parse(init.body)).toMatchObject({ systemInstruction: { parts: [{ text: 's' }] }, contents: [{ role: 'user', parts: [{ text: 'u' }] }], generationConfig: { responseMimeType: 'application/json' } })
  })

  it('sends new Supabase secret keys in apikey only, and legacy JWT keys in both headers', async () => {
    const { supabase } = await import('./db.js')
    // The REST address pasted from the dashboard works as well as the project URL.
    vi.stubEnv('SUPABASE_URL', 'https://abc.supabase.co/rest/v1/')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_xyz')
    expect(supabase()).toEqual({ url: 'https://abc.supabase.co', headers: { apikey: 'sb_secret_xyz', 'content-type': 'application/json' } })
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOi.legacy.jwt')
    expect(supabase()?.headers.authorization).toBe('Bearer eyJhbGciOi.legacy.jwt')
  })
})
