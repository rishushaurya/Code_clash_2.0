// Everything inside the canvas: the building computed in model.ts, live state on top, and the camera modes.

import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Bvh, CameraControls, Edges, Grid, Html, Instance, Instances, Line } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CameraConfig, DeviceType, Room, RoomState } from '@/shared/types'
import { STATUS } from '../components/status'
import { bbox, blockers, collide, placeDevices, roomAt, WALL, type FloorGeo, type Model, type Placed, type RoomGeo, type V2 } from './model'
import type { Outline } from './osm'

export type Mode = 'orbit' | 'walk' | 'fly'
export type Selection = { kind: 'room'; id: string } | { kind: 'device' | 'camera'; id: string; roomId: string } | null

/** Design tokens read from CSS, so the model follows the light and dark themes */
export interface Tokens {
  bg: string
  surface: string
  surface2: string
  border: string
  text: string
  muted: string
  highlight: string
  occupied: string
  idle: string
  waste: string
}

/** Lit fixtures are drawn in warm lamp light, the one colour here that is a lamp, not a UI token */
const LAMP = '#fff1c4'
const EYE = 1.6
const EXPLODE_GAP = 9

export interface SceneApi {
  reset: () => void
  focus: (roomId: string) => void
}

export interface Input {
  /** Touch joystick: x right, y forward, each -1 to 1 */
  move: { x: number; y: number }
}

interface Props {
  model: Model
  siteRooms: Room[]
  rooms: Record<string, RoomState>
  tokens: Tokens
  mode: Mode
  levels: number[]
  explode: boolean
  edit: boolean
  placing: boolean
  selected: Selection
  reduced: boolean
  compact: boolean
  outline: Outline | null
  /** A new object moves the walker into that room */
  walkStart: { id: string } | null
  api: RefObject<SceneApi | null>
  group: RefObject<THREE.Group | null>
  input: RefObject<Input>
  onRoom: (id: string) => void
  onDevice: (id: string, roomId: string) => void
  /** Cameras of the workspace, drawn where they were placed */
  cameras: Record<string, CameraConfig>
  onCamera: (id: string, roomId: string) => void
  onPlace: (roomId: string, local: [number, number, number]) => void
  onMove: (id: string, shift: V2 | null) => void
}

/** A flat shape from a polygon in world x/z, lying on y = 0 */
function flat(poly: V2[]) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))))
  g.rotateX(-Math.PI / 2)
  return g
}

const floorBox = (f: FloorGeo) => (f.rooms.length ? bbox(f.rooms.flatMap((r) => r.poly)) : { min: [0, 0] as V2, max: [10, 10] as V2 })

/** One box per wall piece, merged into a single mesh per floor and material */
function wallGeometry(floor: FloorGeo, glass: boolean) {
  const parts = floor.walls
    .filter((w) => w.glass === glass)
    .map((w) => {
      const dx = w.b[0] - w.a[0]
      const dz = w.b[1] - w.a[1]
      const g = new THREE.BoxGeometry(Math.hypot(dx, dz) + (glass ? 0 : WALL), w.y1 - w.y0, glass ? WALL / 3 : WALL)
      g.rotateY(-Math.atan2(dz, dx))
      g.translate((w.a[0] + w.b[0]) / 2, (w.y0 + w.y1) / 2, (w.a[1] + w.b[1]) / 2)
      return g
    })
  const merged = parts.length ? mergeGeometries(parts) : null
  parts.forEach((p) => p.dispose())
  return merged
}

/** A geometry made from data, disposed when the data changes or the view closes */
function useDisposable<T extends { dispose: () => void } | null>(make: () => T, deps: unknown[]): T {
  const value = useMemo(make, deps)
  useEffect(() => () => value?.dispose(), [value])
  return value
}

