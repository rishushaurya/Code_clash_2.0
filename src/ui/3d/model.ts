// The 3D model is computed from the site alone, so every customer gets one with no extra input.
// Plan units: SVG x becomes world x, SVG y becomes world z, both in metres; y is up.
// Every room keeps its floor-plan polygon (drawn, or laid out by layoutRooms), scaled so the building's rooms
// add up to their recorded areas: the 3D model and the 2D floor plan show the same building.

import { layoutRooms } from '@/shared/site'
import type { Device, DeviceType, Room, Site } from '@/shared/types'

export type V2 = [number, number]

export const WALL = 0.12
export const DOOR_W = 0.9
export const DOOR_H = 2.1
const SILL = 0.9
const HEAD = 2.2
const BUILDING_GAP = 12
/** Plan margin used by the automatic floor plan (layoutRooms): polygons start at 20 SVG units */
const PLAN_MARGIN = 20
const EPS = 0.05

export interface RoomGeo {
  id: string
  name: string
  level: number
  /** World polygon, metres */
  poly: V2[]
  /** Corner that Device.position is measured from: the polygon's smallest x and z */
  origin: V2
  size: V2
  center: V2
  /** Floor elevation and floor-to-ceiling height, metres */
  y: number
  h: number
  windowSide: boolean
}

export interface WallPiece {
  a: V2
  b: V2
  /** Height range above the floor, metres */
  y0: number
  y1: number
  glass: boolean
}

export interface FloorGeo {
  level: number
  name: string
  building: string
  y: number
  h: number
  rooms: RoomGeo[]
  walls: WallPiece[]
}

/** How a building's plan units map to the world: world = (svg - 20) * scale + offset */
export interface BuildingFrame {
  name: string
  scale: number
  offset: V2
  min: V2
  max: V2
  top: number
}

export interface Model {
  floors: FloorGeo[]
  buildings: BuildingFrame[]
  min: V2
  max: V2
  top: number
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]]
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k]
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1]
const len = (a: V2) => Math.hypot(a[0], a[1])

export function polyArea(p: V2[]) {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]
    const [x1, y1] = p[(i + 1) % p.length]
    s += x0 * y1 - x1 * y0
  }
  return Math.abs(s) / 2
}

export function bbox(p: V2[]): { min: V2; max: V2 } {
  const xs = p.map((q) => q[0])
  const zs = p.map((q) => q[1])
  return { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] }
}

export function inPoly([x, z]: V2, p: V2[]) {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]
    const [xj, zj] = p[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Metres per plan unit, so the drawn rooms of a building add up to their recorded areas */
export function planScale(rooms: Pick<Room, 'areaM2' | 'polygon'>[]) {
  const drawn = rooms.filter((r) => r.polygon && r.polygon.length >= 3)
  const units = drawn.reduce((a, r) => a + polyArea(r.polygon!), 0)
  return units > 0 ? Math.sqrt(drawn.reduce((a, r) => a + r.areaM2, 0) / units) : 0
}

interface Door {
  p: V2
  dir: V2
}

/** Parts of edge a-b that other rooms' edges lie on, as [from, to] distances along it */
function sharedIntervals(a: V2, b: V2, others: V2[][]): V2[] {
  const L = len(sub(b, a))
  const d = mul(sub(b, a), 1 / L)
  const found: V2[] = []
  for (const q of others) {
    for (let i = 0; i < q.length; i++) {
      const f0 = q[i]
      const f1 = q[(i + 1) % q.length]
      const fd = sub(f1, f0)
      const fl = len(fd)
      if (fl < EPS) continue
      // Parallel, and on the same line (within a wall's thickness).
      if (Math.abs(d[0] * fd[1] - d[1] * fd[0]) / fl > 1e-3) continue
      const off = sub(f0, a)
      if (Math.abs(d[0] * off[1] - d[1] * off[0]) > EPS) continue
      const t0 = dot(off, d)
      const t1 = dot(sub(f1, a), d)
      const lo = Math.max(0, Math.min(t0, t1))
      const hi = Math.min(L, Math.max(t0, t1))
      if (hi - lo > EPS) found.push([lo, hi])
    }
  }
  found.sort((x, y) => x[0] - y[0])
  const merged: V2[] = []
  for (const iv of found) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1])
    else merged.push([...iv])
  }
  return merged
}

const complement = (ivs: V2[], L: number): V2[] => {
  const out: V2[] = []
  let t = 0
  for (const [lo, hi] of ivs) {
    if (lo - t > EPS) out.push([t, lo])
    t = Math.max(t, hi)
  }
  if (L - t > EPS) out.push([t, L])
  return out
}

