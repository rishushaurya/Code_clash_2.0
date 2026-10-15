// Edit panels of the 3D view: change a room (size, type, look, devices, furniture), and design with AI from
// words or a photo. Both only produce design operations (design.ts); the view applies them to its draft and
// nothing is stored until Save.

import { useRef, useState } from 'react'
import { Copy, ImagePlus, Loader2, Minus, Plus, RotateCw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deviceCounts, FURNITURE_KINDS, ROOM_TEMPLATES } from '@/shared/site'
import type { DeviceType, FurnitureKind, Room, RoomType, Site } from '@/shared/types'
import { apiFetch, online } from '@/shared/workspace'
import { arrangeFurniture, describeOp, roomSize, type DesignOp } from './design'
import { Panel, toDataUrl } from './panels'

const DEVICES: [DeviceType, string][] = [
  ['light', 'Lights'],
  ['fan', 'Fans'],
  ['ac', 'ACs'],
  ['projector', 'Projectors'],
  ['pc', 'Computers'],
]
const KIND_LABEL: Record<FurnitureKind, string> = { desk: 'Desks', chair: 'Chairs', table: 'Tables', bench: 'Lab benches', board: 'Boards', sofa: 'Sofas', shelf: 'Shelves', plant: 'Plants', podium: 'Podiums', bed: 'Beds' }

/** A number field that commits on Enter or when it loses focus */
function NumberField({ id, label, value, min, max, step = 0.1, onCommit }: { id: string; label: string; value: number; min: number; max: number; step?: number; onCommit: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        key={value}
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        className="h-8"
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v !== value) onCommit(Math.min(max, Math.max(min, v)))
        }}
      />
    </div>
  )
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" aria-label={`One fewer: ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
          <Minus />
        </Button>
        <span className="w-8 text-center font-mono" aria-live="polite">
          {value}
        </span>
        <Button size="icon-sm" variant="outline" aria-label={`One more: ${label}`} onClick={() => onChange(value + 1)}>
          <Plus />
        </Button>
      </span>
    </div>
  )
}

