// The customer's site: building, rooms, devices and money settings. Saved in this browser and
// exported or imported as JSON, which is also the integration contract for other systems.
// No built-in rooms or data: a new install starts empty and the setup page fills it in.

import { z } from 'zod'
import { create } from 'zustand'
import { WATTS } from './config'
import type { DeviceType, Room, RoomType, Site } from './types'
import { apiFetch, ns, online } from './workspace'

const STORAGE_KEY = ns('pratibimb:site')

/** Monday to Friday, 9:00 to 17:00 (days: 0 = Monday ... 6 = Sunday) */
export const DEFAULT_HOURS = { from: 9, to: 17, days: [0, 1, 2, 3, 4] }

const BRICK: Record<DeviceType, string> = { light: 'Luminaire', fan: 'Fan', ac: 'Air_Handling_Unit', projector: 'Projector', pc: 'Computer' }

export type DeviceCounts = Partial<Record<DeviceType, number>>

/** Starting points for a new room; every number is editable in setup. */
export const ROOM_TEMPLATES: Record<RoomType, { label: string; capacity: number; areaM2: number; counts: DeviceCounts }> = {
  classroom: { label: 'Classroom', capacity: 60, areaM2: 70, counts: { light: 10, fan: 6, projector: 1 } },
  lecture_hall: { label: 'Lecture hall', capacity: 120, areaM2: 150, counts: { light: 16, fan: 8, ac: 2, projector: 1 } },
  lab: { label: 'Lab', capacity: 40, areaM2: 90, counts: { light: 12, fan: 6, ac: 2, projector: 1, pc: 40 } },
  office: { label: 'Office', capacity: 8, areaM2: 30, counts: { light: 6, fan: 2, ac: 1, pc: 4 } },
  meeting: { label: 'Meeting room', capacity: 12, areaM2: 25, counts: { light: 4, ac: 1, projector: 1 } },
  other: { label: 'Other space', capacity: 20, areaM2: 40, counts: { light: 6, fan: 2 } },
}

/**
 * Country presets. Only values with a named official source are filled in; anything else is typed
 * in from the customer's bill or grid authority. `source` is shown in Setup next to the numbers.
 */
export const COUNTRY_PRESETS: Record<string, { currency: string; tariffPerKwh?: number; gridKgPerKwh?: number; source?: string }> = {
  IN: { currency: 'INR', tariffPerKwh: 8.73, gridKgPerKwh: 0.727, source: 'Tariff: BESCOM educational LT-2 (8.17) plus true-up (0.56). Grid: CEA CO2 Baseline Database' },
  GB: { currency: 'GBP', gridKgPerKwh: 0.20705, source: 'Grid: DESNZ greenhouse gas conversion factors 2024 (generation)' },
  US: { currency: 'USD', gridKgPerKwh: 0.35, source: 'Grid: EPA eGRID 2023 national average; use your eGRID subregion if known' },
  SG: { currency: 'SGD', gridKgPerKwh: 0.402, source: 'Grid: EMA Singapore grid emission factor, 2024 data year' },
  AE: { currency: 'AED' },
  AU: { currency: 'AUD' },
  CA: { currency: 'CAD' },
  JP: { currency: 'JPY' },
  ...Object.fromEntries(['DE', 'FR', 'IT', 'ES', 'NL', 'IE', 'PT', 'BE', 'AT', 'FI'].map((c) => [c, { currency: 'EUR' }])),
}

function localeRegion() {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? ''
  } catch {
    return ''
  }
}

export function emptySite(region = typeof navigator === 'undefined' ? '' : localeRegion()): Site {
  const preset = COUNTRY_PRESETS[region] ?? { currency: 'USD' }
  return {
    version: 1,
    organization: '',
    buildingName: '',
    location: null,
    currency: preset.currency,
    tariffPerKwh: preset.tariffPerKwh ?? 0,
    gridKgPerKwh: preset.gridKgPerKwh ?? 0,
    emptyDelayS: 300,
    leftOnProbability: 0.4,
    alertLanguages: ['en'],
    hours: DEFAULT_HOURS,
    autoOff: { enabled: false, minutes: 10 },
    floors: [{ level: 0, name: 'Ground floor' }],
    rooms: [],
  }
}