/**
 * One door per room, on the outside edge that faces the floor's long centre line (the corridor when
 * there is one). A room with no outside edge gets a door on every wall it shares instead.
 */
function floorDoors(rooms: RoomGeo[]): Door[] {
  if (!rooms.length) return []
  const { min, max } = bbox(rooms.flatMap((r) => r.poly))
  const wide = max[0] - min[0] >= max[1] - min[1]
  const centre = wide ? (min[1] + max[1]) / 2 : (min[0] + max[0]) / 2
  const doors: Door[] = []
  for (const r of rooms) {
    const others = rooms.filter((o) => o !== r).map((o) => o.poly)
    let best: { door: Door; score: number } | null = null
    const shared: Door[] = []
    r.poly.forEach((a, i) => {
      const b = r.poly[(i + 1) % r.poly.length]
      const L = len(sub(b, a))
      if (L < EPS) return
      const dir = mul(sub(b, a), 1 / L)
      const sh = sharedIntervals(a, b, others)
      for (const [lo, hi] of complement(sh, L)) {
        if (hi - lo < 1.2) continue
        const p = add(a, mul(dir, (lo + hi) / 2))
        const score = Math.abs((wide ? p[1] : p[0]) - centre)
        if (!best || score < best.score - EPS) best = { door: { p, dir }, score }
      }
      for (const [lo, hi] of sh) if (hi - lo >= 1.2) shared.push({ p: add(a, mul(dir, (lo + hi) / 2)), dir })
    })
    if (best) doors.push((best as { door: Door }).door)
    else doors.push(...shared)
  }
  return doors
}

/** Walls of every room, inset by half a wall so neighbours' walls meet back to back, with doors and windows cut */
export function floorWalls(rooms: RoomGeo[]): WallPiece[] {
  const doors = floorDoors(rooms)
  const pieces: WallPiece[] = []
  for (const r of rooms) {
    const others = rooms.filter((o) => o !== r).map((o) => o.poly)
    r.poly.forEach((a, i) => {
      const b = r.poly[(i + 1) % r.poly.length]
      const L = len(sub(b, a))
      if (L < EPS) return
      const dir = mul(sub(b, a), 1 / L)
      let n: V2 = [-dir[1], dir[0]]
      if (!inPoly(add(add(a, mul(dir, L / 2)), mul(n, 0.01)), r.poly)) n = mul(n, -1)
      const inset = mul(n, WALL / 2)
      const at = (t: number) => add(add(a, mul(dir, t)), inset)
      // Door cuts on this edge's line, as distances along it.
      const cuts = doors
        .filter((d) => Math.abs(dir[0] * (d.p[1] - a[1]) - dir[1] * (d.p[0] - a[0])) < EPS)
        .map((d) => dot(sub(d.p, a), dir))
        .filter((t) => t > DOOR_W / 2 - EPS && t < L - DOOR_W / 2 + EPS)
        .map((t): V2 => [t - DOOR_W / 2, t + DOOR_W / 2])
        .sort((x, y) => x[0] - y[0])
      const outside = complement(sharedIntervals(a, b, others), L)
      const isOutside = (lo: number, hi: number) => outside.some(([o0, o1]) => lo >= o0 - EPS && hi <= o1 + EPS)
      const runs: { lo: number; hi: number; door: boolean }[] = []
      let t = 0
      for (const [lo, hi] of cuts) {
        if (lo > t + EPS) runs.push({ lo: t, hi: lo, door: false })
        runs.push({ lo, hi, door: true })
        t = hi
      }
      if (L > t + EPS) runs.push({ lo: t, hi: L, door: false })
      for (const { lo, hi, door } of runs) {
        if (door) {
          if (r.h > DOOR_H) pieces.push({ a: at(lo), b: at(hi), y0: DOOR_H, y1: r.h, glass: false })
          continue
        }
        // Split a run at the shared / outside boundaries, so windows go only on outside walls.
        const marks = [lo, hi, ...outside.flat().filter((m) => m > lo + EPS && m < hi - EPS)].sort((x, y) => x - y)
        for (let k = 0; k < marks.length - 1; k++) {
          const [u, v] = [marks[k], marks[k + 1]]
          // Windows on outside walls, but not the one with the door.
          if (r.windowSide && !cuts.length && isOutside(u, v) && v - u > 1.2 && r.h > HEAD) {
            pieces.push({ a: at(u), b: at(v), y0: 0, y1: SILL, glass: false })
            pieces.push({ a: at(u), b: at(v), y0: SILL, y1: HEAD, glass: true })
            pieces.push({ a: at(u), b: at(v), y0: HEAD, y1: r.h, glass: false })
          } else pieces.push({ a: at(u), b: at(v), y0: 0, y1: r.h, glass: false })
        }
      }
    })
  }
  return pieces
}

