// Every change to the building's design goes through applyOps: buttons in the 3D view and the AI designer
// both produce the same small operations, so a change made one way looks and saves exactly like the other.
// Sizes are metres; rooms are stored as floor-plan polygons in plan units, converted with the building's
// own scale so the 2D plan, the 3D model and the recorded areas always agree.

import { deviceCounts, layoutRooms, makeDevices, ROOM_TEMPLATES, type DeviceCounts } from '@/shared/site'
import type { DeviceType, FurnitureKind, Room, RoomType, Site } from '@/shared/types'
import { bbox, planScale, type V2 } from './model'

export type Style = NonNullable<Room['style']>
export type Furniture = NonNullable<Room['furniture']>[number]

export type DesignOp =
  | { op: 'addFloor'; level: number; name: string; building?: string }
  | { op: 'renameFloor'; level: number; name: string }
  | { op: 'removeFloor'; level: number }
  | {
      op: 'addRoom'
      floor: number
      name: string
      type: RoomType
      widthM?: number
      depthM?: number
      heightM?: number
      capacity?: number
      counts?: DeviceCounts
      style?: Style
      furniture?: { kind: FurnitureKind; count: number }[]
      /** Copies another room's devices, style and furniture */
      copyOf?: string
    }
  | { op: 'updateRoom'; roomId: string; name?: string; type?: RoomType; widthM?: number; depthM?: number; heightM?: number; capacity?: number; windowSide?: boolean }
  | { op: 'moveRoom'; roomId: string; floor: number }
  | { op: 'removeRoom'; roomId: string }
  | { op: 'setDevices'; roomId: string; counts: DeviceCounts }
  | { op: 'removeDevice'; roomId: string; deviceId: string }
  | { op: 'setStyle'; roomId: string; style: Style }
  | { op: 'setFurniture'; roomId: string; items: { kind: FurnitureKind; count: number }[] }
  | { op: 'placeFurniture'; roomId: string; items: Furniture[] }

const ID_PREFIX: Record<RoomType, string> = { classroom: 'CR', lecture_hall: 'LH', lab: 'LAB', office: 'OFF', meeting: 'MR', other: 'RM' }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r2 = (v: number) => Math.round(v * 100) / 100
const PLAN_ORIGIN: V2 = [20, 20]

/** Freezes the automatic floor plan, so a change to one room never reshuffles the others */
export function freeze(site: Site): Site {
  const rooms = layoutRooms(site.rooms).map((r) => ({ ...r, autoLayout: undefined }))
  return { ...site, rooms, planScaleM: site.planScaleM ?? (planScale(rooms) || 0.05) }
}

/** Metres per plan unit for the building a floor belongs to */
export function scaleFor(site: Site, floor: number) {
  if (site.planScaleM) return site.planScaleM
  const building = site.floors.find((f) => f.level === floor)?.building ?? ''
  const levels = site.floors.filter((f) => (f.building ?? '') === building).map((f) => f.level)
  return planScale(site.rooms.filter((r) => levels.includes(r.floor))) || 0.05
}

/** A room's size in metres, from its polygon */
export function roomSize(site: Site, room: Room): V2 {
  if (!room.polygon) {
    const side = Math.sqrt(room.areaM2)
    return [r2(side), r2(side)]
  }
  const s = scaleFor(site, room.floor)
  const b = bbox(room.polygon)
  return [r2((b.max[0] - b.min[0]) * s), r2((b.max[1] - b.min[1]) * s)]
}

const rect = (x: number, y: number, w: number, h: number): [number, number][] => [
  [r2(x), r2(y)],
  [r2(x + w), r2(y)],
  [r2(x + w), r2(y + h)],
  [r2(x), r2(y + h)],
]

function nextId(site: Site, type: RoomType) {
  const taken = new Set(site.rooms.map((r) => r.id))
  for (let n = 1; ; n++) {
    const id = `${ID_PREFIX[type]}-${n}`
    if (!taken.has(id)) return id
  }
}

/** Where a new room goes on a floor: right of the rooms already there, top-aligned */
function freeSpot(site: Site, floor: number): V2 {
  const here = site.rooms.filter((r) => r.floor === floor && r.polygon).flatMap((r) => r.polygon!)
  if (here.length) {
    const b = bbox(here)
    return [b.max[0], b.min[1]]
  }
  const any = site.rooms.filter((r) => r.polygon).flatMap((r) => r.polygon!)
  return any.length ? bbox(any).min : PLAN_ORIGIN
}

