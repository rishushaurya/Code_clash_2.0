// The live twin. One store, one tick every 2 s:
// cameras + sensors + staff reports -> room state -> energy, CO2, status -> alerts -> AI cards -> commands.
// Only observed inputs count: a device nobody observes draws nothing here, a room nobody watches is "unknown".

import { toast } from 'sonner'
import { create } from 'zustand'
import { logCommand, recommend, sendTelegramAlert } from '@/ai/client'
import { setRelay } from '@/relay/webSerial'
import { AI_COOLDOWN_S, CO2_OUTDOOR_PPM, DEFAULT_RUNS, SENSOR_FRESH_MS, TICK_MS, VERIFY_WINDOW_MS, WASTE_MIN_W } from '@/shared/config'
import { getRoom, getSite, syncSiteFromServer, useSite } from '@/shared/site'
import { every } from '@/shared/timer'
import { authHeaders, online } from '@/shared/workspace'
import type {
  Alert,
  Command,
  CommandAck,
  CommandTarget,
  CvReading,
  DeviceType,
  Recommendation,
  Room,
  RoomState,
  SensorReading,
  Snapshot,
  TwinEvent,
} from '@/shared/types'
import { compareScenario } from '@/sim/engine'
import { stepCo2 } from './co2'
import { co2KgFrom, costFrom, kwhFrom, roomWatts } from './energy'
import { mergeReadings } from './merge'
import { on, send } from './realtime'
import { alertTypesFor, factsFor, type RuleContext } from './rules'
import { recordUsage } from './usage'

type RecState = Recommendation | 'loading'

interface Override {
  targets: DeviceType[]
  /** Load when the command was given: the saving is measured against it once devices are seen off */
  wattsAtCommand: number
  commandId: string
  ts: number
}

interface Observed {
  on: boolean
  ts: number
  source: string
}

/** Latest non-camera inputs per room */
interface SensorState {
  occupancy?: { value: number; ts: number }
  power?: { watts: number; ts: number }
  air?: { co2ppm?: number; temperatureC?: number; humidity?: number; ts: number }
  byId: Record<string, Observed>
  byType: Partial<Record<DeviceType, Observed>>
}

export interface TwinState {
  started: boolean
  t0: number
  rooms: Record<string, RoomState>
  readings: Record<string, CvReading>
  /** Latest public 'lights left on' report per room */
  tips: Record<string, number>
  sensors: Record<string, SensorState>
  recentReadings: CvReading[]
  alerts: Alert[]
  recs: Record<string, RecState>
  events: TwinEvent[]
  overrides: Record<string, Override>
  acks: Record<string, CommandAck>
  co2History: Record<string, number[]>
  /** One snapshot every 10 s for the last hour, for the time-travel slider */
  history: Snapshot[]
  savedCost: number
  autoOffSaving: Record<string, number>
  consolidateSaving: Record<string, number>
  cloudCover: number | null
  outdoorAqi: number | null
  outdoorTempC: number | null
  start: () => void
  ingestReading: (r: CvReading) => void
  ingestSensor: (r: SensorReading) => void
  /** Staff confirm what they see in the room; also how a switch-off is confirmed without sensors */
  reportDevices: (roomId: string, target: CommandTarget, on: boolean) => void
  /** Recompute the what-if savings after rooms or devices change */
  siteChanged: () => void
  applyCommand: (cmd: Command) => Promise<void>
  switchOff: (roomId: string, target: CommandTarget, origin?: Command['origin']) => Promise<void>
}

const TARGET_TYPES: Record<CommandTarget, DeviceType[]> = {
  lights: ['light'],
  fans: ['fan'],
  all: ['light', 'fan', 'ac', 'projector', 'pc'],
}

const SEED = 42
const HISTORY_EVERY_MS = 10_000
const HISTORY_SIZE = 360
const TELEGRAM_COOLDOWN_MS = 60_000
const TIP_WINDOW_MS = 10 * 60_000
/** A camera silent this long raises an alert; older than an hour it is treated as removed, not broken */
const CAMERA_SILENT_MS = 60_000
const CAMERA_FORGOTTEN_MS = 60 * 60_000
const lastAiCall = new Map<string, { ts: number; rec: Recommendation }>()
const lastTelegram = new Map<string, number>()
const id = () => crypto.randomUUID()

