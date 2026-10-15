import { describe, expect, it } from 'vitest'
import { emptySite, layoutRooms, makeDevices } from '@/shared/site'
import type { Room } from '@/shared/types'
import { blockers, buildModel, collide, DOOR_H, floorWalls, placeDevices, planScale, polyArea, savePolygons, type RoomGeo, type V2 } from './model'
import { alignToX, parseOverpass } from './osm'
import { applyFloorplan } from './panels'

const room = (id: string, floor: number, areaM2: number, extra: Partial<Room> = {}): Room => ({
  id,
  name: id,
  floor,
  type: 'classroom',
  capacity: 30,
  areaM2,
  volumeM3: areaM2 * 3,
  windowSide: true,
  devices: makeDevices(id, { light: 4, fan: 2, ac: 1 }),
  ...extra,
})

const geo = (id: string, poly: V2[], windowSide = false): RoomGeo => ({ id, name: id, level: 0, poly, origin: poly[0], size: [0, 0], center: [0, 0], y: 0, h: 3, windowSide })

describe('3D model', () => {
  it('lays rooms out exactly like the 2D floor plan, in metres', () => {
    const rooms = layoutRooms([room('A', 0, 60), room('B', 0, 60), room('C', 0, 60), room('D', 0, 60)])
    const m = buildModel({ floors: [{ level: 0, name: 'G' }], rooms })
    const total = m.floors[0].rooms.reduce((a, r) => a + polyArea(r.poly), 0)
    expect(total).toBeCloseTo(240)
    // Same shapes as the plan: every 3D corner is the plan corner times one scale.
    const s = m.buildings[0].scale
    m.floors[0].rooms.forEach((g, i) => {
      const plan = rooms[i].polygon!
      g.poly.forEach((p, k) => {
        expect((p[0] - g.poly[0][0]) / s).toBeCloseTo(plan[k][0] - plan[0][0])
        expect((p[1] - g.poly[0][1]) / s).toBeCloseTo(plan[k][1] - plan[0][1])
      })
    })
  })

  it('scales drawn polygons so the rooms add up to their areas', () => {
    const s = planScale([{ areaM2: 100, polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] }])
    expect(s).toBeCloseTo(0.1)
  })

  it('stacks floors by the tallest room and puts level 0 on the ground', () => {
    const m = buildModel({
      floors: [{ level: -1, name: 'Basement' }, { level: 0, name: 'Ground' }, { level: 1, name: 'First' }],
      rooms: [room('B1', -1, 30), room('G1', 0, 30, { heightM: 4 }), room('F1', 1, 30)],
    })
    expect(m.floors.map((f) => [f.level, f.y])).toEqual([[-1, -3], [0, 0], [1, 4]])
    expect(m.top).toBe(7)
  })

  it('places campus buildings side by side', () => {
    const m = buildModel({
      floors: [{ level: 0, name: 'G', building: 'North' }, { level: 10, name: 'G', building: 'South' }],
      rooms: [room('N1', 0, 50), room('S1', 10, 50)],
    })
    expect(m.buildings.map((b) => b.name)).toEqual(['North', 'South'])
    expect(m.buildings[1].min[0]).toBeGreaterThan(m.buildings[0].max[0])
  })

  it('cuts one door per room, matched in both rooms of a shared wall', () => {
    // A is enclosed on the right by B; B has outside walls; A also has outside walls on three sides.
    const a = geo('A', [[0, 0], [4, 0], [4, 4], [0, 4]])
    const b = geo('B', [[4, 0], [8, 0], [8, 4], [4, 4]])
    const walls = floorWalls([a, b])
    const lintels = walls.filter((w) => w.y0 === DOOR_H)
    expect(lintels).toHaveLength(2)
    // Every room's walls stay inside its own polygon.
    for (const w of walls) expect(w.a[0] >= 0 && w.a[0] <= 8 && w.a[1] >= 0 && w.a[1] <= 4).toBe(true)
  })

  it('gives an enclosed room doors through the walls it shares, cut on both sides', () => {
    const sq = (x: number, z: number) => geo(`${x}${z}`, [[x, z], [x + 4, z], [x + 4, z + 4], [x, z + 4]])
    const rooms = [0, 4, 8].flatMap((x) => [0, 4, 8].map((z) => sq(x, z)))
    const walls = floorWalls(rooms)
    const centre = walls.filter((w) => w.y0 === DOOR_H && Math.max(w.a[0], w.b[0]) <= 8 && Math.min(w.a[0], w.b[0]) >= 4 && Math.max(w.a[1], w.b[1]) <= 8 && Math.min(w.a[1], w.b[1]) >= 4)
    // Four doors out of the centre room, each with a lintel on both sides.
    expect(walls.filter((w) => w.y0 === DOOR_H).length).toBeGreaterThanOrEqual(8 + 8)
    expect(centre.length).toBeGreaterThanOrEqual(4)
  })

  it('puts glass only on outside walls of window-side rooms', () => {
    const walls = floorWalls([geo('A', [[0, 0], [6, 0], [6, 6], [0, 6]], true), geo('B', [[6, 0], [12, 0], [12, 6], [6, 6]], false)])
    const glass = walls.filter((w) => w.glass)
    expect(glass.length).toBeGreaterThan(0)
    // None on the wall A shares with B (x = 6), none in B.
    for (const g of glass) expect(Math.min(g.a[0], g.b[0])).toBeLessThan(5.5)
  })

  it('stops a walker at a wall and lets it through a door', () => {
    const a = geo('A', [[0, 0], [4, 0], [4, 4], [0, 4]])
    const walls = floorWalls([a])
    const segs = blockers(walls)
    // Walking into a solid wall pushes the walker back inside.
    const lintel = walls.find((w) => w.y0 === DOOR_H)!
    const door: V2 = [(lintel.a[0] + lintel.b[0]) / 2, (lintel.a[1] + lintel.b[1]) / 2]
    const solid: V2 = door[0] === 2 ? [2, 4 - door[1]] : [4 - door[0], 2]
    const pushed = collide(solid, 0.3, segs)
    expect(Math.hypot(pushed[0] - solid[0], pushed[1] - solid[1])).toBeGreaterThan(0.3)
    // Standing in the doorway is free.
    expect(collide(door, 0.3, segs)).toEqual(door)
  })

  it('arranges unplaced devices inside the room and keeps saved positions', () => {
    const r = room('A', 0, 40)
    r.devices[0].position = [1, 2.9, 1]
    const m = buildModel({ floors: [{ level: 0, name: 'G' }], rooms: [r] })
    const g = m.floors[0].rooms[0]
    const placed = placeDevices(r, g)
    expect(placed[0]).toMatchObject({ auto: false, local: [1, 2.9, 1] })
    for (const p of placed) {
      expect(p.local[0]).toBeGreaterThanOrEqual(0)
      expect(p.local[0]).toBeLessThanOrEqual(g.size[0])
      expect(p.local[2]).toBeLessThanOrEqual(g.size[1])
    }
  })

  it('saves dragged rooms as plan polygons that rebuild the same model', () => {
    const site = { floors: [{ level: 0, name: 'G' }], rooms: layoutRooms([room('A', 0, 60), room('B', 0, 40)]) }
    const m = buildModel(site, { A: [2, 0] })
    const saved = savePolygons({ ...site, version: 1 } as never, m, [0])
    expect(saved.rooms.every((r) => r.polygon && !r.autoLayout)).toBe(true)
    const again = buildModel(saved)
    const before = m.floors[0].rooms.map((r) => r.poly)
    const after = again.floors[0].rooms.map((r) => r.poly)
    // Same shapes up to a shift of the whole building, to within plan rounding.
    const dx = after[0][0][0] - before[0][0][0]
    after.flat().forEach((p, i) => {
      expect(p[0] - dx).toBeCloseTo(before.flat()[i][0], 1)
      expect(p[1]).toBeCloseTo(before.flat()[i][1] - before.flat()[0][1] + after.flat()[0][1], 1)
    })
  })
})