/** Furniture laid out for a room type: rows of desks facing a board, benches, a table, sofas */
export function arrangeFurniture(type: RoomType, w: number, d: number, items?: { kind: FurnitureKind; count: number }[]): Furniture[] {
  const out: Furniture[] = []
  const rows = (kind: FurnitureKind, n: number, from: number, pitchX = 1.4, pitchZ = 1.3) => {
    const cols = Math.max(1, Math.floor((w - 1.2) / pitchX))
    for (let i = 0; i < n; i++) {
      const z = from + Math.floor(i / cols) * pitchZ
      if (z > d - 0.8) break
      out.push({ kind, x: r2(0.6 + pitchX * ((i % cols) + 0.5)), z: r2(z), rot: 0 })
    }
  }
  const scatter = (kind: FurnitureKind, n: number) => {
    // Around the walls, clockwise from the far corner.
    const spots: Furniture[] = [
      { kind, x: w - 0.6, z: 0.6, rot: 0 },
      { kind, x: w - 0.6, z: d - 0.6, rot: Math.PI },
      { kind, x: 0.6, z: d - 0.6, rot: Math.PI },
      { kind, x: 0.6, z: 0.6, rot: 0 },
      { kind, x: w / 2, z: d - 0.5, rot: Math.PI },
    ]
    out.push(...spots.slice(0, n).map((f) => ({ ...f, x: r2(f.x), z: r2(f.z) })))
  }
  if (items?.length) {
    for (const { kind, count } of items) {
      const n = clamp(Math.round(count), 0, 200)
      if (kind === 'desk' || kind === 'chair' || kind === 'bench') rows(kind, n, 2.4)
      else if (kind === 'board') out.push({ kind, x: r2(w / 2), z: 0.1, rot: 0 })
      else if (kind === 'table') out.push({ kind, x: r2(w / 2), z: r2(d / 2), rot: 0 })
      else scatter(kind, n)
    }
    return out
  }
  const seats = Math.floor(((w - 1.2) / 1.4) * ((d - 3) / 1.3))
  if (type === 'classroom' || type === 'lecture_hall') {
    out.push({ kind: 'board', x: r2(w / 2), z: 0.1, rot: 0 }, { kind: 'podium', x: r2(w / 2 - 1.4), z: 1.2, rot: 0 })
    rows('desk', Math.max(0, seats), 2.6)
  } else if (type === 'lab') {
    out.push({ kind: 'board', x: r2(w / 2), z: 0.1, rot: 0 })
    rows('bench', Math.max(0, Math.floor(seats / 2)), 2.6, 2.2, 1.8)
  } else if (type === 'office') {
    rows('desk', Math.min(8, Math.max(1, Math.floor((w * d) / 6))), 1.4, 1.8, 1.8)
    scatter('shelf', 1)
    scatter('plant', 2)
  } else if (type === 'meeting') {
    out.push({ kind: 'table', x: r2(w / 2), z: r2(d / 2), rot: 0 }, { kind: 'board', x: r2(w / 2), z: 0.1, rot: 0 })
    scatter('plant', 1)
  } else {
    scatter('sofa', 2)
    scatter('plant', 2)
  }
  return out.filter((f) => f.x >= 0 && f.x <= w && f.z >= 0 && f.z <= d)
}