export const minuteOfDay = (t: number) => {
  const d = new Date(t)
  return d.getHours() * 60 + d.getMinutes()
}

/** Messages arrive over a public channel: check the shape before they touch the twin. */
const validReading = (r: CvReading) =>
  typeof r?.roomId === 'string' && Number.isFinite(r.headcount) && r.headcount >= 0 && r.headcount < 2000 && typeof r.zones === 'object' && Number.isFinite(r.ts)
const validSensor = (r: SensorReading) =>
  typeof r?.roomId === 'string' &&
  typeof r.source === 'string' &&
  Number.isFinite(r.ts) &&
  (r.occupancy === undefined || (Number.isFinite(r.occupancy) && r.occupancy >= 0)) &&
  (r.powerW === undefined || (Number.isFinite(r.powerW) && r.powerW >= 0)) &&
  (r.co2ppm === undefined || (Number.isFinite(r.co2ppm) && r.co2ppm > 0 && r.co2ppm < 10_000)) &&
  (r.devices === undefined || Array.isArray(r.devices))

function initialState(room: Room, now: number): RoomState {
  return {
    roomId: room.id,
    headcount: 0,
    occupancyKnown: false,
    occupied: false,
    emptySince: null,
    deviceOn: {},
    watts: 0,
    metered: false,
    co2ppm: CO2_OUTDOOR_PPM,
    co2Measured: false,
    status: 'unknown',
    sources: [],
    zones: {},
    kwh: 0,
    cost: 0,
    co2Kg: 0,
    wasteCost: 0,
    updatedAt: now,
  }
}

const event = (kind: TwinEvent['kind'], roomId: string | null, text: string): TwinEvent => ({ id: id(), ts: Date.now(), roomId, kind, text })

/** Events waiting to be stored on the server (the audit trail); kept across failed uploads */
let unsent: TwinEvent[] = []