/** Everything about one room that the 3D view can change */
export function RoomEditor({ site, room, onOps }: { site: Site; room: Room; onOps: (ops: DesignOp[], done: string) => void }) {
  const [w, d] = roomSize(site, room)
  const counts = deviceCounts(room)
  const furniture = (room.furniture ?? arrangeFurniture(room.type, w, d)).reduce<Partial<Record<FurnitureKind, number>>>((a, f) => ({ ...a, [f.kind]: (a[f.kind] ?? 0) + 1 }), {})
  const [kind, setKind] = useState<FurnitureKind>('plant')
  const id = room.id
  const up = (patch: Omit<Extract<DesignOp, { op: 'updateRoom' }>, 'op' | 'roomId'>, done: string) => onOps([{ op: 'updateRoom', roomId: id, ...patch }], done)
  const setFurniture = (next: Partial<Record<FurnitureKind, number>>) =>
    onOps([{ op: 'setFurniture', roomId: id, items: (Object.entries(next) as [FurnitureKind, number][]).filter(([, n]) => n > 0).map(([k, n]) => ({ kind: k, count: n })) }], 'Furniture changed.')

  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-label="Room">
        <div className="space-y-1">
          <Label htmlFor="ed-name" className="text-xs">
            Name
          </Label>
          <Input key={room.name} id="ed-name" defaultValue={room.name} maxLength={60} className="h-8" onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} onBlur={(e) => e.target.value.trim() && e.target.value !== room.name && up({ name: e.target.value.trim() }, 'Renamed.')} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ed-type" className="text-xs">
            Type
          </Label>
          <select id="ed-type" className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={room.type} onChange={(e) => up({ type: e.target.value as RoomType }, 'Room type changed.')}>
            {(Object.keys(ROOM_TEMPLATES) as RoomType[]).map((t) => (
              <option key={t} value={t}>
                {ROOM_TEMPLATES[t].label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <NumberField id="ed-w" label="Width m" value={w} min={2} max={80} onCommit={(v) => up({ widthM: v }, `Width ${v} m.`)} />
          <NumberField id="ed-d" label="Depth m" value={d} min={2} max={80} onCommit={(v) => up({ depthM: v }, `Depth ${v} m.`)} />
          <NumberField id="ed-h" label="Height m" value={room.heightM ?? 3} min={2.2} max={12} onCommit={(v) => up({ heightM: v }, `Height ${v} m.`)} />
        </div>
        <div className="grid grid-cols-2 items-end gap-2">
          <NumberField id="ed-cap" label="Seats" value={room.capacity} min={1} max={5000} step={1} onCommit={(v) => up({ capacity: v }, `${v} seats.`)} />
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--highlight)]" checked={room.windowSide} onChange={(e) => up({ windowSide: e.target.checked }, e.target.checked ? 'Windows added.' : 'Windows removed.')} />
            Outside windows
          </label>
        </div>
      </section>

      <section className="space-y-2" aria-label="Look">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Look</h3>
        <div className="flex flex-wrap gap-3">
          {(['wall', 'floor', 'accent'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="color"
                className="size-8 cursor-pointer rounded border bg-transparent"
                value={room.style?.[k] ?? (k === 'wall' ? '#f4efe7' : k === 'floor' ? '#d8cdbb' : '#a0896f')}
                onChange={(e) => onOps([{ op: 'setStyle', roomId: id, style: { [k]: e.target.value } }], `New ${k} colour.`)}
                aria-label={`${k} colour`}
              />
              {k}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2" aria-label="Devices">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Devices</h3>
        {DEVICES.map(([t, label]) => (
          <Stepper key={t} label={label} value={counts[t] ?? 0} onChange={(v) => onOps([{ op: 'setDevices', roomId: id, counts: { [t]: v } }], `${label}: ${v}.`)} />
        ))}
        <p className="text-xs text-muted-foreground">New devices are arranged on the ceiling. Walk in and use Place to put each where it really is.</p>
      </section>

      <section className="space-y-2" aria-label="Furniture">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Furniture</h3>
        {(Object.entries(furniture) as [FurnitureKind, number][]).map(([k, n]) => (
          <Stepper key={k} label={KIND_LABEL[k]} value={n} onChange={(v) => setFurniture({ ...furniture, [k]: v })} />
        ))}
        <div className="flex gap-2">
          <select aria-label="Furniture to add" className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as FurnitureKind)}>
            {FURNITURE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setFurniture({ ...furniture, [kind]: (furniture[kind] ?? 0) + 1 })}>
            <Plus /> Add
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onOps([{ op: 'placeFurniture', roomId: id, items: arrangeFurniture(room.type, w, d) }], 'Furniture arranged for the room type.')}>
          <Wand2 /> Arrange for a {ROOM_TEMPLATES[room.type].label.toLowerCase()}
        </Button>
      </section>

      <section className="flex flex-wrap gap-2 border-t pt-3" aria-label="Room actions">
        <Button size="sm" variant="outline" onClick={() => onOps([{ op: 'addRoom', floor: room.floor, name: '', type: room.type, copyOf: id }], 'Copy added beside the other rooms.')}>
          <Copy /> Duplicate
        </Button>
        <Button size="sm" variant="outline" onClick={() => up({ widthM: d, depthM: w }, 'Turned a quarter.')}>
          <RotateCw /> Turn
        </Button>
        <select
          aria-label="Move to floor"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value=""
          onChange={(e) => e.target.value !== '' && onOps([{ op: 'moveRoom', roomId: id, floor: Number(e.target.value) }], 'Moved to another floor.')}
        >
          <option value="">Move to floor</option>
          {site.floors
            .filter((f) => f.level !== room.floor)
            .map((f) => (
              <option key={f.level} value={f.level}>
                {f.name}
              </option>
            ))}
        </select>
        <Button size="sm" variant="ghost" className="text-waste" onClick={() => confirm(`Remove ${room.name}? Its devices and readings go with it once you save.`) && onOps([{ op: 'removeRoom', roomId: id }], `${room.name} removed.`)}>
          <Trash2 /> Remove
        </Button>
      </section>
    </div>
  )
}

/** What the server needs to know about the building: ids, sizes and devices, never readings */
const summary = (site: Site) => ({
  floors: site.floors.map((f) => ({ level: f.level, name: f.name })),
  rooms: site.rooms.map((r) => {
    const [w, d] = roomSize(site, r)
    const furniture = (r.furniture ?? arrangeFurniture(r.type, w, d)).reduce<Partial<Record<FurnitureKind, number>>>((a, f) => ({ ...a, [f.kind]: (a[f.kind] ?? 0) + 1 }), {})
    return { id: r.id, name: r.name, floor: r.floor, type: r.type, widthM: w, depthM: d, heightM: r.heightM ?? 3, capacity: r.capacity, counts: deviceCounts(r), furniture }
  }),
})

