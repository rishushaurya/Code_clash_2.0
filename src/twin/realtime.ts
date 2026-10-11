// Live messages between cameras, the twin, phones and server functions, inside one workspace.
// Two channels per workspace:
//   private (name carries a secret only members get): readings, sensors, tips, commands, acks, cameras, snapshots;
//   public (in the public view's link): snapshots only, so a visitor can watch but never send.
// With Supabase keys they travel over the internet; without them, BroadcastChannel links tabs on this machine.
// Every message is also delivered in the sending tab, so a camera running beside the twin feeds it directly.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import { CHANNEL, PUBLIC_CHANNEL, SESSION, online } from '@/shared/workspace'
import type { CameraConfig, Command, CommandAck, CvReading, SensorReading, Snapshot } from '@/shared/types'

export interface Messages {
  reading: CvReading
  sensor: SensorReading
  /** A visitor on the public view says lights are left on; it raises an alert and changes nothing else */
  tip: { roomId: string; ts: number }
  snapshot: Snapshot
  command: Command
  ack: CommandAck
  /** A camera's saved settings changed on some device (null: removed) */
  camera: { id: string; config: CameraConfig | null }
  /** The site was saved on some device: fetch it again */
  site: { ts: number }
}
type Event = keyof Messages
const EVENTS: Event[] = ['reading', 'sensor', 'tip', 'snapshot', 'command', 'ack', 'camera', 'site']

export const useRealtime = create<{ status: 'local' | 'connecting' | 'online' | 'offline' }>(() => ({ status: 'local' }))

const handlers = new Map<Event, Set<(p: never) => void>>()
const dispatch = (event: Event, payload: unknown) => handlers.get(event)?.forEach((h) => h(payload as never))
/** Members listen to everything on the private channel; a visitor without a session listens to snapshots only */
const member = Boolean(SESSION)

const bc = (name: string | null) => (name && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null)
const privateLocal = member ? bc(CHANNEL) : null
const publicLocal = bc(PUBLIC_CHANNEL)
if (privateLocal) privateLocal.onmessage = (e) => dispatch(e.data.event, e.data.payload)
if (publicLocal && !member) publicLocal.onmessage = (e) => e.data.event === 'snapshot' && dispatch('snapshot', e.data.payload)

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
let remotePrivate: RealtimeChannel | null = null
let remotePublic: RealtimeChannel | null = null
// A visitor's link names a server workspace; a member goes online only with a server workspace.
if (url && key && ((member && online()) || (!member && PUBLIC_CHANNEL))) {
  useRealtime.setState({ status: 'connecting' })
  // Loaded only when keys exist, so a local install never downloads the Supabase client.
  void import('@supabase/supabase-js').then(({ createClient }) => {
    const client = createClient(url, key)
    const status = (s: string) => useRealtime.setState({ status: s === 'SUBSCRIBED' ? 'online' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'offline' : 'connecting' })
    if (member && CHANNEL) {
      const ch = client.channel(CHANNEL, { config: { broadcast: { self: false } } })
      for (const event of EVENTS) ch.on('broadcast', { event }, ({ payload }) => dispatch(event, payload))
      ch.subscribe((s) => {
        remotePrivate = s === 'SUBSCRIBED' ? ch : remotePrivate
        status(s)
      })
    }
    if (PUBLIC_CHANNEL) {
      const ch = client.channel(PUBLIC_CHANNEL, { config: { broadcast: { self: false } } })
      if (!member) ch.on('broadcast', { event: 'snapshot' }, ({ payload }) => dispatch('snapshot', payload))
      ch.subscribe((s) => {
        remotePublic = s === 'SUBSCRIBED' ? ch : remotePublic
        if (!member) status(s)
      })
    }
  })
}

/** Send to this tab and every other tab and device of the workspace. `remote: false` keeps it on this machine. */
export function send<E extends Event>(event: E, payload: Messages[E], opts: { remote?: boolean } = {}) {
  queueMicrotask(() => dispatch(event, payload))
  if (!member) return
  privateLocal?.postMessage({ event, payload })
  if (remotePrivate && opts.remote !== false) void remotePrivate.send({ type: 'broadcast', event, payload })
  if (event === 'snapshot') {
    publicLocal?.postMessage({ event, payload })
    if (remotePublic) void remotePublic.send({ type: 'broadcast', event, payload })
  }
}

export function on<E extends Event>(event: E, handler: (payload: Messages[E]) => void) {
  const set = handlers.get(event) ?? new Set()
  set.add(handler as (p: never) => void)
  handlers.set(event, set)
  return () => void set.delete(handler as (p: never) => void)
}