/** Applies operations in order. Unknown rooms or floors are skipped and listed in `notes`. */
export function applyOps(input: Site, ops: DesignOp[]): { site: Site; notes: string[] } {
  let site = freeze(input)
  const notes: string[] = []
  const room = (id: string) => site.rooms.find((r) => r.id === id)
  const replace = (id: string, f: (r: Room) => Room) => (site = { ...site, rooms: site.rooms.map((r) => (r.id === id ? f(r) : r)) })

  for (const o of ops) {
    if (o.op === 'addFloor') {
      if (site.floors.some((f) => f.level === o.level)) notes.push(`Floor ${o.level} already exists`)
      else site = { ...site, floors: [...site.floors, { level: o.level, name: o.name.slice(0, 40) || `Floor ${o.level}`, ...(o.building && { building: o.building }) }].sort((a, b) => a.level - b.level) }
      continue
    }
    if (o.op === 'renameFloor') {
      site = { ...site, floors: site.floors.map((f) => (f.level === o.level ? { ...f, name: o.name.slice(0, 40) || f.name } : f)) }
      continue
    }
    if (o.op === 'removeFloor') {
      if (site.floors.length <= 1) notes.push('A building keeps at least one floor')
      else site = { ...site, floors: site.floors.filter((f) => f.level !== o.level), rooms: site.rooms.filter((r) => r.floor !== o.level) }
      continue
    }
    if (o.op === 'addRoom') {
      if (!site.floors.some((f) => f.level === o.floor)) site = { ...site, floors: [...site.floors, { level: o.floor, name: `Floor ${o.floor}` }].sort((a, b) => a.level - b.level) }
      const src = o.copyOf ? room(o.copyOf) : undefined
      const t = ROOM_TEMPLATES[o.type]
      const id = nextId(site, o.type)
      const [sw, sd] = src ? roomSize(site, src) : [0, 0]
      const w = clamp(o.widthM ?? (sw || Math.sqrt(t.areaM2 * 1.4)), 2, 80)
      const d = clamp(o.depthM ?? (sd || t.areaM2 / w), 2, 80)
      const h = clamp(o.heightM ?? src?.heightM ?? 3, 2.2, 12)
      const s = scaleFor(site, o.floor)
      const [x, y] = freeSpot(site, o.floor)
      const watts = Object.fromEntries((src ?? site.rooms[0])?.devices.map((x) => [x.type, x.ratedW]) ?? [])
      const counts = o.counts ?? (src ? deviceCounts(src) : t.counts)
      site = {
        ...site,
        rooms: [
          ...site.rooms,
          {
            id,
            name: (o.name || (src ? `${src.name} copy` : t.label)).slice(0, 60),
            floor: o.floor,
            type: o.type,
            capacity: clamp(Math.round(o.capacity ?? src?.capacity ?? t.capacity), 1, 5000),
            areaM2: r2(w * d),
            volumeM3: r2(w * d * h),
            windowSide: src?.windowSide ?? true,
            polygon: rect(x, y, w / s, d / s),
            heightM: h,
            devices: makeDevices(id, counts, watts),
            ...((o.style ?? src?.style) && { style: o.style ?? src!.style }),
            ...(o.furniture ? { furniture: arrangeFurniture(o.type, w, d, o.furniture) } : src?.furniture ? { furniture: src.furniture } : {}),
          },
        ],
      }
      continue
    }

    const target = room(o.roomId)
    if (!target) {
      notes.push(`No room ${o.roomId}`)
      continue
    }
    if (o.op === 'removeRoom') site = { ...site, rooms: site.rooms.filter((r) => r.id !== o.roomId) }
    else if (o.op === 'moveRoom') {
      if (!site.floors.some((f) => f.level === o.floor)) notes.push(`No floor ${o.floor}`)
      else {
        const [w, d] = roomSize(site, target)
        const s = scaleFor(site, o.floor)
        const [x, y] = freeSpot({ ...site, rooms: site.rooms.filter((r) => r.id !== o.roomId) }, o.floor)
        replace(o.roomId, (r) => ({ ...r, floor: o.floor, polygon: rect(x, y, w / s, d / s) }))
      }
    } else if (o.op === 'updateRoom') {
      replace(o.roomId, (r) => {
        const [w0, d0] = roomSize(site, r)
        const w = clamp(o.widthM ?? w0, 2, 80)
        const d = clamp(o.depthM ?? d0, 2, 80)
        const h = clamp(o.heightM ?? r.heightM ?? 3, 2.2, 12)
        const resized = o.widthM !== undefined || o.depthM !== undefined
        const s = scaleFor(site, r.floor)
        const b = r.polygon ? bbox(r.polygon) : { min: freeSpot(site, r.floor), max: [0, 0] as V2 }
        return {
          ...r,
          ...(o.name !== undefined && { name: o.name.slice(0, 60) || r.name }),
          ...(o.type && { type: o.type }),
          ...(o.capacity !== undefined && { capacity: clamp(Math.round(o.capacity), 1, 5000) }),
          ...(o.windowSide !== undefined && { windowSide: o.windowSide }),
          heightM: h,
          areaM2: resized ? r2(w * d) : r.areaM2,
          volumeM3: r2((resized ? w * d : r.areaM2) * h),
          ...(resized && { polygon: rect(b.min[0], b.min[1], w / s, d / s), furniture: r.furniture?.filter((f) => f.x <= w && f.z <= d) }),
        }
      })
    } else if (o.op === 'setDevices') {
      replace(o.roomId, (r) => {
        const watts = Object.fromEntries(r.devices.map((x) => [x.type, x.ratedW]))
        const counts = Object.fromEntries(Object.entries({ ...deviceCounts(r), ...o.counts }).map(([k, v]) => [k, clamp(Math.round(v ?? 0), 0, 500)])) as DeviceCounts
        // Devices that stay keep their id, zone and placed position.
        return { ...r, devices: makeDevices(r.id, counts, watts).map((x) => r.devices.find((old) => old.id === x.id) ?? x) }
      })
    } else if (o.op === 'removeDevice') replace(o.roomId, (r) => ({ ...r, devices: r.devices.filter((x) => x.id !== o.deviceId) }))
    else if (o.op === 'setStyle') replace(o.roomId, (r) => ({ ...r, style: { ...r.style, ...o.style } }))
    else if (o.op === 'setFurniture') {
      const [w, d] = roomSize(site, target)
      replace(o.roomId, (r) => ({ ...r, furniture: arrangeFurniture(r.type, w, d, o.items) }))
    } else if (o.op === 'placeFurniture') replace(o.roomId, (r) => ({ ...r, furniture: o.items }))
  }
  return { site, notes }
}

