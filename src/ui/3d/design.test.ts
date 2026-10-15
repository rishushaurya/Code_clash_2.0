import { describe, expect, it } from 'vitest'
import { SiteSchema } from '@/shared/site'
import { testSite } from '@/test/fixture'
import { applyOps, arrangeFurniture, fromOutline, roomSize } from './design'

describe('applyOps', () => {
  it('adds a room beside the others with its size, devices and a valid site', () => {
    const { site, notes } = applyOps(testSite, [{ op: 'addRoom', floor: 0, name: 'Seminar', type: 'classroom', widthM: 8, depthM: 6, counts: { light: 4, ac: 1 } }])
    const added = site.rooms.find((r) => r.name === 'Seminar')!
    expect(notes).toEqual([])
    expect(added.id).toBe('CR-1')
    expect(added.areaM2).toBe(48)
    expect(roomSize(site, added)).toEqual([8, 6])
    expect(added.devices.filter((d) => d.type === 'ac')).toHaveLength(1)
    expect(SiteSchema.safeParse(site).success).toBe(true)
  })

  it('resizes, restyles and refurnishes a room, and keeps devices that stay', () => {
    const before = testSite.rooms.find((r) => r.id === 'LH-1')!
    const { site } = applyOps(testSite, [
      { op: 'updateRoom', roomId: 'LH-1', widthM: 20, depthM: 10, heightM: 4 },
      { op: 'setStyle', roomId: 'LH-1', style: { wall: '#ddeeff' } },
      { op: 'setDevices', roomId: 'LH-1', counts: { light: 20 } },
      { op: 'setFurniture', roomId: 'LH-1', items: [{ kind: 'desk', count: 12 }] },
    ])
    const r = site.rooms.find((x) => x.id === 'LH-1')!
    expect(roomSize(site, r)).toEqual([20, 10])
    expect(r.areaM2).toBe(200)
    expect(r.volumeM3).toBe(800)
    expect(r.style?.wall).toBe('#ddeeff')
    expect(r.devices.filter((d) => d.type === 'light')).toHaveLength(20)
    expect(r.devices.find((d) => d.id === before.devices[0].id)).toEqual(before.devices[0])
    expect(r.furniture?.filter((f) => f.kind === 'desk')).toHaveLength(12)
  })

  it('removes rooms and devices, skips unknown rooms, keeps one floor', () => {
    const lh = testSite.rooms.find((r) => r.id === 'LH-2')!
    const { site, notes } = applyOps(testSite, [
      { op: 'removeRoom', roomId: 'LH-1' },
      { op: 'removeDevice', roomId: 'LH-2', deviceId: lh.devices[0].id },
      { op: 'removeRoom', roomId: 'NOPE' },
    ])
    expect(site.rooms.some((r) => r.id === 'LH-1')).toBe(false)
    expect(site.rooms.find((r) => r.id === 'LH-2')!.devices).toHaveLength(lh.devices.length - 1)
    expect(notes).toEqual(['No room NOPE'])
    const one = applyOps({ ...testSite, floors: [testSite.floors[0]] }, [{ op: 'removeFloor', level: 0 }])
    expect(one.notes).toEqual(['A building keeps at least one floor'])
  })

  it('copies a room with its devices and moves a room to another floor', () => {
    const { site } = applyOps(testSite, [
      { op: 'addRoom', floor: 1, name: '', type: 'lecture_hall', copyOf: 'LH-1' },
      { op: 'moveRoom', roomId: 'CR-001', floor: 1 },
    ])
    const copy = site.rooms.find((r) => r.name === 'LH-1 copy')!
    expect(copy.floor).toBe(1)
    expect(copy.devices).toHaveLength(testSite.rooms.find((r) => r.id === 'LH-1')!.devices.length)
    expect(site.rooms.find((r) => r.id === 'CR-001')!.floor).toBe(1)
  })
})

describe('arrangeFurniture', () => {
  it('keeps every piece inside the room', () => {
    for (const type of ['classroom', 'lab', 'office', 'meeting', 'other'] as const) {
      for (const f of arrangeFurniture(type, 9, 7)) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.x).toBeLessThanOrEqual(9)
        expect(f.z).toBeLessThanOrEqual(7)
      }
    }
  })
})

describe('fromOutline', () => {
  it('makes one floor per level with rooms either side of a corridor', () => {
    const site = fromOutline(testSite, { poly: [[-30, -9], [30, -9], [30, 9], [-30, 9]], levels: 3 })
    expect(site.floors.map((f) => f.level)).toEqual([0, 1, 2])
    expect(site.rooms.filter((r) => r.floor === 0)).toHaveLength(18)
    expect(SiteSchema.safeParse(site).success).toBe(true)
    expect(new Set(site.rooms.map((r) => r.id)).size).toBe(site.rooms.length)
  })
})
