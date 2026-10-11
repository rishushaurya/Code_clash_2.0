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
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('rate limited', { status: 429 })).mockResolvedValueOnce(reply({ text: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await chatJson('s', 'u', z.object({ text: z.string() }))).toEqual({ text: 'ok' })
    expect(fetchMock.mock.calls[1][0]).toContain('generativelanguage.googleapis.com')
  })
})
