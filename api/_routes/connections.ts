// GET /api/connections  (Bearer token)  Which smart plugs and Home Assistant entities belong to which room.
// PUT /api/connections  (manager or owner)  Save that list (stored as the document <id>/connections).
//
// The server reads these every minute (the tick) and switches them off on a command:
//   Shelly Cloud (key shelly_cloud + its server address): switch state and power of each plug or relay;
//   Home Assistant (key home_assistant + its https address): light, switch, fan, power sensor and motion
//   sensor entities, switched off with light.turn_off, switch.turn_off and so on.
// Local-only devices (Tasmota, Shelly on the local network) go through Home Assistant, which reaches them.

import { z } from 'zod'
import type { Command, CommandTarget, DeviceType, SensorReading } from '../../src/shared/types'
import { readDoc, settingsLog, writeDoc } from '../_lib/db.js'
import { broadcast, forwardCommand, json, logEvent, readBody, requireRole, storageError } from '../_lib/http.js'
import { safeFetch, workspaceKeys, type StoredKey } from '../_lib/keys.js'
import { RoomIdSchema } from '../_lib/schemas.js'

const Target = z.enum(['lights', 'fans', 'all'])

export const ConnectionsSchema = z.object({
  shelly: z
    .array(z.object({ roomId: RoomIdSchema, id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), channel: z.number().int().min(0).max(8).default(0), target: Target, power: z.boolean().default(true) }))
    .max(200)
    .default([]),
  homeAssistant: z
    .array(z.object({ roomId: RoomIdSchema, entityId: z.string().regex(/^[a-z_]{1,30}\.[a-z0-9_]{1,100}$/, 'an entity id like light.lecture_hall_1'), target: Target.default('all') }))
    .max(500)
    .default([]),
})
export type Connections = z.infer<typeof ConnectionsSchema>

const NONE: Connections = { shelly: [], homeAssistant: [] }

export async function readConnections(workspace: string): Promise<Connections> {
  const doc = await readDoc(workspace, 'connections')
  const parsed = doc && doc !== 'unavailable' ? ConnectionsSchema.safeParse(doc.value) : null
  return parsed?.success ? parsed.data : NONE
}

export async function GET(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  return json(await readConnections(c.id))
}

export async function PUT(req: Request) {
  const c = await requireRole(req, 'manager')
  if (c instanceof Response) return c
  const body = await readBody(req, ConnectionsSchema, 100_000)
  if (body instanceof Response) return body
  const res = await writeDoc(c.id, 'connections', body)
  if (!(res instanceof Response) || !res.ok) return storageError(res)
  await settingsLog(c.id, 'connections.save', { shelly: body.shelly.length, homeAssistant: body.homeAssistant.length, by: c.role })
  return json({ ok: true })
}

const TYPES: Record<CommandTarget, DeviceType[]> = { lights: ['light'], fans: ['fan'], all: ['light', 'fan', 'ac', 'projector', 'pc'] }
const HA_SWITCHABLE = ['light', 'switch', 'fan', 'input_boolean']
const hits = (entry: CommandTarget, cmd: CommandTarget) => cmd === 'all' || entry === cmd
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// --- Shelly Cloud (Cloud Control API v2: https://shelly-api-docs.shelly.cloud/cloud-control-api/communication-v2) ---

/** Switch state and power of one channel, from a Gen2+ status (switch:0) or a Gen1 status (relays, meters) */
export function shellyChannel(status: Record<string, unknown> | undefined, ch: number): { on?: boolean; watts?: number } {
  const sw = (status?.[`switch:${ch}`] ?? status?.[`relay:${ch}`]) as { output?: boolean; apower?: number } | undefined
  if (sw) return { on: sw.output, watts: sw.apower }
  const relay = (status?.relays as { ison?: boolean }[] | undefined)?.[ch]
  const meter = ((status?.meters ?? status?.emeters) as { power?: number }[] | undefined)?.[ch]
  return { on: relay?.ison, watts: meter?.power }
}