export function Scene(props: Props) {
  const { model, mode, levels, explode, tokens, edit, outline } = props
  const visible = model.floors.filter((f) => levels.includes(f.level))
  const span = Math.max(model.max[0] - model.min[0], model.max[1] - model.min[1], model.top, 10)
  const centre = new THREE.Vector3((model.min[0] + model.max[0]) / 2, 0, (model.min[1] + model.max[1]) / 2)
  // Explode lifts each floor of a building by its index, so every floor's rooms can be seen from above.
  const lift = (f: FloorGeo) => {
    if (!explode || mode === 'walk') return 0
    const same = visible.filter((x) => x.building === f.building)
    return Math.max(0, same.indexOf(f)) * EXPLODE_GAP
  }
  return (
    <>
      <color attach="background" args={[tokens.bg]} />
      <hemisphereLight args={['#ffffff', tokens.surface2, 1.1]} />
      <directionalLight
        castShadow
        position={[centre.x + span * 0.6, model.top + span, centre.z + span * 0.4]}
        intensity={1.5}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={span * 4}
        shadow-bias={-0.0004}
      >
        <object3D attach="target" position={centre} />
      </directionalLight>
      <mesh rotation-x={-Math.PI / 2} position={[centre.x, -0.21 + Math.min(0, ...model.floors.map((f) => f.y)), centre.z]} receiveShadow>
        <circleGeometry args={[span * 8, 64]} />
        {/* Only the shadows show: the ground is the page itself. */}
        <shadowMaterial opacity={0.18} />
      </mesh>
      <Bvh firstHitOnly>
        <group ref={props.group} name={`Building`}>
          {visible.map((f) => (
            <Floor key={f.level} floor={f} lift={lift(f)} {...props} />
          ))}
        </group>
      </Bvh>
      {outline && mode !== 'walk' && <Shell outline={outline} model={model} tokens={tokens} />}
      {mode === 'orbit' ? (
        <Orbit {...props} centre={centre} span={span} />
      ) : (
        <Walker {...props} floor={model.floors.find((f) => f.level === levels[0]) ?? model.floors[0]} fly={mode === 'fly'} />
      )}
      {edit && mode === 'orbit' && visible.length === 1 && (
        <Grid
          position={[centre.x, visible[0].y + 0.03, centre.z]}
          args={[span * 2, span * 2]}
          cellSize={0.5}
          sectionSize={5}
          cellColor={tokens.border}
          sectionColor={tokens.muted}
          fadeDistance={span * 3}
        />
      )}
    </>
  )
}

function Orbit({ api, centre, span, model, reduced, explode }: Props & { centre: THREE.Vector3; span: number }) {
  const ref = useRef<CameraControls>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    // Far enough that the building's bounding sphere fills most of the view, from the south-east and above.
    const height = model.top + (explode ? EXPLODE_GAP * (model.floors.length - 1) : 0)
    const radius = 0.5 * Math.hypot(model.max[0] - model.min[0], model.max[1] - model.min[1], height)
    const d = (radius / Math.sin((55 * Math.PI) / 360)) * 1.05
    const dir = new THREE.Vector3(0.4, 0.85, 0.6).normalize().multiplyScalar(d)
    const reset = (smooth: boolean) => c.setLookAt(centre.x + dir.x, height / 2 + dir.y, centre.z + dir.z, centre.x, height / 2, centre.z, smooth)
    void reset(false)
    api.current = {
      reset: () => void reset(!reduced),
      focus: (id) => {
        const r = model.floors.flatMap((f) => f.rooms).find((x) => x.id === id)
        if (!r) return
        const d = Math.max(r.size[0], r.size[1], 6) * 1.4
        void c.setLookAt(r.center[0] + d * 0.5, r.y + r.h + d, r.center[1] + d, r.center[0], r.y, r.center[1], !reduced)
      },
    }
    // Only when the building's extent changes, not on every edit.
  }, [Math.round(span), model.top, reduced, explode])
  return <CameraControls ref={ref} makeDefault maxPolarAngle={Math.PI / 2 - 0.05} minDistance={3} maxDistance={span * 5} smoothTime={reduced ? 0 : 0.25} />
}

