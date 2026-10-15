import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ungroundedFigures } from './grounding.js'
import type { AiCandidate } from './keys.js'
import * as keys from './keys.js'
import { aiFailure, chatJson, NoAiKey, transcribeAudio } from './llm.js'

const facts = { roomId: 'LH-1', costPerHourNow: 5.67 }
const reply = (content: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))
const ai = { workspace: 'ws-1', task: 'chat' as const }
const Text = z.object({ text: z.string() })

/** The workspace's own keys, as the Server session's aiCandidates() returns them */
const own = (provider: AiCandidate['provider'], model = '', url = ''): AiCandidate => ({ provider, url, apiKey: `key-${provider}`, model, owner: 'workspace' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('chatJson with the deployment keys', () => {
  it('rejects an invented figure, asks again, and returns the grounded answer', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ text: 'LH-1 wastes ₹500 an hour' }))
      .mockResolvedValueOnce(reply({ text: 'LH-1 wastes ₹5.67 an hour' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await chatJson(ai, 'system', 'user', Text, (o) => ungroundedFigures(o.text, facts))
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

    expect(await chatJson(ai, 's', 'u', Text)).toEqual({ text: 'ok' })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    // Gemini's own API key header, which takes both AIza and AQ. keys; never a Bearer token.
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': 'test' })
    expect(JSON.parse(init.body)).toMatchObject({ systemInstruction: { parts: [{ text: 's' }] }, contents: [{ role: 'user', parts: [{ text: 'u' }] }], generationConfig: { responseMimeType: 'application/json' } })
  })

  it('tries Gemini Flash-Lite when Flash is overloaded', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', 'test')
    const busy = new Response('{"error":{"code":503,"message":"high demand"}}', { status: 503 })
    const lite = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"text":"ok"}' }] } }] }))
    const fetchMock = vi.fn().mockResolvedValueOnce(busy).mockResolvedValueOnce(lite)
    vi.stubGlobal('fetch', fetchMock)
    expect(await chatJson(ai, 's', 'u', Text)).toEqual({ text: 'ok' })
    expect(fetchMock.mock.calls.map(([u]) => String(u).split('/models/')[1])).toEqual(['gemini-flash-latest:generateContent', 'gemini-flash-lite-latest:generateContent'])
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

describe('chatJson with the workspace own keys', () => {
  it('asks aiCandidates for this workspace and task', async () => {
    const spy = vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('openai')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ text: 'ok' })))
    await chatJson({ workspace: 'ws-9', task: 'report' }, 's', 'u', Text)
    expect(spy).toHaveBeenCalledWith('ws-9', 'report')
  })

  it('calls OpenAI, OpenRouter and custom servers as OpenAI-compatible chat completions', async () => {
    for (const [c, url, model] of [
      [own('openai'), 'https://api.openai.com/v1/chat/completions', 'gpt-6-luna'],
      [own('openrouter', 'anthropic/claude-sonnet-5-5'), 'https://openrouter.ai/api/v1/chat/completions', 'anthropic/claude-sonnet-5-5'],
      [own('custom', 'llama3.3', 'http://10.0.0.5:11434/v1/chat/completions'), 'http://10.0.0.5:11434/v1/chat/completions', 'llama3.3'],
    ] as const) {
      vi.spyOn(keys, 'aiCandidates').mockResolvedValue([c])
      const fetchMock = vi.fn().mockResolvedValue(reply({ text: 'ok' }))
      vi.stubGlobal('fetch', fetchMock)
      expect(await chatJson(ai, 's', 'u', Text)).toEqual({ text: 'ok' })
      const [u, init] = fetchMock.mock.calls[0]
      expect(u).toBe(url)
      expect(init.headers.authorization).toBe(`Bearer key-${c.provider}`)
      const body = JSON.parse(init.body)
      expect(body).toMatchObject({ model, response_format: { type: 'json_object' } })
      // OpenAI's reasoning models refuse a non-default temperature.
      expect(body.temperature).toBeUndefined()
    }
  })

  it('calls Anthropic natively and reads JSON out of its text', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('anthropic')])
    const msg = { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Here it is:\n```json\n{"text":"ok"}\n```' }], stop_reason: 'end_turn' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(msg)))
    vi.stubGlobal('fetch', fetchMock)
    const image = 'data:image/png;base64,AAAA'
    expect(await chatJson({ workspace: 'w', task: 'vision' }, 'sys', 'look', Text, () => [], image)).toEqual({ text: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({ 'x-api-key': 'key-anthropic', 'anthropic-version': '2023-06-01' })
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'claude-opus-5-5', system: 'sys', max_tokens: 16000, output_config: { effort: 'low' } })
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ])
    // No thinking setting: current models reject a disabled one.
    expect(body.thinking).toBeUndefined()
  })

  it('sends images to Gemini inline and to OpenAI as image_url parts', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('openai')])
    const fetchMock = vi.fn().mockResolvedValue(reply({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    await chatJson({ workspace: 'w', task: 'vision' }, 's', 'u', Text, () => [], 'data:image/jpeg;base64,BBBB')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } })
  })

  it('says which key was refused, and never echoes the key', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('openai'), own('anthropic')])
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"Incorrect API key provided: key-openai"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('overloaded', { status: 529 }))
    vi.stubGlobal('fetch', fetchMock)
    const err = await chatJson(ai, 's', 'u', Text).catch((e: Error) => e)
    expect(String(err)).toContain('Your OpenAI key was refused (401)')
    expect(String(err)).toContain('Anthropic is busy or down (529)')
    const res = aiFailure(err, 'test')
    expect(res.status).toBe(502)
    const body = await res.text()
    expect(body).toContain('Your OpenAI key was refused (401)')
    expect(body).not.toContain('key-openai')
  })

  it('answers 503 with the Settings hint when the workspace has no key', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([])
    const err = await chatJson(ai, 's', 'u', Text).catch((e: Error) => e)
    expect(err).toBeInstanceOf(NoAiKey)
    const res = aiFailure(err, 'test')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Add an AI key in Settings, Keys and AI', code: 'no-key' })
  })
})

describe('transcribeAudio', () => {
  it('uses the workspace OpenAI key on the transcriptions endpoint when Groq is not set', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('gemini'), own('openai')])
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: ' hello ' })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await transcribeAudio({ workspace: 'w' }, new ArrayBuffer(8), 'audio/webm', 'hi')).toBe('hello')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.headers.authorization).toBe('Bearer key-openai')
    expect((init.body as FormData).get('model')).toBe('gpt-transcribe')
    expect((init.body as FormData).get('language')).toBe('hi')
  })

  it('uses Groq Whisper from the speech candidate', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('groq', 'whisper-large-v3-turbo', 'https://api.groq.com/openai/v1/chat/completions')])
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'ok' })))
    vi.stubGlobal('fetch', fetchMock)
    await transcribeAudio({ workspace: 'w' }, new ArrayBuffer(8), 'audio/ogg', 'en')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })

  it('needs a key from a provider that transcribes', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([own('anthropic')])
    await expect(transcribeAudio({ workspace: 'w' }, new ArrayBuffer(8), 'audio/webm', 'en')).rejects.toBeInstanceOf(NoAiKey)
  })
})