async function readShelly(key: StoredKey, entries: Connections['shelly']) {
  const out = new Map<string, Record<string, unknown>>()
  const ids = [...new Set(entries.map((e) => e.id))]
  // Shelly allows 10 devices per request and 1 request per second.
  for (let i = 0; i < ids.length; i += 10) {
    if (i) await pause(1100)
    const res = await safeFetch(`${key.baseUrl}/v2/devices/api/get?auth_key=${encodeURIComponent(key.value)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(i, i + 10), select: ['status'] }),
    }).catch(() => null)
    const list = res?.ok ? ((await res.json().catch(() => [])) as { id: string; online?: number; status?: Record<string, unknown> }[]) : []
    for (const d of Array.isArray(list) ? list : []) if (d.online && d.status) out.set(d.id, d.status)
  }
  return out
}

// --- Home Assistant (REST API: https://developers.home-assistant.io/docs/api/rest/) ---

async function readHomeAssistant(key: StoredKey) {
  const res = await safeFetch(`${key.baseUrl}/api/states`, { headers: { authorization: `Bearer ${key.value}` } }).catch(() => null)
  const list = res?.ok ? ((await res.json().catch(() => [])) as { entity_id: string; state: string; attributes?: { unit_of_measurement?: string } }[]) : []
  return new Map((Array.isArray(list) ? list : []).map((s) => [s.entity_id, s]))
}

/**
 * Every connected device's state as sensor readings, one per room and source. Rooms with nothing that
 * answered get no reading, so an offline plug never turns into "off".
 */
export async function pollConnections(conn: Connections, keys: Partial<Record<string, StoredKey>>, now: number): Promise<SensorReading[]> {
  const out: SensorReading[] = []
  const add = (roomId: string, source: string) => {
    let r = out.find((x) => x.roomId === roomId && x.source === source)
    if (!r) out.push((r = { roomId, source, ts: now }))
    return r
  }
  const setType = (r: SensorReading, target: CommandTarget, on: boolean) => {
    for (const type of TYPES[target]) {
      const d = (r.devices ??= []).find((x) => x.type === type)
      if (d) d.on ||= on
      else r.devices.push({ type, on })
    }
  }
  if (keys.shelly_cloud?.baseUrl && conn.shelly.length) {
    const status = await readShelly(keys.shelly_cloud, conn.shelly)
    for (const e of conn.shelly) {
      const s = shellyChannel(status.get(e.id), e.channel)
      if (s.on === undefined) continue
      const r = add(e.roomId, 'shelly')
      setType(r, e.target, s.on)
      if (e.power && Number.isFinite(s.watts)) r.powerW = (r.powerW ?? 0) + Math.max(0, s.watts!)
    }
  }
  if (keys.home_assistant?.baseUrl && conn.homeAssistant.length) {
    const states = await readHomeAssistant(keys.home_assistant)
    for (const e of conn.homeAssistant) {
      const s = states.get(e.entityId)
      if (!s || s.state === 'unavailable' || s.state === 'unknown') continue
      const domain = e.entityId.split('.')[0]
      const r = add(e.roomId, 'home-assistant')
      if (domain === 'sensor') {
        const w = Number(s.state) * (s.attributes?.unit_of_measurement === 'kW' ? 1000 : 1)
        if (Number.isFinite(w)) r.powerW = (r.powerW ?? 0) + Math.max(0, w)
      } else if (domain === 'binary_sensor') r.occupancy = Math.max(r.occupancy ?? 0, s.state === 'on' ? 1 : 0)
      else if (HA_SWITCHABLE.includes(domain)) setType(r, e.target, s.state === 'on')
    }
  }
  return out.filter((r) => r.devices || r.powerW !== undefined || r.occupancy !== undefined)
}

/** Switch off the room's connected devices the command targets; returns how many accepted */
export async function switchOffDevices(workspace: string, cmd: Pick<Command, 'roomId' | 'target' | 'state'>): Promise<number> {
  if (cmd.state !== 'off') return 0
  const conn = await readConnections(workspace)
  const shelly = conn.shelly.filter((e) => e.roomId === cmd.roomId && hits(e.target, cmd.target))
  const ha = conn.homeAssistant.filter((e) => e.roomId === cmd.roomId && hits(e.target, cmd.target) && HA_SWITCHABLE.includes(e.entityId.split('.')[0]))
  if (!shelly.length && !ha.length) return 0
  const keys = await workspaceKeys(workspace)
  let done = 0
  if (keys.shelly_cloud?.baseUrl) {
    for (const [i, e] of shelly.entries()) {
      if (i) await pause(1100)
      const res = await safeFetch(`${keys.shelly_cloud.baseUrl}/v2/devices/api/set/switch?auth_key=${encodeURIComponent(keys.shelly_cloud.value)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: e.id, channel: e.channel, on: false }),
      }).catch(() => null)
      if (res?.ok) done++
    }
  }
  if (keys.home_assistant?.baseUrl) {
    const results = await Promise.all(
      ha.map((e) =>
        safeFetch(`${keys.home_assistant!.baseUrl}/api/services/${e.entityId.split('.')[0]}/turn_off`, {
          method: 'POST',
          headers: { authorization: `Bearer ${keys.home_assistant!.value}`, 'content-type': 'application/json' },
          body: JSON.stringify({ entity_id: e.entityId }),
        }).catch(() => null),
      ),
    )
    done += results.filter((r) => r?.ok).length
  }
  return done
}

/**
 * A switch-off, wherever it came from (a person, Telegram, the automatic policy): to the twins on the live
 * channel, to the customer's command webhook, to the connected plugs and Home Assistant, and into the event log.
 */
export async function dispatchCommand(workspace: string, cmd: Command) {
  const [broadcasted, forwarded, devices] = await Promise.all([broadcast(workspace, 'command', cmd), forwardCommand(workspace, cmd), switchOffDevices(workspace, cmd).catch(() => 0)])
  await logEvent(workspace, cmd.roomId, 'command', { ...cmd, text: `${cmd.roomId}: switch off ${cmd.target} (${cmd.origin})` })
  return { broadcasted, forwarded, devices }
}
