// POST /api/tick  (Authorization: Bearer <CRON_SECRET>)  The twin, every minute, with no browser open.
// Supabase pg_cron calls it through pg_net (supabase/schema.sql). For every workspace with recent inputs or a
// connected smart plug or Home Assistant, it:
//   reads the plugs and Home Assistant, works out every room with the same code as the browser (compute.ts),
//   raises alerts into the event log, sends the Telegram alert, issues automatic switch-offs, adds to the
//   hourly roll-up, and stores the state for browsers that open later (/api/state).
// It also records a heartbeat, so /api/status tells browsers to leave Telegram and auto-off to the server.

import { randomUUID } from 'node:crypto'
import type { Alert, AlertType, Command, CvReading, DeviceType, RoomState, Site } from '../../src/shared/types'
import { applySensor, computeRoom, dropManual, initialRoomState, kwhFrom, type SensorState } from '../../src/twin/compute.js'
import { alertTypesFor, factsFor, type RuleContext } from '../../src/twin/rules.js'
import { readDoc, rest, rows, supabase, upsert } from '../_lib/db.js'
import { broadcast, json, logEvent, logJson, safeEqual, storageError } from '../_lib/http.js'
import { workspaceKeys } from '../_lib/keys.js'
import { sendAlert } from './alert.js'
import { dispatchCommand, pollConnections, readConnections } from './connections.js'
import { sensorKey, storeSensors, type InputRow } from './reading.js'

/** Cameras post every 10 s; a reading up to 30 s old still counts on the server */
const CAMERA_FRESH_MS = 30_000
/** Workspaces whose inputs are older than this are left alone */
const ACTIVE_MS = 60 * 60_000
/** A missed tick never adds more than this much energy at once */
const MAX_DT_S = 120
const CAMERA_SILENT_MS = 60_000
const CAMERA_FORGOTTEN_MS = 60 * 60_000
const WEATHER_EVERY_MS = 30 * 60_000
const ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

interface Hour {
  kwh: number
  cost: number
  wasteKwh: number
  wasteCost: number
  occupiedS: number
  observedS: number
}

/** What the server keeps per workspace in twin_state */
export interface ServerTwin {
  ts: number
  rooms: Record<string, RoomState>
  /** Open alerts; a new one is logged and sent once, until it clears */
  alerts: Alert[]
  /** Switch-offs the server sent, held until people come back; the saving counts only as devices are seen off */
  overrides: Record<string, { commandId: string; wattsAtCommand: number; targets: DeviceType[]; ts: number }>
  savedCost: number
  outdoor?: { ts: number; cloudCover: number | null; outdoorTempC: number | null; utcOffsetS: number }
  hour?: { start: number; rooms: Record<string, Hour> }
}

const TARGET_TYPES: DeviceType[] = ['light', 'fan', 'ac', 'projector', 'pc']