/** Walk at head height with wall collision, or fly freely; WASD and arrows, drag to look, touch joystick */
function Walker({ floor, fly, input, api, walkStart }: Props & { floor: FloorGeo; fly: boolean }) {
  const { camera, gl } = useThree()
  const look = useRef({ yaw: 0, pitch: 0 })
  const keys = useRef(new Set<string>())
  const segs = useMemo(() => blockers(floor.walls), [floor])
  const box = useMemo(() => floorBox(floor), [floor])
  // Edits rebuild the floor; the walker restarts only when the floor, mode or chosen room changes.
  const latest = useRef({ floor, box, segs })
  latest.current = { floor, box, segs }

  useEffect(() => {
    const start = () => {
      const { floor, box, segs } = latest.current
      // Start in the chosen room; else outside the ground floor facing it, or in the first room upstairs.
      const r = floor.rooms.find((x) => x.id === walkStart?.id) ?? (floor.y > 0 ? floor.rooms[0] : undefined)
      const p: V2 = r ? r.center : [box.min[0] - 3, (box.min[1] + box.max[1]) / 2]
      const [x, z] = fly ? p : collide(p, 0.3, segs)
      camera.position.set(x, floor.y + (fly ? EYE + 4 : EYE), z)
      // Look along the room's longer side, or at the building.
      const along = r ? r.size[0] >= r.size[1] : true
      look.current = { yaw: along ? -Math.PI / 2 : Math.PI, pitch: fly ? -0.3 : 0 }
    }
    start()
    api.current = { reset: start, focus: () => undefined }
  }, [floor.level, fly, walkStart, camera, api])

  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
      keys.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    const blur = () => keys.current.clear()
    let last: { x: number; y: number } | null = null
    const el = gl.domElement
    const press = (e: PointerEvent) => (last = { x: e.clientX, y: e.clientY })
    const drag = (e: PointerEvent) => {
      if (!last || !e.buttons) return
      look.current.yaw -= (e.clientX - last.x) * 0.004
      look.current.pitch = Math.max(-1.4, Math.min(1.4, look.current.pitch - (e.clientY - last.y) * 0.004))
      last = { x: e.clientX, y: e.clientY }
    }
    const release = () => (last = null)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    el.addEventListener('pointerdown', press)
    window.addEventListener('pointermove', drag)
    window.addEventListener('pointerup', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      el.removeEventListener('pointerdown', press)
      window.removeEventListener('pointermove', drag)
      window.removeEventListener('pointerup', release)
    }
  }, [gl])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const k = keys.current
    const on = (...codes: string[]) => (codes.some((c) => k.has(c)) ? 1 : 0)
    look.current.yaw += (on('ArrowLeft', 'KeyQ') - on('ArrowRight', 'KeyE')) * 1.8 * dt
    const fwd = on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown') + (input.current?.move.y ?? 0)
    const side = on('KeyD') - on('KeyA') + (input.current?.move.x ?? 0)
    const speed = (fly ? 9 : 2.4) * (on('ShiftLeft', 'ShiftRight') ? 2.2 : 1)
    const { yaw, pitch } = look.current
    camera.rotation.set(pitch, yaw, 0, 'YXZ')
    const f: V2 = [-Math.sin(yaw), -Math.cos(yaw)]
    const s: V2 = [Math.cos(yaw), -Math.sin(yaw)]
    const step: V2 = [(f[0] * fwd + s[0] * side) * speed * dt, (f[1] * fwd + s[1] * side) * speed * dt]
    if (fly) {
      camera.position.x += step[0]
      camera.position.z += step[1]
      camera.position.y = Math.max(0.5, camera.position.y + (fwd * Math.sin(pitch) + on('Space') - on('KeyC')) * speed * dt)
      return
    }
    let [x, z] = collide([camera.position.x + step[0], camera.position.z + step[1]], 0.3, segs)
    // Upper floors end at their slab; the ground floor lets you walk around outside.
    const m = floor.y > 0 ? 0.3 : -25
    x = Math.max(box.min[0] + m, Math.min(box.max[0] - m, x))
    z = Math.max(box.min[1] + m, Math.min(box.max[1] - m, z))
    camera.position.set(x, floor.y + EYE, z)
  })
  return null
}