describe('OpenStreetMap outline', () => {
  const lat = 12.9716
  const lon = 77.5946
  const square = (dLat: number, dLon: number, size: number) => {
    const pts = [[0, 0], [size, 0], [size, size], [0, size], [0, 0]]
    return pts.map(([a, b]) => ({ lat: lat + dLat + a, lon: lon + dLon + b }))
  }

  it('picks the building that contains the point and reads its levels', () => {
    const json = {
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes' }, geometry: square(0.0001, 0.0001, 0.0001) },
        { type: 'way', id: 2, tags: { building: 'university', 'building:levels': '3', name: 'Main Block' }, geometry: square(-0.0002, -0.0002, 0.0004) },
      ],
    }
    const o = parseOverpass(json, lat, lon)
    expect(o).toMatchObject({ osmId: 2, levels: 3, name: 'Main Block', heightM: null })
    // About 44 m a side.
    expect(polyArea(o!.poly)).toBeGreaterThan(1500)
    expect(polyArea(o!.poly)).toBeLessThan(2400)
  })

  it('falls back to the nearest building, and to null when there is none', () => {
    const json = { elements: [{ type: 'way', id: 7, tags: { building: 'yes', 'building:levels': 'two' }, geometry: square(0.0003, 0, 0.0001) }] }
    expect(parseOverpass(json, lat, lon)).toMatchObject({ osmId: 7, levels: null })
    expect(parseOverpass({ elements: [] }, lat, lon)).toBeNull()
  })

  it('turns an outline so its longest side runs along x', () => {
    const d = Math.SQRT1_2
    const p = alignToX([[0, 0], [10 * d, 10 * d], [10 * d - 2 * d, 10 * d + 2 * d], [-2 * d, 2 * d]])
    const xs = p.map((q) => q[0])
    const zs = p.map((q) => q[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 1)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 1)
  })
})

describe('floor plan photo', () => {
  it('fits matched rooms into the plan keeping the photo proportions, and leaves others alone', () => {
    const site = { ...emptySite('IN'), floors: [{ level: 0, name: 'Ground floor' }], rooms: [room('A', 0, 50), room('B', 0, 50), room('C', 0, 50)] }
    const p = { floors: [{ name: 'Ground floor', rooms: [{ name: 'A', x: 0.1, y: 0.1, w: 0.4, h: 0.2 }, { name: 'B', x: 0.5, y: 0.1, w: 0.4, h: 0.2 }, { name: 'Lift', x: 0.1, y: 0.3, w: 0.1, h: 0.1 }] }] }
    const next = applyFloorplan(site, p, { w: 1000, h: 1000 }, [0], { '0-0': 'A', '0-1': 'B', '0-2': '' })
    // 800 x 200 px of photo fills the 960-unit width; heights keep the same scale.
    expect(next.rooms[0].polygon).toEqual([[20, 20], [500, 20], [500, 260], [20, 260]])
    expect(next.rooms[1].polygon).toEqual([[500, 20], [980, 20], [980, 260], [500, 260]])
    expect(next.rooms[2]).toBe(site.rooms[2])
    expect(next.rooms[0].autoLayout).toBeUndefined()
  })
})