/** One plain line per operation, for the review list before anything is saved */
export function describeOp(o: DesignOp, site: Site): string {
  const name = (id: string) => site.rooms.find((r) => r.id === id)?.name ?? id
  const counts = (c: DeviceCounts) =>
    (Object.entries(c) as [DeviceType, number][])
      .map(([k, v]) => `${v} ${k === 'ac' ? 'AC' : k === 'pc' ? 'PC' : k}${v === 1 ? '' : 's'}`)
      .join(', ')
  switch (o.op) {
    case 'addFloor':
      return `Add floor ${o.level}: ${o.name}`
    case 'renameFloor':
      return `Rename floor ${o.level} to ${o.name}`
    case 'removeFloor':
      return `Remove floor ${o.level} and its rooms`
    case 'addRoom':
      return `Add ${ROOM_TEMPLATES[o.type].label.toLowerCase()} "${o.name}" on floor ${o.floor}${o.widthM && o.depthM ? `, ${o.widthM} x ${o.depthM} m` : ''}${o.counts ? `, ${counts(o.counts)}` : ''}`
    case 'updateRoom':
      return `Change ${name(o.roomId)}: ${[o.name && `name ${o.name}`, o.type && ROOM_TEMPLATES[o.type].label.toLowerCase(), o.widthM && `width ${o.widthM} m`, o.depthM && `depth ${o.depthM} m`, o.heightM && `height ${o.heightM} m`, o.capacity && `${o.capacity} seats`].filter(Boolean).join(', ')}`
    case 'moveRoom':
      return `Move ${name(o.roomId)} to floor ${o.floor}`
    case 'removeRoom':
      return `Remove ${name(o.roomId)}`
    case 'setDevices':
      return `Devices in ${name(o.roomId)}: ${counts(o.counts)}`
    case 'removeDevice':
      return `Remove ${o.deviceId}`
    case 'setStyle':
      return `New look for ${name(o.roomId)}`
    case 'setFurniture':
      return `Furniture in ${name(o.roomId)}: ${o.items.map((i) => `${i.count} ${i.kind}`).join(', ')}`
    case 'placeFurniture':
      return `Rearrange furniture in ${name(o.roomId)}`
  }
}

/**
 * A whole building from a real outline (OpenStreetMap): one floor per level, rooms on both sides of a corridor
 * along the long side. A starting point: rename, resize and refit rooms afterwards.
 */
export function fromOutline(input: Site, outline: { poly: V2[]; levels: number | null }, levels = outline.levels ?? 1): Site {
  const b = bbox(outline.poly)
  const W = b.max[0] - b.min[0]
  const D = b.max[1] - b.min[1]
  const n = clamp(Math.round(levels), 1, 30)
  const s = W / 960
  const corridor = D > 14 ? 2.4 : 0
  const depth = corridor ? (D - corridor) / 2 : D
  const count = Math.max(1, Math.round(W / 7))
  const w = W / count
  const floors = Array.from({ length: n }, (_, i) => ({ level: i, name: i === 0 ? 'Ground floor' : `Floor ${i}` }))
  const rooms: Room[] = []
  for (const f of floors) {
    for (const side of corridor ? [0, 1] : [0]) {
      for (let i = 0; i < count; i++) {
        const type: RoomType = w * depth > 110 ? 'lecture_hall' : w * depth > 45 ? 'classroom' : 'office'
        const id = `${ID_PREFIX[type]}-${f.level}${side}${String(i + 1).padStart(2, '0')}`.slice(0, 12)
        const y = side ? (depth + corridor) / s : 0
        rooms.push({
          id,
          name: `${ROOM_TEMPLATES[type].label} ${f.level}.${side * count + i + 1}`,
          floor: f.level,
          type,
          capacity: ROOM_TEMPLATES[type].capacity,
          areaM2: r2(w * depth),
          volumeM3: r2(w * depth * 3),
          windowSide: true,
          heightM: 3,
          polygon: rect(PLAN_ORIGIN[0] + (i * w) / s, PLAN_ORIGIN[1] + y, w / s, depth / s),
          devices: makeDevices(id, ROOM_TEMPLATES[type].counts),
        })
      }
    }
  }
  return { ...input, floors, rooms, planScaleM: s }
}