function Floor({ floor, lift, rooms, siteRooms, tokens, mode, edit, placing, selected, reduced, cameras, onRoom, onDevice, onCamera, onPlace, onMove }: Props & { floor: FloorGeo; lift: number }) {
  const ref = useRef<THREE.Group>(null)
  const walls = useDisposable(() => wallGeometry(floor, false), [floor])
  const glass = useDisposable(() => wallGeometry(floor, true), [floor])
  const box = floorBox(floor)
  const inside = mode !== 'orbit'
  const placed = useMemo(
    () => floor.rooms.flatMap((g) => {
      const room = siteRooms.find((r) => r.id === g.id)
      return room ? placeDevices(room, g) : []
    }),
    [floor, siteRooms],
  )

  useFrame((_, delta) => {
    const g = ref.current
    if (!g) return
    const target = floor.y + lift
    g.position.y = reduced ? target : THREE.MathUtils.damp(g.position.y, target, 6, delta)
  })

  /** Ceiling, wall and floor clicks place the device being placed, at the exact point in room metres */
  const place = (e: ThreeEvent<MouseEvent>, onFloor = false) => {
    if (!placing || e.delta > 5) return
    e.stopPropagation()
    if (!ref.current) return
    // Floor-group space: world x and z, height above this floor.
    const p = ref.current.worldToLocal(e.point.clone())
    const n = e.face?.normal ?? new THREE.Vector3(0, -1, 0)
    const r = roomAt(floor, [p.x + n.x * 0.25, p.z + n.z * 0.25])
    if (!r) return
    const h = onFloor ? 0 : Math.max(0.1, Math.min(r.h - 0.04, p.y + n.y * 0.04))
    const local: [number, number, number] = [p.x + n.x * 0.12 - r.origin[0], h, p.z + n.z * 0.12 - r.origin[1]]
    onPlace(r.id, local.map((v) => Math.round(v * 100) / 100) as [number, number, number])
  }

  const drag = useRef<{ id: string; from: THREE.Vector3; plane: THREE.Plane } | null>(null)
  const canDrag = edit && mode === 'orbit'
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null

  return (
    <group ref={ref} name={floor.name} position-y={floor.y + lift}>
      <mesh position={[(box.min[0] + box.max[0]) / 2, -0.1, (box.min[1] + box.max[1]) / 2]} receiveShadow castShadow>
        <boxGeometry args={[box.max[0] - box.min[0] + 0.4, 0.2, box.max[1] - box.min[1] + 0.4]} />
        <meshStandardMaterial color={tokens.surface} roughness={0.95} />
      </mesh>
      {walls && (
        <mesh geometry={walls} castShadow receiveShadow onClick={(e) => place(e)}>
          <meshStandardMaterial color={tokens.surface} roughness={0.85} />
          <Edges threshold={30} color={tokens.border} />
        </mesh>
      )}
      {glass && (
        <mesh geometry={glass} onClick={(e) => place(e)}>
          <meshStandardMaterial color={tokens.border} transparent opacity={0.35} roughness={0.1} metalness={0.2} depthWrite={false} />
        </mesh>
      )}
      {inside && (
        // One ceiling over the whole floor, gaps between rooms included, at the floor's height.
        <mesh position={[(box.min[0] + box.max[0]) / 2, floor.h + 0.05, (box.min[1] + box.max[1]) / 2]} onClick={(e) => place(e)}>
          <boxGeometry args={[box.max[0] - box.min[0] + 0.4, 0.1, box.max[1] - box.min[1] + 0.4]} />
          <meshStandardMaterial color={tokens.surface} roughness={1} />
        </mesh>
      )}
      {floor.rooms.map((g) => (
        <RoomTile
          key={g.id}
          geo={g}
          state={rooms[g.id]}
          tokens={tokens}
          selected={selected?.kind === 'room' && selected.id === g.id}
          reduced={reduced}
          inside={inside}
          onClick={(e) => {
            if (placing) return place(e, true)
            if (e.delta > 5) return
            e.stopPropagation()
            onRoom(g.id)
          }}
          onPointerDown={(e) => {
            if (!canDrag) return
            e.stopPropagation()
            ;(e.target as Element).setPointerCapture(e.pointerId)
            drag.current = { id: g.id, from: e.point.clone(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -e.point.y) }
            if (controls) controls.enabled = false
            onMove(g.id, [0, 0])
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d || d.id !== g.id) return
            const hit = e.ray.intersectPlane(d.plane, new THREE.Vector3())
            if (!hit) return
            const snap = (v: number) => Math.round(v * 2) / 2
            onMove(g.id, [snap(hit.x - d.from.x), snap(hit.z - d.from.z)])
          }}
          onPointerUp={(e) => {
            if (!drag.current) return
            ;(e.target as Element).releasePointerCapture(e.pointerId)
            drag.current = null
            if (controls) controls.enabled = true
            onMove(g.id, null)
          }}
          onLabel={() => onRoom(g.id)}
        />
      ))}
      <Fixtures placed={placed} rooms={rooms} tokens={tokens} reduced={reduced} selected={selected} onDevice={placing ? undefined : onDevice} />
      {Object.entries(cameras).map(([id, c]) => {
        const r = floor.rooms.find((g) => g.id === c.roomId)
        if (!r || !c.position) return null
        const sel = selected?.kind === 'camera' && selected.id === id
        return (
          <mesh
            key={id}
            name={`Camera ${id}`}
            position={[r.origin[0] + c.position[0], c.position[1], r.origin[1] + c.position[2]]}
            onClick={(e) => {
              if (placing || e.delta > 5) return
              e.stopPropagation()
              onCamera(id, c.roomId)
            }}
          >
            <boxGeometry args={[0.16, 0.12, 0.22]} />
            <meshStandardMaterial color={sel ? tokens.highlight : tokens.text} roughness={0.4} />
          </mesh>
        )
      })}
    </group>
  )
}