async function outdoor(site: Site, prev: ServerTwin['outdoor'], now: number): Promise<ServerTwin['outdoor']> {
  if (!site.location) return undefined
  if (prev && now - prev.ts < WEATHER_EVERY_MS) return prev
  try {
    const { lat, lon } = site.location
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=cloud_cover,temperature_2m&timezone=auto`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json())
    return { ts: now, cloudCover: w.current?.cloud_cover ?? null, outdoorTempC: w.current?.temperature_2m ?? null, utcOffsetS: w.utc_offset_seconds ?? 0 }
  } catch {
    // Weather offline: keep the last values; the daylight rule then assumes a clear sky, as in the browser.
    return prev
  }
}

/** One workspace, one minute. Exported for the tests. */
export async function tickWorkspace(workspace: string, inputs: InputRow[], now: number) {
  const doc = await readDoc(workspace, 'site')
  if (!doc || doc === 'unavailable') return { workspace, skipped: doc === 'unavailable' ? 'storage' : 'no site' }
  const site = doc.value as Site
  if (!Array.isArray(site.rooms) || !site.rooms.length) return { workspace, skipped: 'no rooms' }
  const stored = await rows<{ state: ServerTwin }>(`twin_state?workspace=eq.${workspace}&select=state`)
  const prev: ServerTwin = stored?.[0]?.state ?? { ts: now, rooms: {}, alerts: [], overrides: {}, savedCost: 0 }

  // Smart plugs and Home Assistant: read now, stored and sent to open twins like any sensor.
  const [conn, keys] = await Promise.all([readConnections(workspace), workspaceKeys(workspace)])
  const polled = await pollConnections(conn, keys, now).catch(() => [])
  if (polled.length) await Promise.all([storeSensors(workspace, polled), ...polled.map((r) => broadcast(workspace, 'sensor', r))])

  const cameras = inputs.filter((r) => r.kind === 'camera').map((r) => ({ ...(r.reading as CvReading), ts: Date.parse(r.ts) }))
  const sensors: Record<string, SensorState> = Object.fromEntries(inputs.filter((r) => r.kind === 'sensor').map((r) => [r.room_id, r.reading as SensorState]))
  for (const r of polled) sensors[r.roomId] = applySensor(sensors[r.roomId], r)

  const dt = Math.min(MAX_DT_S, Math.max(0, (now - prev.ts) / 1000))
  const rooms: Record<string, RoomState> = {}
  const overrides = { ...prev.overrides }
  let saved = 0
  for (const room of site.rooms) {
    const p = prev.rooms[room.id] ?? initialRoomState(room, now)
    const next = computeRoom(room, p, { readings: cameras, sensor: sensors[room.id], cameraFreshMs: CAMERA_FRESH_MS }, site, now, dt)
    rooms[room.id] = next
    // People are back: staff reports stop counting, and the switch-off hold is released.
    if (next.headcount > 0 && p.headcount === 0) {
      const sn = sensors[room.id]
      if (sn && Object.values({ ...sn.byId, ...sn.byType }).some((o) => o?.source === 'manual'))
        await upsert('room_inputs', { workspace, key: sensorKey(room.id), room_id: room.id, kind: 'sensor', reading: dropManual(sn), ts: new Date(now).toISOString() })
      delete overrides[room.id]
    }
    const o = overrides[room.id]
    if (o) saved += kwhFrom(Math.max(0, o.wattsAtCommand - next.watts), dt) * site.tariffPerKwh
  }

  const weather = await outdoor(site, prev.outdoor, now)
  const local = new Date(now + (weather?.utcOffsetS ?? 0) * 1000)
  const ctx: RuleContext = {
    now,
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
    currency: site.currency,
    tariffPerKwh: site.tariffPerKwh,
    cloudCover: weather?.cloudCover ?? null,
    outdoorTempC: weather?.outdoorTempC ?? null,
    autoOffSaving: {},
    consolidateSaving: {},
  }
  const alerts: Alert[] = []
  const fresh: Alert[] = []
  for (const room of site.rooms) {
    const lastCamera = Math.max(0, ...cameras.filter((r) => r.roomId === room.id).map((r) => r.ts))
    const silent = lastCamera > 0 && now - lastCamera > CAMERA_SILENT_MS && now - lastCamera < CAMERA_FORGOTTEN_MS
    const types: AlertType[] = [...alertTypesFor(room, rooms[room.id], ctx), ...(silent ? (['camera_offline'] as const) : [])]
    for (const type of types) {
      const facts = factsFor(room, rooms[room.id], type, ctx, site.rooms)
      if (type === 'camera_offline') facts.minutesSinceCamera = Math.round((now - lastCamera) / 60000)
      const existing = prev.alerts.find((a) => a.roomId === room.id && a.type === type)
      const alert: Alert = existing ? { ...existing, facts } : { id: randomUUID(), roomId: room.id, type, since: now, facts }
      alerts.push(alert)
      if (!existing) fresh.push(alert)
    }
  }

  // Automatic switch-off, as in the browser: once per empty spell, after the empty delay plus the set minutes.
  const autoOff = site.autoOff?.enabled
    ? Object.values(rooms).filter(
        (r) =>
          r.status === 'waste' &&
          !overrides[r.roomId] &&
          !site.rooms.find((x) => x.id === r.roomId)?.autoOffExempt &&
          r.emptySince !== null &&
          now - r.emptySince >= site.emptyDelayS * 1000 + site.autoOff.minutes * 60_000,
      )
    : []
  const commands: Command[] = autoOff.map((r) => ({ id: randomUUID(), ts: now, roomId: r.roomId, target: 'all', state: 'off', origin: 'policy' }))
  for (const cmd of commands) overrides[cmd.roomId] = { commandId: cmd.id, wattsAtCommand: rooms[cmd.roomId].watts, targets: TARGET_TYPES, ts: now }

  // Hourly roll-up per room (UTC hours), kept in the state and written whole each minute, so a retry is harmless.
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000
  const hour = prev.hour?.start === hourStart ? { start: hourStart, rooms: { ...prev.hour.rooms } } : { start: hourStart, rooms: {} as Record<string, Hour> }
  for (const [id, r] of Object.entries(rooms)) {
    const p = prev.rooms[id]
    const kwh = p ? r.kwh - p.kwh : 0
    const cost = p ? r.cost - p.cost : 0
    const h = hour.rooms[id] ?? { kwh: 0, cost: 0, wasteKwh: 0, wasteCost: 0, occupiedS: 0, observedS: 0 }
    hour.rooms[id] = {
      kwh: h.kwh + kwh,
      cost: h.cost + cost,
      wasteKwh: h.wasteKwh + (r.status === 'waste' ? kwh : 0),
      wasteCost: h.wasteCost + (r.status === 'waste' ? cost : 0),
      occupiedS: h.occupiedS + (r.occupied ? dt : 0),
      observedS: h.observedS + (r.occupancyKnown ? dt : 0),
    }
  }
  const hourly = Object.entries(hour.rooms)
    .filter(([, h]) => h.observedS > 0 || h.kwh > 0)
    .map(([room_id, h]) => ({
      workspace,
      room_id,
      hour: new Date(hourStart).toISOString(),
      kwh: h.kwh,
      cost: h.cost,
      waste_kwh: h.wasteKwh,
      waste_cost: h.wasteCost,
      occupied_minutes: Math.round(h.occupiedS / 60),
      observed_minutes: Math.round(h.observedS / 60),
    }))

  const state: ServerTwin = { ts: now, rooms, alerts, overrides, savedCost: prev.savedCost + saved, outdoor: weather, hour }
  const [savedState] = await Promise.all([
    upsert('twin_state', { workspace, state, updated_at: new Date(now).toISOString() }),
    hourly.length ? upsert('room_hourly', hourly) : null,
  ])

  // Effects after the state is saved, so a failure here never repeats them next minute.
  const languages = site.alertLanguages?.length ? site.alertLanguages : undefined
  let telegram = 0
  for (const a of fresh) {
    await logEvent(workspace, a.roomId, 'alert', { text: `${a.roomId}: ${a.type.replaceAll('_', ' ')}`, by: 'server' })
    if (a.type === 'empty_with_load' && (await sendAlert(workspace, a.facts, languages))) telegram++
  }
  for (const cmd of commands) await dispatchCommand(workspace, cmd)
  return { workspace, rooms: site.rooms.length, alerts: fresh.length, telegram, autoOff: commands.length, devices: polled.length, saved: Boolean(savedState?.ok) }
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || !safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return json({ error: 'Unauthorized' }, 401)
  if (!supabase()) return json({ error: 'Server storage is not configured' }, 503)
  const started = Date.now()
  const since = new Date(started - ACTIVE_MS).toISOString()
  const [inputs, connected] = await Promise.all([
    rows<InputRow>(`room_inputs?ts=gte.${since}&select=workspace,key,room_id,kind,reading,ts&limit=20000`),
    rows<{ workspace: string }>('secrets?name=in.(shelly_cloud,home_assistant)&select=workspace'),
  ])
  if (!inputs) return storageError(null)
  const ids = [...new Set([...inputs.map((r) => r.workspace), ...(connected ?? []).map((r) => r.workspace)])].filter((id) => ID.test(id))
  const results = []
  // A few workspaces at a time: each waits on Supabase, Telegram and plugs, not on this CPU.
  for (let i = 0; i < ids.length; i += 5) {
    results.push(
      ...(await Promise.all(
        ids.slice(i, i + 5).map((id) =>
          tickWorkspace(
            id,
            inputs.filter((r) => r.workspace === id),
            started,
          ).catch((e: Error) => ({ workspace: id, error: e.message.slice(0, 200) })),
        ),
      )),
    )
  }
  const ms = Date.now() - started
  await upsert('twin_state', { workspace: '_tick', state: { ts: started, workspaces: ids.length, ms }, updated_at: new Date().toISOString() })
  // Old rate-limit windows: kept a day at most.
  await rest(`rate_limits?window_start=lt.${new Date(started - 86_400_000).toISOString()}`, { method: 'DELETE' })
  logJson('info', 'tick', { workspaces: ids.length, ms })
  return json({ workspaces: ids.length, ms, results })
}

export const POST = run
export const GET = run
