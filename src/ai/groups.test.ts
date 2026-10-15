import { describe, expect, it } from 'vitest'
import type { Alert, AlertType, FactsPack, Recommendation } from '@/shared/types'
import { groupAlerts } from './groups'

const facts = (roomId: string, alertType: AlertType, extra: Partial<FactsPack> = {}): FactsPack => ({
  roomId,
  roomName: `Room ${roomId}`,
  alertType,
  devicesOn: [],
  wattsNow: 650,
  costPerHourNow: 5.67,
  kwhToday: 1,
  costToday: 8,
  co2KgToday: 1,
  capacity: 60,
  currency: 'INR',
  ...extra,
})
const alert = (id: string, roomId: string, type: AlertType, extra: Partial<FactsPack> = {}): Alert => ({ id, roomId, type, since: 1000, facts: facts(roomId, type, extra) })

describe('groupAlerts (A2)', () => {
  it('puts every alert of a room on one card and orders cards and findings by saving', () => {
    const alerts = [
      alert('a', 'LH-1', 'co2_high'),
      alert('b', 'LH-1', 'empty_with_load', { monthlySavingCost: 1240 }),
      alert('c', 'LH-1', 'ac_overcooling'),
      alert('d', 'LH-2', 'empty_with_load', { monthlySavingCost: 2900, wattsNow: 1800 }),
      alert('e', 'LH-3', 'daylight_available'),
    ]
    const recs: Record<string, Recommendation | 'loading'> = { a: 'loading' }
    const cards = groupAlerts(alerts, recs)
    expect(cards.map((c) => c.roomId)).toEqual(['LH-2', 'LH-1', 'LH-3'])
    const lh1 = cards[1]
    expect(lh1.findings.map((f) => f.alert.type)).toEqual(['empty_with_load', 'co2_high', 'ac_overcooling'])
    expect(lh1).toMatchObject({ wattsNow: 650, wasting: true, monthlySaving: 1240 })
    expect(lh1.findings[1].rec).toBe('loading')
    expect(cards[2].wasting).toBe(false)
  })

  it('without savings, orders by urgency', () => {
    const cards = groupAlerts([alert('a', 'R-1', 'underused'), alert('b', 'R-2', 'camera_offline')], {})
    expect(cards.map((c) => c.roomId)).toEqual(['R-2', 'R-1'])
  })
})