function RoomTile({
  geo,
  state,
  tokens,
  selected,
  reduced,
  inside,
  onLabel,
  ...events
}: {
  geo: RoomGeo
  state?: RoomState
  tokens: Tokens
  selected: boolean
  reduced: boolean
  inside: boolean
  onLabel: () => void
  onClick: (e: ThreeEvent<MouseEvent>) => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void
}) {
  const status = state?.status ?? 'unknown'
  const meta = STATUS[status]
  const colour = { occupied: tokens.occupied, idle: tokens.idle, waste: tokens.waste, unknown: tokens.muted }[status]
  const shape = useDisposable(() => flat(geo.poly), [geo.poly])
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const base = status === 'waste' ? 0.6 : status === 'occupied' ? 0.55 : status === 'idle' ? 0.3 : 0.12
  useFrame(({ clock }) => {
    // Waste rooms pulse slowly (2 s), as on the floor plan; still under reduced motion.
    if (mat.current) mat.current.opacity = status === 'waste' && !reduced ? base + 0.2 * Math.sin(clock.elapsedTime * Math.PI) : base
  })
  const outline = useMemo(() => [...geo.poly, geo.poly[0]].map(([x, z]) => [x, 0.03, z] as [number, number, number]), [geo.poly])
  return (
    <group>
      <mesh geometry={shape} position-y={0.012} receiveShadow {...events}>
        <meshStandardMaterial ref={mat} color={colour} transparent opacity={base} depthWrite={false} />
      </mesh>
      <Line points={outline} color={selected ? tokens.highlight : colour} lineWidth={selected ? 4 : status === 'waste' ? 3 : 1.5} dashed={status === 'unknown'} dashSize={0.5} gapSize={0.35} />
      <Html position={[geo.center[0], inside ? Math.min(geo.h - 0.4, 2.4) : geo.h + 0.8, geo.center[1]]} center zIndexRange={[10, 0]} occlude={inside}>
        <button
          type="button"
          onClick={onLabel}
          aria-label={`${geo.id} ${geo.name}: ${meta.label}${state?.occupancyKnown ? `, ${state.headcount} people` : ''}`}
          className={cn(
            'group flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-card/90 px-2 py-0.5 text-xs shadow-sm backdrop-blur transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-highlight',
            selected && 'border-highlight',
          )}
        >
          <meta.icon className={cn('size-3.5', meta.text)} aria-hidden />
          <span className="font-mono font-semibold text-foreground">{geo.id}</span>
          <span className={cn(meta.text, !selected && 'hidden group-hover:inline group-focus-visible:inline')}>{meta.label}</span>
          {state?.occupancyKnown && (
            <span className="inline-flex items-center gap-0.5 font-mono text-foreground">
              <Users className="size-3" aria-hidden />
              {state.headcount}
            </span>
          )}
        </button>
      </Html>
    </group>
  )
}