/** Wall segments at walking height, for collision */
export const blockers = (walls: WallPiece[]) => walls.filter((w) => w.y0 === 0)

/** Moves a walker of radius r out of every wall segment it overlaps */
export function collide(p: V2, r: number, segs: { a: V2; b: V2 }[]): V2 {
  let q: V2 = [...p]
  for (let pass = 0; pass < 3; pass++) {
    for (const { a, b } of segs) {
      const ab = sub(b, a)
      const L2 = dot(ab, ab)
      const t = L2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2)) : 0
      const c = add(a, mul(ab, t))
      const away = sub(q, c)
      const d = len(away)
      const reach = r + WALL / 2
      if (d < reach) q = d > 1e-6 ? add(c, mul(away, reach / d)) : add(q, [reach, 0])
    }
  }
  return q
}

/**
 * The whole site in metres. `moved` shifts rooms by [dx, dz] metres while they are dragged in edit mode.
 * Buildings of a campus stand side by side along x; floors stack by their tallest room (3 m when unset).
 */
export function buildModel(input: Pick<Site, 'floors' | 'rooms' | 'planScaleM'>, moved: Record<string, V2> = {}): Model {
  // Rooms without a drawn shape get the same automatic layout as the floor plan.
  const site = { ...input, rooms: layoutRooms(input.rooms) }
  const floorOf = new Map(site.floors.map((f) => [f.level, f]))
  const levels = [...new Set([...site.floors.map((f) => f.level), ...site.rooms.map((r) => r.floor)])].sort((a, b) => a - b)
  const buildingOf = (level: number) => floorOf.get(level)?.building ?? ''
  const names = [...new Set(levels.map(buildingOf))]
  const floors: FloorGeo[] = []
  const buildings: BuildingFrame[] = []
  let cursor = 0
  for (const name of names) {
    const bLevels = levels.filter((l) => buildingOf(l) === name)
    const bRooms = site.rooms.filter((r) => bLevels.includes(r.floor))
    // Every room is drawn from its floor-plan polygon, so the 3D model and the 2D plan always match.
    const scale = input.planScaleM ?? (planScale(bRooms) || 0.05)
    const local = new Map<string, V2[]>()
    for (const r of bRooms) if (r.polygon) local.set(r.id, r.polygon.map((p) => mul(sub(p, [PLAN_MARGIN, PLAN_MARGIN]), scale)))
    const all = [...local.values()].flat()
    const box = all.length ? bbox(all) : { min: [0, 0] as V2, max: [10, 10] as V2 }
    const offset: V2 = [cursor - box.min[0], -box.min[1]]
    const heights = bLevels.map((l) => Math.max(3, ...site.rooms.filter((r) => r.floor === l).map((r) => r.heightM ?? 3)))
    // Level 0 (or the lowest level above ground) stands on the ground; basements go below it.
    const ground = Math.max(0, bLevels.findIndex((l) => l >= 0))
    const elevation = bLevels.map((_, i) => heights.slice(0, i).reduce((a, h) => a + h, 0) - heights.slice(0, ground).reduce((a, h) => a + h, 0))
    bLevels.forEach((level, i) => {
      const y = elevation[i]
      const rooms: RoomGeo[] = site.rooms
        .filter((r) => r.floor === level && local.has(r.id))
        .map((r) => {
          const shift = moved[r.id] ?? [0, 0]
          const poly = local.get(r.id)!.map((p) => add(add(p, offset), shift))
          const b = bbox(poly)
          return {
            id: r.id,
            name: r.name,
            level,
            poly,
            origin: b.min,
            size: sub(b.max, b.min),
            center: mul(add(b.min, b.max), 0.5),
            y,
            h: r.heightM ?? 3,
            windowSide: r.windowSide,
          }
        })
      const f = floorOf.get(level)
      floors.push({ level, name: f?.name ?? (level === 0 ? 'Ground floor' : `Floor ${level}`), building: name, y, h: heights[i], rooms, walls: floorWalls(rooms) })
    })
    const top = elevation[elevation.length - 1] + heights[heights.length - 1]
    buildings.push({ name, scale, offset, min: [cursor, 0], max: [cursor + box.max[0] - box.min[0], box.max[1] - box.min[1]], top })
    cursor += box.max[0] - box.min[0] + BUILDING_GAP
  }
  const pts = floors.flatMap((f) => f.rooms.flatMap((r) => r.poly))
  const box = pts.length ? bbox(pts) : { min: [0, 0] as V2, max: [10, 10] as V2 }
  return { floors, buildings, min: box.min, max: box.max, top: Math.max(3, ...buildings.map((b) => b.top)) }
}