/** Devices for a room, with camera zones: lights split into L1/L2, fans watched as F1, screens as S1. */
export function makeDevices(roomId: string, counts: DeviceCounts, watts: Partial<Record<DeviceType, number>> = {}) {
  const lightZones = (counts.light ?? 0) >= 6 ? ['L1', 'L2'] : ['L1']
  return (Object.entries(counts) as [DeviceType, number][]).flatMap(([type, n]) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${roomId}/${type}-${String(i + 1).padStart(2, '0')}`,
      type,
      ratedW: watts[type] ?? WATTS[type],
      zone: type === 'light' ? lightZones[Math.floor((i * lightZones.length) / n)] : type === 'fan' ? 'F1' : type === 'projector' ? 'S1' : undefined,
      brickClass: BRICK[type],
    })),
  )
}

export const deviceCounts = (room: Room): DeviceCounts =>
  room.devices.reduce<DeviceCounts>((a, d) => ({ ...a, [d.type]: (a[d.type] ?? 0) + 1 }), {})

/**
 * Rooms with no drawn shape get a tidy grid on their floor, sized to the 1000 x 600 plan.
 * Automatic shapes are recomputed every time; shapes imported from the customer's drawings are kept.
 */
export function layoutRooms(input: Room[]): Room[] {
  const rooms = input.map((r) => (r.autoLayout ? { ...r, polygon: undefined, autoLayout: undefined } : r))
  const floors = [...new Set(rooms.map((r) => r.floor))]
  const placed = new Map<string, [number, number][]>()
  for (const f of floors) {
    const todo = rooms.filter((r) => r.floor === f && !r.polygon)
    // Rows first, so 4 rooms make a 2 x 2 grid and 6 make 3 x 2 on the wide plan.
    const rows = Math.max(1, Math.round(Math.sqrt(todo.length / (1000 / 600))))
    const cols = Math.max(1, Math.ceil(todo.length / rows))
    const w = 960 / Math.max(1, cols)
    const h = 560 / rows
    todo.forEach((r, i) => {
      const x = 20 + (i % cols) * w
      const y = 20 + Math.floor(i / cols) * h
      placed.set(r.id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    })
  }
  return rooms.map((r) => (r.polygon ? r : { ...r, polygon: placed.get(r.id), autoLayout: true }))
}

/** Camera zones a room offers, with what the camera measures for each */
export function zonesOf(room: Room) {
  const ids = [...new Set(room.devices.flatMap((d) => (d.zone ? [d.zone] : [])))].sort()
  return ids.map((id) => ({ id, kind: id.startsWith('F') ? ('motion' as const) : ('brightness' as const), label: id.startsWith('F') ? 'fan' : id.startsWith('S') ? 'screen' : 'light' }))
}

const RoomSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,12}$/),
  name: z.string().min(1).max(60),
  floor: z.number().int(),
  type: z.enum(['lecture_hall', 'classroom', 'lab', 'office', 'meeting', 'other']),
  capacity: z.number().int().min(1),
  areaM2: z.number().positive(),
  volumeM3: z.number().positive(),
  windowSide: z.boolean(),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3).optional(),
  devices: z.array(z.object({ id: z.string(), type: z.enum(['light', 'fan', 'ac', 'projector', 'pc']), ratedW: z.number().min(0), zone: z.string().optional(), brickClass: z.string() })),
  cameraMerge: z.enum(['max', 'sum']).optional(),
  hasRealRelay: z.boolean().optional(),
  autoLayout: z.boolean().optional(),
  autoOffExempt: z.boolean().optional(),
})

export const SiteSchema = z.object({
  version: z.literal(1),
  organization: z.string().max(80),
  buildingName: z.string().max(80),
  location: z.object({ name: z.string(), lat: z.number(), lon: z.number(), countryCode: z.string().optional() }).nullable(),
  currency: z.string().length(3),
  tariffPerKwh: z.number().min(0),
  gridKgPerKwh: z.number().min(0),
  emptyDelayS: z.number().int().min(5).max(3600),
  leftOnProbability: z.number().min(0).max(1),
  alertLanguages: z.array(z.enum(['en', 'hi', 'kn'])).min(1),
  // Older site files have no hours: they get the default rather than failing to load.
  hours: z
    .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24), days: z.array(z.number().int().min(0).max(6)).max(7) })
    .refine((h) => h.to > h.from, 'closing hour must be after opening hour')
    .default(DEFAULT_HOURS),
  autoOff: z.object({ enabled: z.boolean(), minutes: z.number().int().min(1).max(240) }).default({ enabled: false, minutes: 10 }),
  floors: z.array(z.object({ level: z.number().int(), name: z.string(), building: z.string().max(60).optional() })).min(1),
  rooms: z.array(RoomSchema),
  telegramChatId: z.string().regex(/^-?\d{1,20}$/, 'Telegram chat id: digits, with a minus sign for groups').optional(),
})

function load(): Site {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = SiteSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return { ...parsed.data, rooms: layoutRooms(parsed.data.rooms) }
    }
  } catch {
    // Corrupt storage: start a fresh setup rather than crash.
  }
  return emptySite()
}

export const useSite = create<{ site: Site }>(() => ({ site: load() }))

/** Replace the whole site (setup, import). Rooms without shapes are laid out; the result is saved. */
export function setSite(site: Site) {
  const next = { ...site, rooms: layoutRooms(site.rooms) }
  useSite.setState({ site: next })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the site lasts for this session.
  }
}

export const getSite = () => useSite.getState().site
export const getRoom = (id: string) => getSite().rooms.find((r) => r.id === id)
export const isConfigured = (s: Site) => s.rooms.length > 0 && s.tariffPerKwh > 0

/** AI Surveyor and the setup editor: replace a room's device counts, keeping existing devices and zones. */
export function setDeviceCounts(roomId: string, counts: DeviceCounts) {
  const site = getSite()
  setSite({
    ...site,
    rooms: site.rooms.map((room) => {
      if (room.id !== roomId) return room
      const fresh = makeDevices(roomId, { ...deviceCounts(room), ...counts }, Object.fromEntries(room.devices.map((d) => [d.type, d.ratedW])))
      // Keep ids, ratings and zones of devices that already existed.
      return { ...room, devices: fresh.map((d) => room.devices.find((o) => o.id === d.id) ?? d) }
    }),
  })
}

/** Parse an imported site file. Returns the site or a readable error. */
export function parseSite(json: string): Site | string {
  try {
    const parsed = SiteSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : `Not a valid site file: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`
  } catch {
    return 'The file is not JSON.'
  }
}

const UNSYNCED_KEY = ns('pratibimb:site-unsynced')

/**
 * Keep this device in step with the workspace's site on the server.
 * A local edit that failed to upload is pushed first, so an older server copy never overwrites it.
 */
export async function syncSiteFromServer() {
  if (!online()) return
  try {
    if (localStorage.getItem(UNSYNCED_KEY)) return void (await pushSite(getSite()))
    const res = await apiFetch('/api/site')
    if (!res.ok) return
    const { site } = (await res.json()) as { site: unknown }
    const parsed = SiteSchema.safeParse(site)
    if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(getSite())) setSite(parsed.data)
  } catch {
    // Offline or no server: this device's copy stands.
  }
}

/** Save to the server. Returns where the site now lives. */
export async function pushSite(site: Site): Promise<'server' | 'device'> {
  if (!online()) return 'device'
  try {
    const res = await apiFetch('/api/site', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(site) })
    if (res.ok) {
      localStorage.removeItem(UNSYNCED_KEY)
      return 'server'
    }
  } catch {
    // Fall through: remember to retry.
  }
  // Remember to retry, so the next sync uploads this edit before reading the server copy.
  localStorage.setItem(UNSYNCED_KEY, '1')
  return 'device'
}

/** What "Set up with AI" extracted from a description: every field optional, nothing applied yet */
export interface SetupDraft {
  organization?: string | null
  buildingName?: string | null
  city?: string | null
  currency?: string | null
  tariffPerKwh?: number | null
  hours?: { from: number; to: number; days: number[] } | null
  floors?: { level: number; name: string; building?: string | null }[] | null
  rooms?:
    | {
        id: string
        name: string
        floor: number
        type: RoomType
        capacity?: number | null
        areaM2?: number | null
        windows?: boolean | null
        lights?: number | null
        fans?: number | null
        acs?: number | null
        projectors?: number | null
        pcs?: number | null
      }[]
    | null
}

const CEILING_M = 3.2

/**
 * Fill a setup form from an AI draft. Code builds the rooms and devices; the draft only names them.
 * Existing rooms keep their device ids, ratings and camera zones where counts stay the same.
 * A new room gets only the devices the description named; seats and area it did not give come from the
 * room template and are listed in `assumed`, so the person checks them before saving.
 */
export function applySetupDraft(site: Site, d: SetupDraft): { site: Site; assumed: string[] } {
  /** Rooms that took seats or area from a template, grouped by template */
  const fromTemplate = new Map<RoomType, { seats: string[]; area: string[] }>()
  const note = (type: RoomType, field: 'seats' | 'area', id: string) => {
    const g = fromTemplate.get(type) ?? { seats: [], area: [] }
    g[field].push(id)
    fromTemplate.set(type, g)
  }
  const next: Site = { ...site, floors: [...site.floors], rooms: [...site.rooms] }
  if (d.organization) next.organization = d.organization.slice(0, 80)
  if (d.buildingName) next.buildingName = d.buildingName.slice(0, 80)
  if (d.currency && /^[A-Z]{3}$/.test(d.currency)) next.currency = d.currency
  if (d.tariffPerKwh != null && d.tariffPerKwh >= 0) next.tariffPerKwh = d.tariffPerKwh
  if (d.hours && d.hours.to > d.hours.from) next.hours = { from: d.hours.from, to: d.hours.to, days: [...new Set(d.hours.days)].sort() }
  for (const f of d.floors ?? []) {
    const i = next.floors.findIndex((x) => x.level === f.level)
    const floor = { level: f.level, name: f.name, ...(f.building ? { building: f.building } : {}) }
    if (i >= 0) next.floors[i] = floor
    else next.floors.push(floor)
  }
  for (const r of d.rooms ?? []) {
    if (!next.floors.some((f) => f.level === r.floor)) next.floors.push({ level: r.floor, name: r.floor === 0 ? 'Ground floor' : `Floor ${r.floor}` })
    const t = ROOM_TEMPLATES[r.type]
    const old = next.rooms.find((x) => x.id === r.id)
    const named: DeviceCounts = Object.fromEntries(
      ([['light', r.lights], ['fan', r.fans], ['ac', r.acs], ['projector', r.projectors], ['pc', r.pcs]] as [DeviceType, number | null | undefined][]).filter(([, n]) => n != null),
    )
    const counts = old ? { ...deviceCounts(old), ...named } : named
    const ratings = old ? Object.fromEntries(old.devices.map((x) => [x.type, x.ratedW])) : {}
    const fresh = makeDevices(r.id, counts, ratings)
    const devices = old ? fresh.map((x) => old.devices.find((o) => o.id === x.id) ?? x) : fresh
    if (!old && r.capacity == null) note(r.type, 'seats', r.id)
    if (!old && r.areaM2 == null) note(r.type, 'area', r.id)
    const areaM2 = r.areaM2 ?? old?.areaM2 ?? t.areaM2
    const room: Room = {
      ...(old ?? { windowSide: true, polygon: undefined }),
      id: r.id,
      name: r.name.slice(0, 60),
      floor: r.floor,
      type: r.type,
      capacity: Math.max(1, Math.round(r.capacity ?? old?.capacity ?? t.capacity)),
      areaM2,
      volumeM3: r.areaM2 != null || !old ? areaM2 * CEILING_M : old.volumeM3,
      windowSide: r.windows ?? old?.windowSide ?? true,
      devices,
    }
    if (old) next.rooms[next.rooms.indexOf(old)] = room
    else next.rooms.push(room)
  }
  next.floors.sort((a, b) => a.level - b.level)
  const assumed = [...fromTemplate].flatMap(([type, g]) => {
    const t = ROOM_TEMPLATES[type]
    const each = (ids: string[]) => (ids.length > 1 ? ' each' : '')
    return [
      ...(g.seats.length ? [`seats for ${g.seats.join(', ')} (${t.capacity}${each(g.seats)}, ${t.label.toLowerCase()} template)`] : []),
      ...(g.area.length ? [`area for ${g.area.join(', ')} (${t.areaM2} m²${each(g.area)}, ${t.label.toLowerCase()} template)`] : []),
    ]
  })
  return { site: next, assumed }
}