const SHAPES: Record<DeviceType, () => THREE.BufferGeometry> = {
  light: () => new THREE.BoxGeometry(0.6, 0.04, 0.6),
  fan: () => {
    const a = new THREE.BoxGeometry(1.2, 0.02, 0.12)
    const b = new THREE.BoxGeometry(0.12, 0.02, 1.2)
    const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12)
    const rod = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6)
    rod.translate(0, 0.25, 0)
    const parts = [a, b, hub, rod].map((x) => x.toNonIndexed())
    const g = mergeGeometries(parts)
    ;[a, b, hub, rod, ...parts].forEach((x) => x.dispose())
    return g
  },
  ac: () => new THREE.BoxGeometry(1, 0.3, 0.24),
  projector: () => new THREE.BoxGeometry(0.4, 0.15, 0.35),
  pc: () => new THREE.BoxGeometry(0.5, 0.32, 0.04),
}

/** Device fixtures drawn as instanced meshes, one per type and per observed / inferred */
function Fixtures({ placed, rooms, tokens, reduced, selected, onDevice }: { placed: Placed[]; rooms: Record<string, RoomState>; tokens: Tokens; reduced: boolean; selected: Selection; onDevice?: (id: string, roomId: string) => void }) {
  const shapes = useDisposable(() => {
    const m = Object.fromEntries(Object.entries(SHAPES).map(([k, f]) => [k, f()])) as Record<DeviceType, THREE.BufferGeometry>
    return { ...m, dispose: () => Object.values(m).forEach((g) => g.dispose()) }
  }, [])
  const groups = new Map<string, Placed[]>()
  for (const p of placed) {
    const inferred = rooms[p.room.id]?.deviceSource?.[p.device.id] === 'inferred'
    const key = `${p.device.type}|${inferred ? 1 : 0}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return (
    <>
      {[...groups].map(([key, list]) => {
        const [type, inferred] = key.split('|') as [DeviceType, string]
        return (
          <Instances key={key} geometry={shapes[type]} limit={Math.max(list.length, 1)} range={list.length} castShadow={false}>
            {type === 'light' ? (
              <meshBasicMaterial toneMapped={false} transparent={inferred === '1'} opacity={inferred === '1' ? 0.55 : 1} />
            ) : (
              <meshStandardMaterial roughness={0.6} transparent={inferred === '1'} opacity={inferred === '1' ? 0.45 : 1} />
            )}
            {list.map((p) => {
              const on = rooms[p.room.id]?.deviceOn[p.device.id]
              const sel = selected?.kind === 'device' && selected.id === p.device.id
              const colour = sel ? tokens.highlight : on === undefined ? tokens.border : on ? (type === 'light' ? LAMP : tokens.highlight) : tokens.idle
              const pos: [number, number, number] = [p.world[0], p.local[1], p.world[2]]
              const click = onDevice
                ? (e: ThreeEvent<MouseEvent>) => {
                    if (e.delta > 5) return
                    e.stopPropagation()
                    onDevice(p.device.id, p.room.id)
                  }
                : undefined
              return type === 'fan' ? (
                <Fan key={p.device.id} position={pos} colour={colour} spin={!!on && !reduced} onClick={click} />
              ) : (
                <Instance key={p.device.id} position={pos} color={colour} onClick={click} />
              )
            })}
          </Instances>
        )
      })}
    </>
  )
}

function Fan({ position, colour, spin, onClick }: { position: [number, number, number]; colour: string; spin: boolean; onClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const ref = useRef<THREE.Object3D>(null)
  useFrame((_, dt) => {
    if (spin && ref.current) ref.current.rotation.y += dt * 9
  })
  return <Instance ref={ref} position={position} color={colour} onClick={onClick} />
}

/** The real building's outline from OpenStreetMap, as a light shell around the rooms */
function Shell({ outline, model, tokens }: { outline: Outline; model: Model; tokens: Tokens }) {
  const b = model.buildings[0]
  const wide = b.max[0] - b.min[0] >= b.max[1] - b.min[1]
  const height = outline.heightM ?? (outline.levels ? outline.levels * 3.2 : model.top)
  const geo = useDisposable(() => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline.poly.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: height, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  }, [outline, height])
  return (
    <mesh geometry={geo} position={[(b.min[0] + b.max[0]) / 2, 0, (b.min[1] + b.max[1]) / 2]} rotation-y={wide ? 0 : Math.PI / 2} raycast={() => null}>
      <meshStandardMaterial color={tokens.highlight} transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
      <Edges color={tokens.highlight} />
    </mesh>
  )
}
