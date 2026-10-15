// The immersive 3D twin: the building computed from the site, live state on it, orbit / walk / fly,
// edit mode for room layout and device positions, the real outline, a floor plan photo, and .glb export.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  Box,
  Camera,
  Download,
  Expand,
  Footprints,
  HelpCircle,
  Layers,
  List,
  Map as MapIcon,
  Maximize,
  Minimize,
  Move3d,
  PencilRuler,
  Plane,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Sofa,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { Link } from 'react-router'
import type * as THREE from 'three'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { deviceCounts, makeDevices, pushSite, ROOM_TEMPLATES, setSite, SiteSchema, useSite } from '@/shared/site'
import type { DeviceType, RoomState, RoomType, Site } from '@/shared/types'
import { send } from '@/twin/realtime'
import { saveCamera, useCameras } from '@/cv/cameras'
import { SourceBadges, StatusBadge } from '../components/status'
import { applyOps, fromOutline, type DesignOp } from './design'
import { DesignPanel, RoomEditor } from './editor'
import { buildModel, savePolygons, type V2 } from './model'
import type { Outline } from './osm'
import { OutlinePanel, Panel, PhotoPanel } from './panels'
import { Scene, type Input, type Mode, type SceneApi, type Selection, type Tokens } from './Scene'

const DEVICE_LABEL: Record<DeviceType, string> = { light: 'Light', fan: 'Fan', ac: 'AC', projector: 'Projector', pc: 'Computer' }
const PLACE_LABEL: Record<DeviceType | 'camera', string> = { ...DEVICE_LABEL, camera: 'Camera' }

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim() || '#888888'
  return {
    bg: v('--bg'),
    surface: v('--surface'),
    surface2: v('--surface-2'),
    border: v('--border-c'),
    text: v('--text'),
    muted: v('--text-muted'),
    highlight: v('--highlight'),
    occupied: v('--status-occupied'),
    idle: v('--status-idle'),
    waste: v('--status-waste'),
  }
}