/** World metres back to plan units for a building */
export const toPlan = (p: V2, b: BuildingFrame): [number, number] => {
  const q = add(mul(sub(p, b.offset), 1 / b.scale), [PLAN_MARGIN, PLAN_MARGIN])
  return [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]
}

/**
 * Edit mode saves the layout seen in 3D: every room on a floor that was edited gets its polygon written in
 * plan units, so the 2D floor plan and other devices show the same building.
 */
export function savePolygons(site: Site, model: Model, levels: number[]): Site {
  const geo = new Map(model.floors.filter((f) => levels.includes(f.level)).flatMap((f) => f.rooms.map((r) => [r.id, { r, f }] as const)))
  return {
    ...site,
    planScaleM: site.planScaleM ?? model.buildings[0]?.scale,
    rooms: site.rooms.map((room) => {
      const g = geo.get(room.id)
      if (!g) return room
      const b = model.buildings.find((x) => x.name === g.f.building)!
      return { ...room, polygon: g.r.poly.map((p) => toPlan(p, b)), autoLayout: undefined }
    }),
  }
}

/** A device in world space: where it is drawn, and whether that spot was placed by a person or arranged automatically */
export interface Placed {
  device: Device
  room: RoomGeo
  /** Room metres [x, height, z] from the room's origin corner */
  local: [number, number, number]
  world: [number, number, number]
  auto: boolean
}

const CEILING: DeviceType[] = ['light', 'fan', 'projector']

/** Cell centres of an n-cell grid over a w x d rectangle, as square as the room allows */
function grid(n: number, w: number, d: number, inset = 0.6): V2[] {
  if (n <= 0) return []
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / Math.max(d, 0.1))))
  const rows = Math.ceil(n / cols)
  const W = Math.max(0.1, w - 2 * inset)
  const D = Math.max(0.1, d - 2 * inset)
  return Array.from({ length: n }, (_, i) => [inset + (W * ((i % cols) + 0.5)) / cols, inset + (D * (Math.floor(i / cols) + 0.5)) / rows])
}

/** Every device with a spot: its saved position, or a tidy default (ceiling grid, AC on a wall, desks for PCs) */
export function placeDevices(room: Room, geo: RoomGeo): Placed[] {
  const [w, d] = geo.size
  const h = geo.h
  const byType = new Map<DeviceType, Device[]>()
  for (const dev of room.devices.filter((x) => !x.position)) byType.set(dev.type, [...(byType.get(dev.type) ?? []), dev])
  const autoSpot = new Map<string, [number, number, number]>()
  for (const [type, list] of byType) {
    if (type === 'projector') list.forEach((dev, i) => autoSpot.set(dev.id, [w / 2 + i * 0.8, h - 0.35, Math.min(d * 0.4, 4)]))
    else if (type === 'ac') list.forEach((dev, i) => autoSpot.set(dev.id, [(w * (i + 1)) / (list.length + 1), h - 0.5, WALL / 2 + 0.15]))
    else {
      const y = type === 'light' ? h - 0.04 : type === 'fan' ? h - 0.45 : 0.78
      // Fans keep further from the walls than lights, so the two grids rarely coincide.
      const cells = grid(list.length, w, d, type === 'fan' ? 1.2 : type === 'pc' ? 1 : 0.6)
      list.forEach((dev, i) => autoSpot.set(dev.id, [cells[i][0], y, cells[i][1]]))
    }
  }
  return room.devices.map((device) => {
    const local = device.position ?? autoSpot.get(device.id)!
    return { device, room: geo, local, world: [geo.origin[0] + local[0], geo.y + local[1], geo.origin[1] + local[2]], auto: !device.position }
  })
}

export const isCeilingType = (t: DeviceType) => CEILING.includes(t)

/** The room a world point is in, on a floor */
export const roomAt = (floor: FloorGeo, p: V2) => floor.rooms.find((r) => inPoly(p, r.poly))