export const useTwin = create<TwinState>((set, get) => {
  const log = (e: TwinEvent) => {
    set((s) => ({ events: [e, ...s.events].slice(0, 500) }))
    unsent = [...unsent, e].slice(-1000)
  }

  async function flushEvents() {
    if (!online() || !unsent.length) return
    const batch = unsent.slice(0, 200)
    try {
      const res = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ events: batch }) })
      if (res.ok) unsent = unsent.slice(batch.length)
    } catch {
      // Offline: try again next round.
    }
  }

  function nextRoom(room: Room, prev: RoomState, now: number, dt: number) {
    const s = get()
    const site = getSite()
    const view = mergeReadings(room, Object.values(s.readings), now)
    const sensor = s.sensors[room.id]
    const sources = new Set<RoomState['sources'][number]>()

    let headcount = 0
    let occupancyKnown = false
    if (view) {
      headcount = view.headcount
      occupancyKnown = true
      sources.add('camera')
    } else if (sensor?.occupancy && now - sensor.occupancy.ts < SENSOR_FRESH_MS) {
      headcount = sensor.occupancy.value
      occupancyKnown = true
      sources.add('sensor')
    }

    // Device states, most specific observation first.
    const deviceOn: Record<string, boolean> = {}
    const seenBy: Record<string, 'camera' | 'sensor' | 'manual'> = {}
    for (const d of room.devices) {
      const byId = sensor?.byId[d.id]
      const camera = view && d.zone ? view.zones[d.zone] : undefined
      const byType = sensor?.byType[d.type]
      const pick = byId ?? (camera !== undefined ? { on: camera, source: 'camera' } : byType)
      if (!pick) continue
      deviceOn[d.id] = pick.on
      seenBy[d.id] = pick.source === 'camera' ? 'camera' : pick.source === 'manual' ? 'manual' : 'sensor'
      sources.add(seenBy[d.id])
    }

    const metered = Boolean(sensor?.power && now - sensor.power.ts < SENSOR_FRESH_MS)
    const watts = metered ? sensor!.power!.watts : roomWatts(room, deviceOn)
    const emptySince = !occupancyKnown || headcount > 0 ? null : (prev.emptySince ?? now)
    const occupied = occupancyKnown && (headcount > 0 || (emptySince !== null && now - emptySince < site.emptyDelayS * 1000))
    const status: RoomState['status'] = !occupancyKnown ? 'unknown' : occupied ? 'occupied' : watts > WASTE_MIN_W ? 'waste' : 'idle'

    const air = sensor?.air && now - sensor.air.ts < SENSOR_FRESH_MS ? sensor.air : undefined
    const override = s.overrides[room.id]
    const kwh = kwhFrom(watts, dt)
    const savedCost = override ? costFrom(kwhFrom(Math.max(0, override.wattsAtCommand - watts), dt)) : 0

    const next: RoomState = {
      roomId: room.id,
      headcount,
      occupancyKnown,
      occupied,
      emptySince,
      deviceOn,
      watts,
      metered,
      co2ppm: air?.co2ppm ?? (occupancyKnown ? stepCo2(prev.co2ppm, headcount, room.volumeM3, dt) : prev.co2ppm),
      co2Measured: air?.co2ppm !== undefined,
      temperatureC: air?.temperatureC,
      humidity: air?.humidity,
      status,
      sources: [...sources],
      zones: view?.zones ?? {},
      kwh: prev.kwh + kwh,
      cost: prev.cost + costFrom(kwh),
      co2Kg: prev.co2Kg + co2KgFrom(kwh),
      wasteCost: prev.wasteCost + (status === 'waste' ? costFrom(kwh) : 0),
      updatedAt: now,
    }
    return { next, savedCost, seenBy }
  }

  async function onNewAlert(alert: Alert) {
    log(event('alert', alert.roomId, `${alert.roomId}: ${alert.type.replaceAll('_', ' ')}`))
    if (alert.type === 'empty_with_load' && Date.now() - (lastTelegram.get(alert.roomId) ?? 0) > TELEGRAM_COOLDOWN_MS) {
      lastTelegram.set(alert.roomId, Date.now())
      void sendTelegramAlert(alert.facts, id())
    }
    // Free-tier quota: at most one AI call per room and alert type per cooldown; reuse the last card inside it.
    const key = `${alert.roomId}:${alert.type}`
    const last = lastAiCall.get(key)
    if (last && Date.now() - last.ts < AI_COOLDOWN_S * 1000) {
      set((st) => ({ recs: { ...st.recs, [alert.id]: last.rec } }))
      return
    }
    set((st) => ({ recs: { ...st.recs, [alert.id]: 'loading' } }))
    const rec = await recommend(alert.facts)
    lastAiCall.set(key, { ts: Date.now(), rec })
    set((st) => ({ recs: { ...st.recs, [alert.id]: rec } }))
    log(event('recommendation', alert.roomId, rec.title))
  }

  function tick() {
    const s = get()
    const site = getSite()
    const now = Date.now()
    const dt = TICK_MS / 1000
    const rooms: Record<string, RoomState> = {}
    let saved = 0
    const overrides = { ...s.overrides }
    const acks = { ...s.acks }
    const sensors = { ...s.sensors }

    for (const room of site.rooms) {
      const prev = s.rooms[room.id] ?? initialState(room, now)
      const { next, savedCost, seenBy } = nextRoom(room, prev, now, dt)
      rooms[room.id] = next
      saved += savedCost
      if (prev.status !== next.status && s.rooms[room.id]) log(event('status', room.id, `${room.id} is now ${next.status}`))

      // People are back: they switch things on again, so drop staff reports and release the hold.
      if (next.headcount > 0 && prev.headcount === 0) {
        const sn = sensors[room.id]
        if (sn) {
          sensors[room.id] = {
            ...sn,
            byId: Object.fromEntries(Object.entries(sn.byId).filter(([, o]) => o.source !== 'manual')),
            byType: Object.fromEntries(Object.entries(sn.byType).filter(([, o]) => o?.source !== 'manual')),
          }
        }
      }
      const o = overrides[room.id]
      if (o && next.headcount > 0) {
        delete overrides[room.id]
        if (room.hasRealRelay) void setRelay(true)
      } else if (o && !acks[o.commandId]?.verifiedBy) {
        // Confirmed once every observed target device is seen off.
        const targeted = room.devices.filter((d) => o.targets.includes(d.type) && next.deviceOn[d.id] !== undefined)
        if (targeted.length && targeted.every((d) => !next.deviceOn[d.id])) {
          // Credit whoever actually saw the targeted devices go off.
          const by = targeted.some((d) => seenBy[d.id] === 'camera') ? 'camera' : targeted.some((d) => seenBy[d.id] === 'sensor') ? 'sensor' : 'manual'
          acks[o.commandId] = { ...acks[o.commandId], verifiedBy: by, ts: now }
          send('ack', acks[o.commandId])
          log(event('ack', room.id, `${room.id}: switch-off confirmed by ${by === 'manual' ? 'staff' : by}`))
          toast.success(`${room.id}: switch-off confirmed by ${by === 'manual' ? 'staff' : by}`)
        } else if (room.hasRealRelay && now - o.ts > VERIFY_WINDOW_MS && now - o.ts <= VERIFY_WINDOW_MS + TICK_MS) {
          log(event('ack', room.id, `${room.id}: the camera has not seen the lights go off yet`))
        }
      }
    }

    const ctx: RuleContext = {
      now,
      minuteOfDay: minuteOfDay(now),
      currency: site.currency,
      cloudCover: s.cloudCover,
      outdoorTempC: s.outdoorTempC,
      autoOffSaving: s.autoOffSaving,
      consolidateSaving: s.consolidateSaving,
    }
    const alerts: Alert[] = []
    const fresh: Alert[] = []
    for (const room of site.rooms) {
      // A visitor's report raises a check for 10 minutes unless a camera or sensor shows people in the room.
      const tipped = now - (s.tips[room.id] ?? 0) < TIP_WINDOW_MS && !rooms[room.id].occupied
      const lastCamera = Math.max(0, ...Object.values(s.readings).filter((r) => r.roomId === room.id).map((r) => r.ts))
      const cameraSilent = lastCamera > 0 && now - lastCamera > CAMERA_SILENT_MS && now - lastCamera < CAMERA_FORGOTTEN_MS
      const extra = [...(tipped ? (['reported'] as const) : []), ...(cameraSilent ? (['camera_offline'] as const) : [])]
      for (const type of [...alertTypesFor(room, rooms[room.id], ctx), ...extra]) {
        const existing = s.alerts.find((a) => a.roomId === room.id && a.type === type)
        const facts = factsFor(room, rooms[room.id], type, ctx, site.rooms)
        if (s.outdoorAqi !== null && (type === 'co2_high' || type === 'ac_mild_weather')) facts.outdoorAqi = s.outdoorAqi
        if (type === 'camera_offline') facts.minutesSinceCamera = Math.round((now - lastCamera) / 60000)
        const alert = existing ? { ...existing, facts } : { id: id(), roomId: room.id, type, since: now, facts }
        alerts.push(alert)
        if (!existing) fresh.push(alert)
      }
    }

    // Auto switch-off (Setup): a watched room empty with power on for the set minutes gets the command once,
    // until people come back. The saving still counts only when the devices are seen off.
    // Sent after this tick saves its state (below), so the new hold is not overwritten.
    const autoOff = site.autoOff.enabled
      ? Object.values(rooms).filter(
          (r) => r.status === 'waste' && !overrides[r.roomId] && !getRoom(r.roomId)?.autoOffExempt && r.emptySince !== null && now - r.emptySince >= site.emptyDelayS * 1000 + site.autoOff.minutes * 60_000,
        )
      : []

    const list = Object.values(rooms)
    const snapshot: Snapshot = {
      ts: now,
      layout: {
        buildingName: site.buildingName,
        currency: site.currency,
        floors: site.floors,
        rooms: site.rooms.map(({ id, name, floor, capacity, polygon }) => ({ id, name, floor, capacity, polygon })),
      },
      rooms: list,
      totals: {
        watts: list.reduce((a, r) => a + r.watts, 0),
        costPerHour: (list.reduce((a, r) => a + r.watts, 0) / 1000) * site.tariffPerKwh,
        kwh: list.reduce((a, r) => a + r.kwh, 0),
        co2Kg: list.reduce((a, r) => a + r.co2Kg, 0),
        wasteCost: list.reduce((a, r) => a + r.wasteCost, 0),
        savedCost: s.savedCost + saved,
      },
    }
    const co2History = { ...s.co2History }
    for (const r of list) if (r.occupancyKnown || r.co2Measured) co2History[r.roomId] = [...(co2History[r.roomId] ?? []), r.co2ppm].slice(-90)
    const history = now - (s.history.at(-1)?.ts ?? 0) >= HISTORY_EVERY_MS ? [...s.history, snapshot].slice(-HISTORY_SIZE) : s.history
    recordUsage(list, site.rooms, now)

    set({ rooms, alerts, savedCost: snapshot.totals.savedCost, acks, overrides, sensors, co2History, history })
    fresh.forEach((a) => void onNewAlert(a))
    autoOff.forEach((r) => void get().switchOff(r.roomId, 'all', 'policy'))
    send('snapshot', snapshot)
  }

  async function loadOutdoor() {
    const loc = getSite().location
    if (!loc) return set({ cloudCover: null, outdoorAqi: null, outdoorTempC: null })
    try {
      const [w, a] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=cloud_cover,temperature_2m`).then((r) => r.json()),
        fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=us_aqi`).then((r) => r.json()),
      ])
      set({ cloudCover: w.current?.cloud_cover ?? null, outdoorTempC: w.current?.temperature_2m ?? null, outdoorAqi: a.current?.us_aqi ?? null })
    } catch {
      // Offline: daylight advice assumes a clear sky; ventilation advice assumes outdoor air is fine.
    }
  }

  function estimateSavings() {
    const site = getSite()
    if (!site.rooms.length) return set({ autoOffSaving: {}, consolidateSaving: {} })
    // seniordev: per-room saving is the difference of medians, not the median of differences; fine for a card.
    const perRoom = (policy: 'auto_off' | 'consolidate') => {
      const c = compareScenario({ policy, params: { emptyMinutes: 5 }, days: 7, runs: DEFAULT_RUNS, seed: SEED }, site.rooms)
      const out: Record<string, number> = {}
      c.baseline.perRoom.forEach((b, i) => {
        const kwh = (b.kwhP50 - c.policy.perRoom[i].kwhP50) * (30 / 7)
        if (kwh > 0) out[b.roomId] = kwh * site.tariffPerKwh
      })
      return out
    }
    set({ autoOffSaving: perRoom('auto_off'), consolidateSaving: perRoom('consolidate') })
  }

  return {
    started: false,
    t0: Date.now(),
    rooms: {},
    readings: {},
    tips: {},
    sensors: {},
    recentReadings: [],
    alerts: [],
    recs: {},
    events: [],
    overrides: {},
    acks: {},
    co2History: {},
    history: [],
    savedCost: 0,
    autoOffSaving: {},
    consolidateSaving: {},
    cloudCover: null,
    outdoorAqi: null,
    outdoorTempC: null,

    start() {
      if (get().started) return
      set({ started: true, t0: Date.now() })
      on('reading', (r) => validReading(r) && get().ingestReading(r))
      on('sensor', (r) => validSensor(r) && get().ingestSensor(r))
      on('tip', (t) => {
        if (typeof t?.roomId !== 'string' || !getRoom(t.roomId)) return
        set((s) => ({ tips: { ...s.tips, [t.roomId]: Date.now() } }))
        log(event('alert', t.roomId, `${t.roomId}: a visitor reported lights left on`))
      })
      on('command', (cmd) => void get().applyCommand(cmd))
      // Setup saved on another device: take the new rooms and settings.
      on('site', () => void syncSiteFromServer())
      // Location or rooms changed in setup: refresh weather and what-if savings.
      useSite.subscribe((st, prev) => {
        if (st.site.location !== prev.site.location) void loadOutdoor()
        if (st.site.rooms !== prev.site.rooms || st.site.leftOnProbability !== prev.site.leftOnProbability) get().siteChanged()
      })
      setTimeout(estimateSavings, 300)
      void loadOutdoor()
      setInterval(() => void flushEvents(), 30_000)
      setInterval(() => void loadOutdoor(), 30 * 60_000) // weather moves slowly; Open-Meteo updates about every 15 minutes
      tick()
      // On a worker timer: the twin keeps ticking while its tab is in the background.
      every(TICK_MS, tick)
    },

    ingestReading(r) {
      if (!getRoom(r.roomId)) return
      set((s) => ({ readings: { ...s.readings, [r.cameraId]: r }, recentReadings: [r, ...s.recentReadings].slice(0, 10) }))
    },

    ingestSensor(r) {
      if (!getRoom(r.roomId)) return
      set((s) => {
        const prev = s.sensors[r.roomId] ?? { byId: {}, byType: {} }
        const next: SensorState = { ...prev, byId: { ...prev.byId }, byType: { ...prev.byType } }
        if (r.occupancy !== undefined) next.occupancy = { value: r.occupancy, ts: r.ts }
        if (r.powerW !== undefined) next.power = { watts: r.powerW, ts: r.ts }
        if (r.co2ppm !== undefined || r.temperatureC !== undefined || r.humidity !== undefined)
          next.air = { ...next.air, ...(r.co2ppm !== undefined && { co2ppm: r.co2ppm }), ...(r.temperatureC !== undefined && { temperatureC: r.temperatureC }), ...(r.humidity !== undefined && { humidity: r.humidity }), ts: r.ts }
        for (const d of r.devices ?? []) {
          const obs = { on: d.on, ts: r.ts, source: r.source }
          if (d.id) next.byId[d.id] = obs
          else if (d.type) next.byType[d.type] = obs
        }
        return { sensors: { ...s.sensors, [r.roomId]: next } }
      })
    },

    reportDevices(roomId, target, isOn) {
      const reading: SensorReading = { roomId, source: 'manual', ts: Date.now(), devices: TARGET_TYPES[target].map((type) => ({ type, on: isOn })) }
      get().ingestSensor(reading)
      send('sensor', reading)
      log(event('status', roomId, `${roomId}: staff reported ${target} ${isOn ? 'on' : 'off'}`))
    },

    siteChanged() {
      estimateSavings()
    },

    async applyCommand(cmd) {
      if (get().acks[cmd.id]) return
      const room = getRoom(cmd.roomId)
      if (!room || cmd.state !== 'off') return
      const lightsTargeted = cmd.target !== 'fans'
      const relay = room.hasRealRelay && lightsTargeted ? await setRelay(false) : 'none'
      const ack: CommandAck = { commandId: cmd.id, roomId: cmd.roomId, relay, verifiedBy: null, ts: Date.now() }
      set((s) => ({
        overrides: {
          ...s.overrides,
          [cmd.roomId]: { targets: TARGET_TYPES[cmd.target], wattsAtCommand: s.rooms[cmd.roomId]?.watts ?? 0, commandId: cmd.id, ts: Date.now() },
        },
        acks: { ...s.acks, [cmd.id]: ack },
      }))
      log(event('command', cmd.roomId, `${cmd.roomId}: switch off ${cmd.target} (${cmd.origin})`))
      send('ack', ack)
      toast(`${cmd.roomId}: switch off ${cmd.target}`, {
        description:
          relay === 'real' ? 'Relay switched. Waiting for the camera to confirm.' : 'Instruction sent to your integrations. Waiting for a camera, sensor or staff to confirm.',
      })
    },

    async switchOff(roomId, target, origin = 'ui') {
      const cmd: Command = { id: id(), ts: Date.now(), roomId, target, state: 'off', origin }
      await get().applyCommand(cmd)
      void logCommand(cmd)
    },
  }
})

/** Snapshot receiver for screens that are not the twin (public view), with the last 3 minutes of building power. */
export const useSnapshot = create<{ snapshot: Snapshot | null; watts: number[] }>(() => ({ snapshot: null, watts: [] }))
on('snapshot', (snapshot) => useSnapshot.setState((s) => ({ snapshot, watts: [...s.watts, snapshot.totals.watts].slice(-90) })))