/** Follows the theme switch, which toggles the .dark class on <html> */
function useTokens() {
  const [t, setT] = useState(readTokens)
  useEffect(() => {
    const mo = new MutationObserver(() => setT(readTokens()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return t
}

function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

/** Touch joystick: drag the knob to walk; writes into the shared input the walker reads every frame */
function Joystick({ input }: { input: React.RefObject<Input> }) {
  const [knob, setKnob] = useState<V2>([0, 0])
  const R = 44
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    let x = e.clientX - (box.left + box.width / 2)
    let y = e.clientY - (box.top + box.height / 2)
    const d = Math.hypot(x, y)
    if (d > R) [x, y] = [(x / d) * R, (y / d) * R]
    setKnob([x, y])
    input.current.move = { x: x / R, y: -y / R }
  }
  const stop = () => {
    setKnob([0, 0])
    input.current.move = { x: 0, y: 0 }
  }
  return (
    <div
      role="presentation"
      className="pointer-events-auto relative size-28 touch-none rounded-full border-2 bg-card/70 backdrop-blur"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={(e) => e.buttons && move(e)}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <span className="absolute left-1/2 top-1/2 size-12 rounded-full bg-primary/80" style={{ transform: `translate(calc(-50% + ${knob[0]}px), calc(-50% + ${knob[1]}px))` }} />
    </div>
  )
}

function Tool({ label, pressed, onClick, children, keyHint }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode; keyHint?: string }) {
  return (
    <Button
      variant={pressed ? 'default' : 'ghost'}
      size="sm"
      aria-pressed={pressed}
      onClick={onClick}
      title={keyHint ? `${label} (${keyHint})` : label}
      className="min-h-9"
    >
      {children}
      <span className="max-lg:sr-only">{label}</span>
    </Button>
  )
}

export default function Building3DView({ rooms, onSelect }: { rooms: Record<string, RoomState>; onSelect?: (id: string) => void }) {
  const site = useSite((s) => s.site)
  const cameras = useCameras((s) => s.cameras)
  const tokens = useTokens()
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const touch = useMedia('(pointer: coarse)')
  const box = useRef<HTMLDivElement>(null)
  const api = useRef<SceneApi>(null)
  const group = useRef<THREE.Group>(null)
  const input = useRef<Input>({ move: { x: 0, y: 0 } })

  const [compact, setCompact] = useState(false)
  const [full, setFull] = useState(false)
  const [mode, setMode] = useState<Mode>('orbit')
  const [isolate, setIsolate] = useState<number | null>(null)
  const [explode, setExplode] = useState(false)
  // Cutaway lifts the facade and roof off to see inside; details draws furniture and room colours.
  const [cutaway, setCutaway] = useState(false)
  const [details, setDetails] = useState(true)
  const [selected, setSelected] = useState<Selection>(null)
  const [panel, setPanel] = useState<'help' | 'list' | 'outline' | 'photo' | 'design' | null>(null)
  const [notice, setNotice] = useState('')
  const [walkRoom, setWalkRoom] = useState<{ id: string } | null>(null)

  // Edit mode works on a draft; nothing reaches the site until Save.
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState<Site | null>(null)
  const [moved, setMoved] = useState<Record<string, V2>>({})
  /** Earlier drafts, for Undo */
  const [past, setPast] = useState<Site[]>([])
  const [newType, setNewType] = useState<RoomType>('classroom')
  const [placing, setPlacing] = useState<DeviceType | 'camera' | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const dragBase = useRef<{ id: string; base: V2 } | null>(null)

  const working = draft ?? site
  const model = useMemo(() => buildModel(working, moved), [working, moved])
  const levels = model.floors.map((f) => f.level)
  const ground = model.floors.find((f) => f.y === 0)?.level ?? levels[0]
  const walkLevel = isolate ?? ground
  const shown = mode === 'walk' ? [walkLevel] : isolate !== null ? [isolate] : levels
  const unsaved = draft !== null

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.height < 380 || e.contentRect.width < 420))
    ro.observe(el)
    const fs = () => setFull(document.fullscreenElement === el)
    document.addEventListener('fullscreenchange', fs)
    return () => {
      ro.disconnect()
      document.removeEventListener('fullscreenchange', fs)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(t)
  }, [notice])

  const outline = site.outline ?? null
  const setOutline = (o: Outline | null) => persist({ ...site, outline: o ?? undefined }, o ? 'Outline saved for every device of this workspace.' : 'Outline removed.')

  const fullscreen = () => (document.fullscreenElement ? void document.exitFullscreen() : void box.current?.requestFullscreen?.())

  function selectRoom(id: string, focus = false) {
    if (compact && onSelect) return onSelect(id)
    setSelected({ kind: 'room', id })
    if (mode === 'walk') setWalkRoom({ id })
    if (focus && mode === 'orbit') api.current?.focus(id)
  }

  function changeMode(m: Mode) {
    setMode(m)
    setPlacing(null)
    setMoving(null)
    if (m === 'walk' && isolate === null) setIsolate(ground)
  }

  /** Every change lands in the draft through here, so Undo can step back through them */
  function commit(next: Site) {
    setPast((p) => [...p.slice(-40), working])
    setDraft(next)
  }

  function applyDesign(ops: DesignOp[], done: string) {
    const { site: next, notes } = applyOps(working, ops)
    commit(next)
    if (!edit) setEdit(true)
    setNotice(notes.length ? `${done} Skipped: ${notes.join('; ')}.` : done)
  }

  function undo() {
    const prev = past[past.length - 1]
    if (!prev) return
    setPast((p) => p.slice(0, -1))
    setDraft(prev === site ? null : prev)
  }

  function onMove(id: string, shift: V2 | null) {
    if (!shift) {
      dragBase.current = null
      // The dragged position becomes part of the draft at once, so later edits and Undo build on it.
      const level = working.rooms.find((r) => r.id === id)?.floor
      if (level !== undefined) commit(savePolygons(working, model, [level]))
      setMoved({})
      return
    }
    if (dragBase.current?.id !== id) dragBase.current = { id, base: moved[id] ?? [0, 0] }
    const b = dragBase.current.base
    setMoved((m) => ({ ...m, [id]: [b[0] + shift[0], b[1] + shift[1]] }))
  }

  function onPlace(roomId: string, local: [number, number, number]) {
    // Cameras are saved at once with the camera's own settings; devices wait in the draft until Save.
    if (placing === 'camera' || (moving && cameras[moving])) {
      const ids = Object.keys(cameras).filter((id) => cameras[id].roomId === roomId).sort()
      const cam = moving && cameras[moving] ? moving : ids.find((id) => !cameras[id].position)
      if (!cam) return setNotice(ids.length ? 'Every camera of this room is placed. Select one to move it.' : 'This room has no camera yet. Add one on the Cameras page first.')
      if (cameras[cam].roomId !== roomId) return setNotice('Move a camera within its own room.')
      saveCamera(cam, { ...cameras[cam], position: local, updatedAt: Date.now() })
      setSelected({ kind: 'camera', id: cam, roomId })
      setMoving(null)
      return setNotice(`${cameras[cam].name || cam} placed at ${local.map((v) => v.toFixed(2)).join(', ')} m and saved.`)
    }
    const type = placing
    const d = draft ?? site
    const room = d.rooms.find((r) => r.id === roomId)
    if (!room) return
    let devices = room.devices
    let target = moving
    if (target && !devices.some((x) => x.id === target)) return setNotice('Move a device within its own room.')
    if (!target && type) target = devices.find((x) => x.type === type && !x.position)?.id ?? null
    if (!target && type) {
      // Every device of this type already has a spot: this click adds one more.
      const counts = deviceCounts(room)
      const fresh = makeDevices(room.id, { ...counts, [type]: (counts[type] ?? 0) + 1 }, Object.fromEntries(room.devices.map((x) => [x.type, x.ratedW])))
      devices = fresh.map((x) => room.devices.find((o) => o.id === x.id) ?? x)
      target = devices.find((x) => !room.devices.some((o) => o.id === x.id))?.id ?? null
    }
    if (!target) return
    const id = target
    devices = devices.map((x) => (x.id === id ? { ...x, position: local } : x))
    commit({ ...d, rooms: d.rooms.map((r) => (r.id === roomId ? { ...r, devices } : r)) })
    setSelected({ kind: 'device', id, roomId })
    setMoving(null)
    setNotice(`${id} placed at ${local.map((v) => v.toFixed(2)).join(', ')} m. Save to keep it.`)
  }

  function clearPosition(id: string, roomId: string) {
    const d = draft ?? site
    commit({ ...d, rooms: d.rooms.map((r) => (r.id === roomId ? { ...r, devices: r.devices.map((x) => (x.id === id ? { ...x, position: undefined } : x)) } : r)) })
  }

  function discard() {
    setDraft(null)
    setMoved({})
    setPast([])
    setPlacing(null)
    setMoving(null)
  }

  /** Saves a whole site here, on the server and on every open screen of the workspace (the Site setup path) */
  function persist(next: Site, done?: string) {
    const parsed = SiteSchema.safeParse(next)
    if (!parsed.success) {
      setNotice(`Not saved: ${parsed.error.issues[0]?.path.join(' > ')} ${parsed.error.issues[0]?.message}`)
      return false
    }
    setSite(parsed.data)
    void pushSite(useSite.getState().site).then((where) => {
      if (where === 'server') send('site', { ts: Date.now() })
      setNotice(done ?? (where === 'server' ? 'Saved. Every device of this workspace now shows these changes.' : 'Saved on this device.'))
    })
    return true
  }

  function save() {
    // The draft was copied when editing began; keep an outline chosen since then.
    if (persist({ ...working, outline: useSite.getState().site.outline })) discard()
  }

  async function exportGlb() {
    if (!group.current) return
    setNotice('Preparing the model...')
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    try {
      const glb = (await new GLTFExporter().parseAsync(group.current, { binary: true })) as ArrayBuffer
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' })),
        download: `${(site.buildingName || 'building').replace(/\W+/g, '-').toLowerCase()}.glb`,
      })
      a.click()
      URL.revokeObjectURL(a.href)
      setNotice('Model downloaded as .glb.')
    } catch (e) {
      setNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Keyboard shortcuts while this view is on screen; typing in a field never triggers them.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey || compact) return
      const k = e.key
      if (k === '1') changeMode('orbit')
      else if (k === '2') changeMode('walk')
      else if (k === '3') changeMode('fly')
      else if (k === '0') api.current?.reset()
      else if (k === 'x' && mode !== 'walk') setExplode((v) => !v)
      else if (k === 'k') setCutaway((v) => !v)
      else if (k === 'z' && edit) undo()
      else if (k === 'l') setPanel((p) => (p === 'list' ? null : 'list'))
      else if (k === '?') setPanel((p) => (p === 'help' ? null : 'help'))
      else if (k === 'Escape') {
        if (placing || moving) {
          setPlacing(null)
          setMoving(null)
        } else if (panel) setPanel(null)
        else if (selected) setSelected(null)
        else if (mode !== 'orbit' && !document.fullscreenElement) changeMode('orbit')
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const selRoom = selected && working.rooms.find((r) => r.id === (selected.kind === 'room' ? selected.id : selected.roomId))
  const selDevice = selected?.kind === 'device' ? selRoom?.devices.find((d) => d.id === selected.id) : undefined
  const selCamera = selected?.kind === 'camera' ? cameras[selected.id] : undefined
  const floorName = (level: number) => {
    const f = site.floors.find((x) => x.level === level)
    return f ? (f.building ? `${f.building}, ${f.name}` : f.name) : `Floor ${level}`
  }

  if (!site.rooms.length) {
    return (
      <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        <Box className="size-6" aria-hidden />
        <p>The 3D model is built from your rooms. Add rooms in Site setup to see it.</p>
        <Button asChild size="sm">
          <Link to="/settings/site">Open Site setup</Link>
        </Button>
      </div>
    )
  }

  const stateLine = (s?: RoomState) => {
    if (!s) return 'No data yet'
    const on = Object.values(s.deviceOn).filter(Boolean).length
    return `${s.occupancyKnown ? `${s.headcount} people` : 'People: no input'}, ${Math.round(s.watts)} W${s.metered ? ' metered' : ''}, ${on} devices on`
  }

  return (
    <div ref={box} className="relative h-full min-h-48 w-full overflow-hidden rounded-xl bg-background" aria-label={`3D model of ${site.buildingName || 'the building'}`}>
      <Canvas
        shadows
        flat
        dpr={[1, 2]}
        camera={{ fov: 55, near: 0.1, far: 4000, position: [40, 40, 40] }}
        onPointerMissed={() => !placing && setSelected(null)}
        className={cn('absolute inset-0', placing || moving ? 'cursor-crosshair' : mode !== 'orbit' && 'cursor-grab')}
        aria-hidden
      >
        <Scene
          model={model}
          siteRooms={working.rooms}
          rooms={rooms}
          tokens={tokens}
          mode={mode}
          levels={shown}
          explode={explode && isolate === null && levels.length > 1}
          edit={edit}
          placing={!!(placing || moving)}
          selected={selected}
          reduced={reduced}
          compact={compact}
          outline={outline}
          envelope={!cutaway && isolate === null && mode !== 'walk'}
          details={details}
          walkStart={walkRoom}
          api={api}
          group={group}
          input={input}
          onRoom={(id) => selectRoom(id)}
          onDevice={(id, roomId) => setSelected({ kind: 'device', id, roomId })}
          cameras={cameras}
          onCamera={(id, roomId) => setSelected({ kind: 'camera', id, roomId })}
          onPlace={onPlace}
          onMove={onMove}
        />
      </Canvas>

      {/* Text alternative of the model: every room and its state, also the keyboard way to pick a room. */}
      <ul className="sr-only" aria-label="Rooms in the 3D model">
        {site.rooms.map((r) => (
          <li key={r.id}>
            {r.id} {r.name}, {floorName(r.floor)}: {(rooms[r.id]?.status ?? 'unknown').replace('unknown', 'no data')}. {stateLine(rooms[r.id])}.
          </li>
        ))}
      </ul>

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-2 p-2 sm:p-3">
        {compact ? (
          <div className="pointer-events-auto ml-auto flex gap-1 rounded-lg border bg-card/90 p-1 shadow-sm backdrop-blur">
            <Button variant="ghost" size="icon-sm" onClick={() => api.current?.reset()} aria-label="Reset view" title="Reset view">
              <RotateCcw />
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/building">
                <Expand /> Open 3D
              </Link>
            </Button>
          </div>
        ) : (
          <div role="toolbar" aria-label="3D view controls" className="pointer-events-auto flex flex-wrap items-center gap-1 self-start rounded-xl border bg-card/90 p-1 shadow-[var(--shadow-card)] backdrop-blur">
            <Tool label="Orbit" keyHint="1" pressed={mode === 'orbit'} onClick={() => changeMode('orbit')}>
              <Move3d />
            </Tool>
            <Tool label="Walk" keyHint="2" pressed={mode === 'walk'} onClick={() => changeMode('walk')}>
              <Footprints />
            </Tool>
            <Tool label="Fly" keyHint="3" pressed={mode === 'fly'} onClick={() => changeMode('fly')}>
              <Plane />
            </Tool>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <label className="flex items-center gap-1 px-1 text-xs">
              <Layers className="size-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">Floor</span>
              <select
                className="h-8 rounded-md border bg-background px-1 text-sm"
                value={isolate ?? ''}
                onChange={(e) => setIsolate(e.target.value === '' ? null : Number(e.target.value))}
              >
                {mode !== 'walk' && <option value="">All floors</option>}
                {model.floors.map((f) => (
                  <option key={f.level} value={f.level}>
                    {floorName(f.level)}
                  </option>
                ))}
              </select>
            </label>
            {levels.length > 1 && mode !== 'walk' && isolate === null && (
              <Tool label="Explode" keyHint="X" pressed={explode} onClick={() => setExplode((v) => !v)}>
                <Layers />
              </Tool>
            )}
            <Tool
              label="Edit"
              pressed={edit}
              onClick={() => {
                if (edit && unsaved && !confirm('Leave edit mode and discard unsaved 3D changes?')) return
                if (edit) discard()
                setEdit(!edit)
              }}
            >
              <PencilRuler />
            </Tool>
            <Tool label="Cutaway" keyHint="K" pressed={cutaway || isolate !== null || mode === 'walk'} onClick={() => setCutaway((v) => !v)}>
              <Scissors />
            </Tool>
            <Tool label="Furniture" pressed={details} onClick={() => setDetails((v) => !v)}>
              <Sofa />
            </Tool>
            <Tool label="Design with AI" pressed={panel === 'design'} onClick={() => setPanel(panel === 'design' ? null : 'design')}>
              <Sparkles />
            </Tool>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Tool label="Rooms" keyHint="L" pressed={panel === 'list'} onClick={() => setPanel(panel === 'list' ? null : 'list')}>
              <List />
            </Tool>
            <Tool label="Outline" pressed={panel === 'outline'} onClick={() => setPanel(panel === 'outline' ? null : 'outline')}>
              <MapIcon />
            </Tool>
            <Tool label="Plan photo" pressed={panel === 'photo'} onClick={() => setPanel(panel === 'photo' ? null : 'photo')}>
              <Camera />
            </Tool>
            <Tool label="Export .glb" onClick={() => void exportGlb()}>
              <Download />
            </Tool>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Button variant="ghost" size="icon-sm" onClick={() => api.current?.reset()} aria-label="Reset view" title="Reset view (0)">
              <RotateCcw />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={fullscreen} aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'}>
              {full ? <Minimize /> : <Maximize />}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setPanel(panel === 'help' ? null : 'help')} aria-label="Keyboard help" title="Keyboard help (?)" aria-pressed={panel === 'help'}>
              <HelpCircle />
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 items-start justify-between gap-2">
          <div className="flex max-h-full min-h-0 flex-col gap-2">
            {panel === 'help' && (
              <Panel title="Keyboard and touch" onClose={() => setPanel(null)} className="w-72">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {[
                    ['1, 2, 3', 'Orbit, walk, fly'],
                    ['W A S D', 'Move (arrows too)'],
                    ['Q, E or arrows', 'Turn left, right'],
                    ['Drag', 'Look around (orbit: rotate, right-drag: pan)'],
                    ['Shift', 'Move faster'],
                    ['Space, C', 'Fly up, down'],
                    ['X', 'Explode floors'],
                    ['K', 'Cutaway: lift the facade and roof'],
                    ['Z', 'Undo the last edit'],
                    ['L', 'Room list'],
                    ['0', 'Reset view'],
                    ['Esc', 'Cancel, close, back to orbit'],
                    ['Touch', 'Joystick to walk, drag to look'],
                  ].map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-xs leading-5">{k}</dt>
                      <dd className="text-muted-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}
            {panel === 'list' && (
              <Panel title="Rooms" onClose={() => setPanel(null)} className="w-72">
                <ul className="space-y-1">
                  {site.rooms.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="flex w-full flex-col items-start gap-0.5 rounded-lg p-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-highlight" onClick={() => selectRoom(r.id, true)}>
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="font-mono font-semibold">{r.id}</span>
                          <StatusBadge status={rooms[r.id]?.status ?? 'unknown'} />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {floorName(r.floor)} · {stateLine(rooms[r.id])}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {panel === 'outline' && (
              <OutlinePanel
                site={site}
                outline={outline}
                onOutline={setOutline}
                onGenerate={(o, levels) => {
                  if (site.rooms.length && !confirm(`Replace your ${site.rooms.length} rooms with a building generated from this outline? You can review it and Discard before saving.`)) return
                  commit({ ...fromOutline(working, o, levels), outline: o })
                  setEdit(true)
                  setIsolate(null)
                  setPanel(null)
                  setNotice(`A ${levels}-floor building was generated from the outline. Rename and refit rooms, then Save.`)
                }}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === 'design' && (
              <DesignPanel
                site={working}
                roomId={selRoom?.id}
                floor={isolate ?? undefined}
                onApply={(ops, done) => {
                  applyDesign(ops, done)
                  setPanel(null)
                }}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === 'photo' && (
              <PhotoPanel
                site={site}
                onClose={() => setPanel(null)}
                onApply={(next, n) => {
                  if (persist(next, `Shapes of ${n} rooms saved from the photo.`)) setPanel(null)
                }}
              />
            )}
          </div>

          {selRoom && !compact && (
            <Panel title={selCamera ? `Camera ${selCamera.name || selected?.id}` : selDevice ? `${DEVICE_LABEL[selDevice.type]} ${selDevice.id}` : `${selRoom.id} ${selRoom.name !== selRoom.id ? selRoom.name : ''}`} onClose={() => setSelected(null)} className="ml-auto w-72">
              {selCamera && selected ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    {selCamera.position
                      ? `Placed at x ${selCamera.position[0]} m, height ${selCamera.position[1]} m, z ${selCamera.position[2]} m from the room's corner.`
                      : 'Not placed yet.'}
                  </p>
                  {edit && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={moving === selected.id ? 'default' : 'outline'}
                        onClick={() => {
                          setMoving(selected.id)
                          setPlacing(null)
                          setNotice(mode === 'orbit' ? 'Walk into the room, then click the ceiling or wall where it is.' : 'Click the ceiling or wall where it is.')
                        }}
                      >
                        {moving === selected.id ? 'Click where it is' : 'Move'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          saveCamera(selected.id, { ...selCamera, position: undefined, updatedAt: Date.now() })
                          setSelected(null)
                        }}
                      >
                        Clear position
                      </Button>
                    </div>
                  )}
                </div>
              ) : selDevice ? (
                <DeviceDetails
                  device={selDevice}
                  state={rooms[selRoom.id]}
                  edit={edit}
                  moving={moving === selDevice.id}
                  onMove={() => {
                    setMoving(selDevice.id)
                    setPlacing(null)
                    setNotice(mode === 'orbit' ? 'Walk into the room, then click the ceiling or wall where it is.' : 'Click the ceiling or wall where it is.')
                  }}
                  onClear={() => clearPosition(selDevice.id, selRoom.id)}
                  onRemove={() => {
                    applyDesign([{ op: 'removeDevice', roomId: selRoom.id, deviceId: selDevice.id }], `${selDevice.id} removed.`)
                    setSelected({ kind: 'room', id: selRoom.id })
                  }}
                />
              ) : edit ? (
                <RoomEditor site={working} room={selRoom} onOps={applyDesign} />
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={rooms[selRoom.id]?.status ?? 'unknown'} />
                    <SourceBadges sources={rooms[selRoom.id]?.sources ?? []} />
                  </div>
                  <p className="text-muted-foreground">{floorName(selRoom.floor)}</p>
                  <dl className="grid grid-cols-2 gap-2">
                    <Stat label="People" value={rooms[selRoom.id]?.occupancyKnown ? `${rooms[selRoom.id].headcount} of ${selRoom.capacity}` : 'No input'} />
                    <Stat label="Power now" value={rooms[selRoom.id] ? `${Math.round(rooms[selRoom.id].watts)} W` : 'No data'} />
                    <Stat label="Devices on" value={rooms[selRoom.id] ? `${Object.values(rooms[selRoom.id].deviceOn).filter(Boolean).length} of ${selRoom.devices.length}` : 'No data'} />
                    <Stat label="Not observed" value={rooms[selRoom.id] ? String(selRoom.devices.filter((d) => rooms[selRoom.id].deviceOn[d.id] === undefined).length) : 'All'} />
                  </dl>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {onSelect ? (
                      <Button size="sm" onClick={() => onSelect(selRoom.id)}>
                        Open room
                      </Button>
                    ) : (
                      <Button asChild size="sm">
                        <Link to={`/room/${selRoom.id}`}>Open room</Link>
                      </Button>
                    )}
                    {mode !== 'walk' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setIsolate(selRoom.floor)
                          setWalkRoom({ id: selRoom.id })
                          setMode('walk')
                        }}
                      >
                        <Footprints /> Walk in
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          )}
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col items-start gap-2">
            {mode !== 'orbit' && touch && <Joystick input={input} />}
            {outline && mode !== 'walk' && <p className="pointer-events-auto rounded bg-card/80 px-1.5 text-[11px] text-muted-foreground">Outline: Map data OpenStreetMap contributors</p>}
          </div>
          {edit && !compact && (
            <div role="group" aria-label="Edit the model" className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-card/95 p-2 text-sm shadow-[var(--shadow-card)]">
              <span className="px-1 text-muted-foreground">
                {mode === 'orbit' ? (isolate === null ? 'Pick one floor to drag its rooms on the grid.' : 'Drag rooms on the grid.') : 'Place:'}
              </span>
              {mode !== 'orbit' &&
                (Object.keys(PLACE_LABEL) as (DeviceType | 'camera')[]).map((t) => (
                  <Button key={t} size="sm" variant={placing === t ? 'default' : 'outline'} aria-pressed={placing === t} onClick={() => {
                      setPlacing(placing === t ? null : t)
                      setMoving(null)
                    }}>
                    {PLACE_LABEL[t]}
                  </Button>
                ))}
              {mode === 'orbit' && (
                <Button size="sm" variant="outline" onClick={() => changeMode('walk')}>
                  <Footprints /> Walk in to place devices
                </Button>
              )}
              <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              <select aria-label="Type of room to add" className="h-8 rounded-md border bg-background px-1 text-sm" value={newType} onChange={(e) => setNewType(e.target.value as RoomType)}>
                {(Object.keys(ROOM_TEMPLATES) as RoomType[]).map((t) => (
                  <option key={t} value={t}>
                    {ROOM_TEMPLATES[t].label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => applyDesign([{ op: 'addRoom', floor: isolate ?? ground, name: '', type: newType }], `New ${ROOM_TEMPLATES[newType].label.toLowerCase()} added on ${floorName(isolate ?? ground)}.`)}>
                <Plus /> Room
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const level = Math.max(...working.floors.map((f) => f.level)) + 1
                  applyDesign([{ op: 'addFloor', level, name: `Floor ${level}` }], `Floor ${level} added. Add rooms to it.`)
                  setIsolate(level)
                }}
              >
                <Plus /> Floor
              </Button>
              {isolate !== null && working.floors.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-waste"
                  onClick={() => {
                    if (!confirm(`Remove ${floorName(isolate)} and its ${working.rooms.filter((r) => r.floor === isolate).length} rooms?`)) return
                    applyDesign([{ op: 'removeFloor', level: isolate }], `${floorName(isolate)} removed.`)
                    setIsolate(null)
                  }}
                >
                  <Trash2 /> Floor
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={!past.length} onClick={undo} title="Undo (Z)">
                <Undo2 /> Undo
              </Button>
              <Button size="sm" variant="ghost" disabled={!unsaved} onClick={discard}>
                <X /> Discard
              </Button>
              <Button size="sm" disabled={!unsaved} onClick={save}>
                <Save /> Save
              </Button>
            </div>
          )}
        </div>
      </div>

      <p role="status" aria-live="polite" className={cn('pointer-events-none absolute bottom-20 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-center text-sm text-primary-foreground shadow transition-opacity', notice ? 'opacity-100' : 'opacity-0')}>
        {notice || (placing ? `Click a ceiling, wall or floor to place a ${PLACE_LABEL[placing].toLowerCase()}.` : '')}
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  )
}

function DeviceDetails({ device, state, edit, moving, onMove, onClear, onRemove }: { device: Site['rooms'][number]['devices'][number]; state?: RoomState; edit: boolean; moving: boolean; onMove: () => void; onClear: () => void; onRemove: () => void }) {
  const on = state?.deviceOn[device.id]
  const source = state?.deviceSource?.[device.id]
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="State" value={on === undefined ? 'Not observed' : on ? 'On' : 'Off'} />
        <Stat label="Rated" value={`${device.ratedW} W`} />
      </dl>
      {source && (
        <p className={cn('inline-flex rounded-full px-2 py-0.5 text-xs', source === 'inferred' ? 'border border-dashed border-muted-foreground text-muted-foreground' : 'bg-highlight/15 text-highlight')}>
          {source === 'inferred' ? 'Inferred from the devices the camera sees' : `Known from ${source}`}
        </p>
      )}
      <p className="text-muted-foreground">
        {device.position ? `Placed at x ${device.position[0]} m, height ${device.position[1]} m, z ${device.position[2]} m from the room's corner.` : 'Arranged automatically. Place it in edit mode to record where it is.'}
      </p>
      {edit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={moving ? 'default' : 'outline'} onClick={onMove}>
            {moving ? 'Click where it is' : device.position ? 'Move' : 'Place'}
          </Button>
          {device.position && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear position
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-waste" onClick={onRemove}>
            <Trash2 /> Remove
          </Button>
        </div>
      )}
    </div>
  )
}