const EXAMPLES = ['Add a 40-seat classroom on the first floor', 'Give every office a warm wood floor and two plants', 'Make LH-1 look like this photo', 'Add a meeting room next to the offices with one AC']

/** Design with AI: words, a photo or both become a list of changes the person checks before applying */
export function DesignPanel({ site, roomId, floor, onApply, onClose }: { site: Site; roomId?: string; floor?: number; onApply: (ops: DesignOp[], done: string) => void; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [state, setState] = useState<{ busy?: boolean; error?: string; noKey?: boolean }>({})
  const [answer, setAnswer] = useState<{ summary: string; ops: DesignOp[] } | null>(null)
  const [keep, setKeep] = useState<boolean[]>([])

  const attach = async (f: File | undefined | null) => {
    if (!f || !f.type.startsWith('image/')) return
    setPhoto((await toDataUrl(f, 1280)).url)
  }

  async function ask() {
    setState({ busy: true })
    setAnswer(null)
    try {
      const res = await apiFetch('/api/ai/design', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: text.trim(), ...(photo && { image: photo }), ...(roomId && { roomId }), ...(floor !== undefined && { floor }), building: summary(site) }),
      })
      const body = (await res.json().catch(() => ({}))) as { summary?: string; ops?: DesignOp[]; error?: string; code?: string }
      if (!res.ok) {
        if (body.code === 'no-key' || res.status === 503) return setState({ noKey: true })
        return setState({ error: res.status === 429 ? 'Too many requests in a row. Wait a minute and try again.' : (body.error ?? `The designer could not answer (${res.status}).`) })
      }
      if (!body.ops?.length) return setState({ error: 'The designer found nothing to change. Say which room or floor, and what to add or change.' })
      setAnswer({ summary: body.summary ?? '', ops: body.ops })
      setKeep(body.ops.map(() => true))
      setState({})
    } catch (e) {
      setState({ error: `The request failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const chosen = answer?.ops.filter((_, i) => keep[i]) ?? []
  return (
    <Panel title="Design with AI" onClose={onClose} className="w-[min(26rem,calc(100vw-2rem))]">
      {!online() ? (
        <p className="text-muted-foreground">The AI designer needs an online workspace. You can still change every room by hand in Edit mode.</p>
      ) : (
        <div className="space-y-3" onPaste={(e) => void attach([...e.clipboardData.files].find((f) => f.type.startsWith('image/')))}>
          <p className="text-muted-foreground">
            Describe a change, or add a photo of a room and say where it goes. It uses your own AI key. You check every change before it is applied, and nothing is saved until you press Save.
          </p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={roomId ? `For example: make ${roomId} look like this photo` : EXAMPLES[0]} aria-label="What to change" />
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => setText(x)}>
                {x}
              </button>
            ))}
          </div>
          <input ref={file} type="file" accept="image/*" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} />
          {photo ? (
            <div className="relative">
              <img src={photo} alt="Room photo for the designer" className="max-h-40 w-full rounded-lg object-cover" />
              <Button size="icon-sm" variant="secondary" className="absolute top-1 right-1" aria-label="Remove the photo" onClick={() => setPhoto(null)}>
                <X />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="w-full" onClick={() => file.current?.click()}>
              <ImagePlus /> Add a photo (or paste one)
            </Button>
          )}
          <Button className="w-full" disabled={text.trim().length < 2 || state.busy} onClick={() => void ask()}>
            {state.busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {state.busy ? 'Designing' : 'Design it'}
          </Button>
          {state.noKey && (
            <p role="alert" className="text-sm">
              Add an AI key that can read {photo ? 'photos' : 'text'} in{' '}
              <Link to="/settings/keys" className="text-highlight underline">
                Settings, Keys and AI
              </Link>
              .
            </p>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-waste">
              {state.error}
            </p>
          )}
          {answer && (
            <div className="space-y-2 rounded-lg border p-3">
              <p>{answer.summary}</p>
              <ul className="space-y-1">
                {answer.ops.map((o, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1 size-4 accent-[var(--highlight)]" checked={keep[i]} onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))} />
                      <span>{describeOp(o, site)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {photo && <p className="text-xs text-muted-foreground">Sizes and colours read from a photo are estimates. Check them on the model.</p>}
              <Button className="w-full" disabled={!chosen.length} onClick={() => onApply(chosen, `${chosen.length} ${chosen.length === 1 ? 'change' : 'changes'} applied. Check the model, then Save.`)}>
                Apply {chosen.length} {chosen.length === 1 ? 'change' : 'changes'} to the model
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
