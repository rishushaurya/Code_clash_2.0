// The Assistant proposes site changes; it never saves them. A proposal is a diff the person reads and approves:
// code checks it against the site and builds the next site, and only the Approve button saves it, through the
// same path as the Setup page (setSite, then pushSite to the server).

import { deviceCounts, makeDevices, ROOM_TEMPLATES } from '@/shared/site'
import type { DeviceType, Room, RoomType, Site } from '@/shared/types'

export type SiteChange =
  | { kind: 'setDeviceCount'; roomId: string; device: DeviceType; count: number }
  | { kind: 'setCapacity'; roomId: string; capacity: number }
  | { kind: 'setHours'; from: number; to: number; days?: number[] }
  | { kind: 'setAutoOff'; enabled: boolean; minutes?: number }
  | { kind: 'addRoom'; id: string; name: string; floor?: number; type?: RoomType; capacity?: number }
  | { kind: 'renameRoom'; roomId: string; name: string }

export interface Proposal {
  /** One line per field that changes: what it is, before, after */
  rows: { label: string; before: string; after: string }[]
  /** What the person approves */
  summary: string
  next: Site
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const NAMES: Record<DeviceType, string> = { light: 'lights', fan: 'fans', ac: 'ACs', projector: 'projectors', pc: 'PCs' }
const hours = (h: Site['hours']) => `${h.from}:00 to ${h.to}:00, ${h.days.map((d) => DAY[d]).join(' ')}`
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** Checks a change against the site; returns the diff and the next site, or why it cannot be applied */
export function propose(site: Site, c: SiteChange): Proposal | string {
  // The plan comes from the AI as JSON, so a field the type promises may still be missing.
  const roomId = (c as { roomId?: string }).roomId
  const room = site.rooms.find((r) => r.id === roomId)
  if (['setDeviceCount', 'setCapacity', 'renameRoom'].includes(c.kind) && !room) return roomId ? `There is no room ${roomId} in this building.` : 'Which room should change?'
  const withRoom = (next: Room) => ({ ...site, rooms: site.rooms.map((r) => (r.id === next.id ? next : r)) })

  switch (c.kind) {
    case 'setDeviceCount': {
      if (!int(c.count, 0, 500) || !NAMES[c.device]) return 'A device count is a whole number from 0 to 500.'
      const before = deviceCounts(room!)[c.device] ?? 0
      if (before === c.count) return `${room!.id} already has ${c.count} ${NAMES[c.device]}.`
      const fresh = makeDevices(room!.id, { ...deviceCounts(room!), [c.device]: c.count }, Object.fromEntries(room!.devices.map((d) => [d.type, d.ratedW])))
      // Keep ids, ratings, zones and positions of devices that already existed, as the Setup editor does.
      const next = { ...room!, devices: fresh.map((d) => room!.devices.find((o) => o.id === d.id) ?? d) }
      return { rows: [{ label: `${room!.id} ${NAMES[c.device]}`, before: String(before), after: String(c.count) }], summary: `Set ${room!.id} to ${c.count} ${NAMES[c.device]}`, next: withRoom(next) }
    }
    case 'setCapacity':
      if (!int(c.capacity, 1, 5000)) return 'Seats are a whole number from 1 to 5000.'
      return { rows: [{ label: `${room!.id} seats`, before: String(room!.capacity), after: String(c.capacity) }], summary: `Set ${room!.id} to ${c.capacity} seats`, next: withRoom({ ...room!, capacity: c.capacity }) }
    case 'renameRoom': {
      const name = c.name?.trim().slice(0, 60)
      if (!name) return 'The new name is empty.'
      return { rows: [{ label: `${room!.id} name`, before: room!.name, after: name }], summary: `Rename ${room!.id} to ${name}`, next: withRoom({ ...room!, name }) }
    }
    case 'setHours': {
      const days = c.days?.length ? [...new Set(c.days)].sort() : site.hours.days
      if (!int(c.from, 0, 23) || !int(c.to, 1, 24) || c.to <= c.from || !days.every((d) => int(d, 0, 6))) return 'Opening hours run from 0 to 24, and closing comes after opening.'
      const h = { from: c.from, to: c.to, days }
      return { rows: [{ label: 'Opening hours', before: hours(site.hours), after: hours(h) }], summary: `Open ${hours(h)}`, next: { ...site, hours: h } }
    }
    case 'setAutoOff': {
      const minutes = c.minutes ?? site.autoOff.minutes
      if (typeof c.enabled !== 'boolean' || !int(minutes, 1, 240)) return 'Auto-off needs on or off, and minutes from 1 to 240.'
      const say = (a: Site['autoOff']) => (a.enabled ? `On, after ${a.minutes} empty minutes` : 'Off')
      const a = { enabled: c.enabled, minutes }
      return { rows: [{ label: 'Automatic switch-off', before: say(site.autoOff), after: say(a) }], summary: `Automatic switch-off: ${say(a)}`, next: { ...site, autoOff: a } }
    }
    case 'addRoom': {
      if (!/^[A-Za-z0-9-]{1,12}$/.test(c.id ?? '')) return 'A room id is up to 12 letters, digits and dashes, like LH-3.'
      if (site.rooms.some((r) => r.id === c.id)) return `${c.id} already exists.`
      const type = c.type && ROOM_TEMPLATES[c.type] ? c.type : 'other'
      const t = ROOM_TEMPLATES[type]
      const floor = int(c.floor, -5, 200) ? c.floor! : (site.floors[0]?.level ?? 0)
      const capacity = int(c.capacity, 1, 5000) ? c.capacity! : t.capacity
      const room: Room = { id: c.id, name: c.name?.trim().slice(0, 60) || c.id, floor, type, capacity, areaM2: t.areaM2, volumeM3: t.areaM2 * 3, windowSide: false, devices: makeDevices(c.id, t.counts) }
      const counts = Object.entries(t.counts).map(([k, n]) => `${n} ${NAMES[k as DeviceType]}`).join(', ')
      return {
        rows: [{ label: 'New room', before: 'None', after: `${room.id}, ${room.name}, floor ${floor}, ${capacity} seats, ${t.label} template (${counts}, ${t.areaM2} m²)` }],
        summary: `Add ${room.id}; adjust its devices and area in Settings, Site`,
        next: { ...site, floors: site.floors.some((f) => f.level === floor) ? site.floors : [...site.floors, { level: floor, name: `Floor ${floor}` }], rooms: [...site.rooms, room] },
      }
    }
  }
}
