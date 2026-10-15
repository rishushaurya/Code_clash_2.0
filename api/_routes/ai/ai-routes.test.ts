// AI routes with the workspace's own keys: aiCandidates() is stubbed the way the Server session's version
// answers, and the provider is a stubbed fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signToken } from '../../_lib/auth.js'
import * as keys from '../../_lib/keys.js'
import { checkPlan, POST as floorplan } from './floorplan.js'
import { POST as copilot } from './copilot.js'
import { cleanText, keepGrounded, Out } from './report.js'

const SECRET = 'test-secret-that-is-at-least-32-characters'
const req = (path: string, body: unknown, workspace = 'acme') =>
  new Request(`http://localhost/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken(workspace)}` }, body: JSON.stringify(body) })
const reply = (content: object) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))
const ownOpenAi = (): keys.AiCandidate[] => [{ provider: 'openai', url: '', apiKey: 'sk-test', model: '', owner: 'workspace' }]

beforeEach(() => vi.stubEnv('WORKSPACE_SECRET', SECRET))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('report output (A3, A4, A5)', () => {
  // Captured from the live site: the model broke its JSON and the page printed the pieces.
  const captured = {
    title: 'Main Block energy report',
    sections: [
      { heading: 'Summary', paragraphs: ['The building used 42.9 kWh this session.”]', 'bullets', ':', '"paragraphs": ["Auto-off saves ₹1,240 a month."'], bullets: [] },
      { heading: 'Indoor air quality', paragraphs: ['The indoorAir array is empty.', 'LH-1 reached 1250 ppm, measured by a sensor.'], bullets: [] },
      { heading: 'Recommendations', paragraphs: [], bullets: ['Auto-off saves ₹1,240 per week.', 'Auto-off saves ₹1,240 a month (modelled).'] },
    ],
  }
  const facts = { liveSession: { kwh: 42.9 }, policies: [{ monthlySavingCost: { p50: 1240 } }], indoorAir: [{ roomId: 'LH-1', peakPpm: 1250, measured: true }] }

  it('never shows raw JSON fragments', () => {
    expect(cleanText('The building used 42.9 kWh this session.”]')).toBe('The building used 42.9 kWh this session.')
    expect(cleanText('bullets')).toBe('')
    expect(cleanText(':')).toBe('')
    expect(cleanText('"paragraphs": ["Auto-off saves ₹1,240 a month."')).toBe('Auto-off saves ₹1,240 a month.')
    const { sections } = keepGrounded(Out.parse(captured), facts)
    expect(sections[0].paragraphs).toEqual(['The building used 42.9 kWh this session.', 'Auto-off saves ₹1,240 a month.'])
    expect(sections.flatMap((x) => [...x.paragraphs, ...x.bullets]).join(' ')).not.toMatch(/"\]|”\]|\bbullets\b/)
  })

  it('drops sentences that name a field, and figures with the wrong period', () => {
    const { sections } = keepGrounded(Out.parse(captured), facts)
    expect(sections[1].paragraphs).toEqual(['LH-1 reached 1250 ppm, measured by a sensor.'])
    expect(sections[2].bullets).toEqual(['Auto-off saves ₹1,240 a month (modelled).'])
  })
})

describe('/api/ai/floorplan', () => {
  it('clips rooms to the picture and drops slivers, repeats and junk', () => {
    const plan = checkPlan(
      // The shape after the lenient reader: numbers parsed, nulls for junk entries.
      {
        floors: [
          {
            name: '',
            rooms: [
              { name: 'LH-1', x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
              { name: 'LH-1 again', x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
              { name: 'Edge', x: 0.9, y: -0.1, w: 0.3, h: 0.3 },
              { name: 'Sliver', x: 0.5, y: 0.5, w: 0.001, h: 0.3 },
              { name: 'Outside', x: 1.2, y: 0.2, w: 0.1, h: 0.1 },
              { name: '', x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
              { name: 'Bad', x: Number.NaN, y: 0, w: 0.1, h: 0.1 },
              null,
            ],
          },
          null,
          { name: 'Roof', rooms: [] },
        ],
      } as Parameters<typeof checkPlan>[0],
    )
    expect(plan).toEqual({
      floors: [
        {
          name: 'Ground floor',
          rooms: [
            { name: 'LH-1', x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
            { name: 'Edge', x: 0.9, y: 0, w: 0.1, h: 0.2 },
            { name: 'Room 6', x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
          ],
        },
      ],
    })
  })

  it('reads a photo with the workspace vision key', async () => {
    const spy = vi.spyOn(keys, 'aiCandidates').mockResolvedValue(ownOpenAi())
    const fetchMock = vi.fn().mockResolvedValue(reply({ floors: [{ name: 'First floor', rooms: [{ name: 'CR-101', x: '0.2', y: 0.3, w: 0.25, h: 0.2 }] }] }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await floorplan(req('ai/floorplan', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ floors: [{ name: 'First floor', rooms: [{ name: 'CR-101', x: 0.2, y: 0.3, w: 0.25, h: 0.2 }] }] })
    expect(spy).toHaveBeenCalledWith('acme', 'vision')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content[1].image_url.url).toBe('data:image/png;base64,AAAA')
  })

  it('says to add a key when the workspace has none', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue([])
    const res = await floorplan(req('ai/floorplan', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Add an AI key in Settings, Keys and AI')
  })

  it('refuses something that is not an image', async () => {
    expect((await floorplan(req('ai/floorplan', { image: 'https://example.com/plan.png' }))).status).toBe(400)
  })
})

describe('/api/ai/copilot (the Assistant)', () => {
  const roomIds = ['LH-1', 'LH-2']

  it('picks liveSummary for "which room uses the most power" (A6)', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue(ownOpenAi())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ tool: 'liveSummary' })))
    const res = await copilot(req('ai/copilot', { question: 'Which room uses the most power?', roomIds }))
    expect(await res.json()).toEqual({ tool: 'liveSummary' })
  })

  it('asks again when a proposed change uses a number the person never said', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue(ownOpenAi())
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ tool: 'proposeSiteChange', change: { kind: 'setDeviceCount', roomId: 'LH-1', device: 'light', count: 12 } }))
      .mockResolvedValueOnce(reply({ tool: 'proposeSiteChange', change: { kind: 'setDeviceCount', roomId: 'LH-1', device: 'light', count: 14 } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await copilot(req('ai/copilot', { question: 'LH-1 has 14 lights now', roomIds }))
    expect((await res.json()).change.count).toBe(14)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1).content).toContain('count 12 was not said')
  })

  it('asks again when an answer quotes a figure the tool result does not have', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue(ownOpenAi())
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ answer: 'LH-1 draws 900 W.' }))
      .mockResolvedValueOnce(reply({ answer: 'LH-1 draws 650 W, the most of any watched room.' }))
    vi.stubGlobal('fetch', fetchMock)
    const toolResult = { watchedRooms: 2, byPower: [{ roomId: 'LH-1', watts: 650 }, { roomId: 'LH-2', watts: 120 }] }
    const res = await copilot(req('ai/copilot', { question: 'Which room uses the most power?', toolResult, history: [{ q: 'hi', a: 'Hello.' }] }))
    expect((await res.json()).answer).toBe('LH-1 draws 650 W, the most of any watched room.')
  })

  it('names the refused key in the error, never the key itself', async () => {
    vi.spyOn(keys, 'aiCandidates').mockResolvedValue(ownOpenAi())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key sk-test', { status: 401 })))
    const res = await copilot(req('ai/copilot', { question: 'Which room uses the most power?', roomIds }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).toContain('Your OpenAI key was refused (401)')
    expect(text).not.toContain('sk-test')
  })
})
