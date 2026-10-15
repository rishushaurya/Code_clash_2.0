// Which smart plug or Home Assistant entity belongs to which room (GET and PUT /api/connections).
// The server reads them every minute and switches them off on a command; this card is where they are listed.

import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSite } from '@/shared/site'
import type { CommandTarget } from '@/shared/types'
import { apiFetch, can, online } from '@/shared/workspace'
import { ErrorState, PanelSkeleton } from './states'

interface Shelly {
  roomId: string
  id: string
  channel: number
  target: CommandTarget
  power: boolean
}
interface HaEntity {
  roomId: string
  entityId: string
  target: CommandTarget
}
interface Mapping {
  shelly: Shelly[]
  homeAssistant: HaEntity[]
}

const TARGETS: [CommandTarget, string][] = [
  ['lights', 'Lights'],
  ['fans', 'Fans'],
  ['all', 'Everything'],
]
const field = 'h-8 rounded-md border bg-background px-2 text-sm'

type Room = ReturnType<typeof useSite.getState>['site']['rooms'][number]

function RoomPick({ rooms, value, onChange, label, disabled }: { rooms: Room[]; value: string; onChange: (v: string) => void; label: string; disabled: boolean }) {
  return (
    <select aria-label={label} className={field} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.id} {r.name !== r.id ? r.name : ''}
        </option>
      ))}
    </select>
  )
}

function TargetPick({ value, onChange, label, disabled }: { value: CommandTarget; onChange: (v: CommandTarget) => void; label: string; disabled: boolean }) {
  return (
    <select aria-label={label} className={field} value={value} onChange={(e) => onChange(e.target.value as CommandTarget)} disabled={disabled}>
      {TARGETS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

export function DeviceMapping() {
  const rooms = useSite((s) => s.site.rooms)
  const [data, setData] = useState<Mapping | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready' | 'saving'>('loading')
  const editable = can('manager')

  const load = () => {
    setState('loading')
    apiFetch('/api/connections')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((m: Mapping) => {
        setData({ shelly: m.shelly ?? [], homeAssistant: m.homeAssistant ?? [] })
        setState('ready')
      })
      .catch(() => setState('error'))
  }
  useEffect(() => {
    if (online()) load()
  }, [])

  if (!online()) return null

  async function save() {
    if (!data) return
    setState('saving')
    const res = await apiFetch('/api/connections', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).catch(() => null)
    setState('ready')
    if (res?.ok) toast.success('Saved. The twin reads these every minute.')
    else toast.error((await res?.json().catch(() => null))?.error ?? 'Not saved. Check each row and try again.')
  }

  const room = rooms[0]?.id ?? ''
  const set = (patch: Partial<Mapping>) => setData((d) => (d ? { ...d, ...patch } : d))
  return (
    <Card id="mapping">
      <CardHeader>
        <CardTitle className="text-base">Plugs and entities in each room</CardTitle>
        <CardDescription>Tell the twin which Shelly plug or Home Assistant entity powers what in each room. It reads their state every minute and switches them off when you, Telegram or automatic switch-off say so.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {state === 'loading' && <PanelSkeleton rows={3} />}
        {state === 'error' && <ErrorState message="The list could not be loaded." onRetry={load} />}
        {data && state !== 'loading' && state !== 'error' && (
          <>
            {!rooms.length && <p className="text-muted-foreground">Add rooms in Site setup first.</p>}
            <section className="space-y-2" aria-label="Shelly plugs">
              <h3 className="font-medium">Shelly plugs and relays</h3>
              {data.shelly.length === 0 && <p className="text-muted-foreground">None yet. The device id is on the Shelly app's device page.</p>}
              {data.shelly.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <RoomPick rooms={rooms} disabled={!editable} label={`Room of plug ${i + 1}`} value={s.roomId} onChange={(v) => set({ shelly: data.shelly.map((x, j) => (j === i ? { ...x, roomId: v } : x)) })} />
                  <Input aria-label={`Device id of plug ${i + 1}`} className="h-8 w-40" placeholder="Device id" value={s.id} disabled={!editable} onChange={(e) => set({ shelly: data.shelly.map((x, j) => (j === i ? { ...x, id: e.target.value.trim() } : x)) })} />
                  <Input aria-label={`Channel of plug ${i + 1}`} className="h-8 w-16" type="number" min={0} max={8} value={s.channel} disabled={!editable} onChange={(e) => set({ shelly: data.shelly.map((x, j) => (j === i ? { ...x, channel: Number(e.target.value) || 0 } : x)) })} />
                  <TargetPick disabled={!editable} label={`What plug ${i + 1} powers`} value={s.target} onChange={(v) => set({ shelly: data.shelly.map((x, j) => (j === i ? { ...x, target: v } : x)) })} />
                  <label className="flex items-center gap-1">
                    <input type="checkbox" className="size-4 accent-[var(--highlight)]" checked={s.power} disabled={!editable} onChange={(e) => set({ shelly: data.shelly.map((x, j) => (j === i ? { ...x, power: e.target.checked } : x)) })} />
                    Meter
                  </label>
                  {editable && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove plug ${i + 1}`} onClick={() => set({ shelly: data.shelly.filter((_, j) => j !== i) })}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {editable && (
                <Button size="sm" variant="outline" disabled={!room} onClick={() => set({ shelly: [...data.shelly, { roomId: room, id: '', channel: 0, target: 'lights', power: true }] })}>
                  <Plus /> Add a plug
                </Button>
              )}
            </section>
            <section className="space-y-2" aria-label="Home Assistant entities">
              <h3 className="font-medium">Home Assistant entities</h3>
              {data.homeAssistant.length === 0 && <p className="text-muted-foreground">None yet. Entity ids look like light.lecture_hall_1.</p>}
              {data.homeAssistant.map((h, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <RoomPick rooms={rooms} disabled={!editable} label={`Room of entity ${i + 1}`} value={h.roomId} onChange={(v) => set({ homeAssistant: data.homeAssistant.map((x, j) => (j === i ? { ...x, roomId: v } : x)) })} />
                  <Input aria-label={`Entity id ${i + 1}`} className="h-8 w-56" placeholder="light.lecture_hall_1" value={h.entityId} disabled={!editable} onChange={(e) => set({ homeAssistant: data.homeAssistant.map((x, j) => (j === i ? { ...x, entityId: e.target.value.trim() } : x)) })} />
                  <TargetPick disabled={!editable} label={`What entity ${i + 1} controls`} value={h.target} onChange={(v) => set({ homeAssistant: data.homeAssistant.map((x, j) => (j === i ? { ...x, target: v } : x)) })} />
                  {editable && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove entity ${i + 1}`} onClick={() => set({ homeAssistant: data.homeAssistant.filter((_, j) => j !== i) })}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {editable && (
                <Button size="sm" variant="outline" disabled={!room} onClick={() => set({ homeAssistant: [...data.homeAssistant, { roomId: room, entityId: '', target: 'all' }] })}>
                  <Plus /> Add an entity
                </Button>
              )}
            </section>
            {editable ? (
              <Button onClick={() => void save()} disabled={state === 'saving'}>
                <Save /> {state === 'saving' ? 'Saving' : 'Save the list'}
              </Button>
            ) : (
              <p className="text-muted-foreground">Viewers can see this list; a manager or owner changes it.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
