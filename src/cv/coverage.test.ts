import { describe, expect, it } from 'vitest'
import { testSite } from '@/test/fixture'
import { coverage, coverageText } from './coverage'

describe('coverage', () => {
  const room = testSite.rooms.find((r) => r.id === 'LH-1')!
  const lightZone = room.devices.find((d) => d.type === 'light')!.zone!
  const cam = (zone: object) => [{ roomId: 'LH-1', name: 'Camera 1', updatedAt: 1, zones: [{ id: lightZone, kind: 'brightness' as const, x: 0.1, y: 0.1, w: 0.1, h: 0.1, ...zone }] }]

  it('counts devices whose zone a camera of the room watches and has calibrated (C16)', () => {
    const lights = coverage(room, cam({ onRef: 180, offRef: 40 })).find((c) => c.type === 'light')!
    expect(lights.total).toBe(16)
    expect(lights.watched).toBe(room.devices.filter((d) => d.zone === lightZone).length)
    expect(coverageText(lights)).toBe(`${lights.watched} of 16 lights watched`)
    expect(coverage(room, []).every((c) => c.watched === 0)).toBe(true)
  })

  it('does not count a marked zone that cannot report yet', () => {
    expect(coverage(room, cam({})).find((c) => c.type === 'light')!.watched).toBe(0)
    expect(coverage(room, cam({ onRef: 100, offRef: 95 })).find((c) => c.type === 'light')!.watched).toBe(0)
  })

  it('says one device in the singular', () => {
    expect(coverageText({ type: 'projector', total: 1, watched: 0 })).toBe('0 of 1 projector watched')
  })
})
