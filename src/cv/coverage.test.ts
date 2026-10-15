import { describe, expect, it } from 'vitest'
import { testSite } from '@/test/fixture'
import { coverage } from './coverage'

describe('coverage', () => {
  it('counts devices whose zone a camera of the room has marked', () => {
    const room = testSite.rooms.find((r) => r.id === 'LH-1')!
    const lightZone = room.devices.find((d) => d.type === 'light')!.zone!
    const cams = [{ roomId: 'LH-1', name: 'Camera 1', updatedAt: 1, zones: [{ id: lightZone, kind: 'brightness' as const, x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] }]
    const lights = coverage(room, cams).find((c) => c.type === 'light')!
    expect(lights.total).toBe(16)
    expect(lights.watched).toBe(room.devices.filter((d) => d.zone === lightZone).length)
    expect(coverage(room, []).every((c) => c.watched === 0)).toBe(true)
  })
})
