import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlertType, FactsPack } from '@/shared/types'

const apiFetch = vi.fn()
vi.mock('@/shared/workspace', async (importOriginal) => ({ ...(await importOriginal<object>()), online: () => true, apiFetch: (...a: unknown[]) => apiFetch(...a) }))

const { recommend } = await import('./client')
const { templateRecommendation } = await import('./templates')

const facts = (alertType: AlertType, extra: Partial<FactsPack> = {}): FactsPack => ({
  roomId: 'LH-1',
  roomName: 'Lecture Hall 1',
  alertType,
  devicesOn: [{ type: 'ac', count: 2, watts: 3000 }],
  wattsNow: 3000,
  costPerHourNow: 24,
  kwhToday: 12,
  costToday: 96,
  co2KgToday: 9.8,
  capacity: 60,
  currency: 'INR',
  ...extra,
})

afterEach(() => apiFetch.mockReset())

describe('A1: code writes the action, the AI only the reason', () => {
  it('AC too cold: set to 24 °C, never the room temperature', () => {
    const r = templateRecommendation(facts('ac_overcooling', { indoorTempC: 21, acSavingPercent: 18 }))
    expect(r.title).toContain('24 °C')
    expect(r.action).toContain('Set them to 24 °C')
    expect(r.action).not.toMatch(/set (them|it|the thermostat) to 21/i)
  })

  it('CO2 high: ventilate, with fans instead of windows when outdoor air is poor', () => {
    const open = templateRecommendation(facts('co2_high', { co2ppm: 1250, headcount: 50 }))
    expect(open.title).toMatch(/ventilate/i)
    expect(open.action).toMatch(/ventilate .*open the windows/i)
    expect(open.action).not.toMatch(/\bAC/)
    const smoggy = templateRecommendation(facts('co2_high', { co2ppm: 1250, headcount: 50, outdoorAqi: 160 }))
    expect(smoggy.action).toMatch(/fans/)
    expect(smoggy.action).toMatch(/keep the windows shut/)
  })

  it('takes only the reason from the AI, and sends it the code-written action', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ reason: 'LH-1 holds 50 people at 1250 ppm.', action: 'Set the AC to 18 °C' })))
    const f = facts('co2_high', { co2ppm: 1250, headcount: 50 })
    const rec = await recommend(f)
    expect(rec.source).toBe('ai')
    expect(rec.reason).toBe('LH-1 holds 50 people at 1250 ppm.')
    expect(rec.action).toBe(templateRecommendation(f).action)
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).action).toBe(rec.action)
  })

  it('keeps the whole template card when the AI fails', async () => {
    apiFetch.mockResolvedValue(new Response('{"error":"AI unavailable"}', { status: 502 }))
    const f = facts('ac_overcooling', { indoorTempC: 20.5, acSavingPercent: 21 })
    expect(await recommend(f)).toEqual(templateRecommendation(f))
  })
})
