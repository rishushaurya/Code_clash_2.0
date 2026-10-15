// Inside the rooms: each room's floor in its own colour, and its furniture. Furniture is the room's own list
// when it has one (placed by a person or the AI designer), otherwise a tidy layout for its type. It is
// drawn with one instanced mesh per kind, so a building full of desks stays fast.

import { useEffect, useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { FurnitureKind, Room } from '@/shared/types'
import { arrangeFurniture } from './design'
import { tint } from './Exterior'
import type { FloorGeo, V2 } from './model'
import type { Tokens } from './Scene'

/** A flat shape from a polygon in world x/z, lying on y = 0 */
export function flat(poly: V2[]) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))))
  g.rotateX(-Math.PI / 2)
  return g
}

const part = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed()

function join(...parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return g
}

/** Simple, recognisable shapes, centred on their spot, front facing -z (toward the board) */
const SHAPES: Record<FurnitureKind, () => THREE.BufferGeometry> = {
  desk: () => join(part(1.2, 0.04, 0.6, 0, 0.74), part(0.05, 0.72, 0.55, -0.55, 0.36), part(0.05, 0.72, 0.55, 0.55, 0.36), part(0.42, 0.04, 0.42, 0, 0.45, 0.55), part(0.42, 0.42, 0.04, 0, 0.66, 0.76)),
  chair: () => join(part(0.45, 0.04, 0.45, 0, 0.45), part(0.45, 0.45, 0.04, 0, 0.67, 0.21), part(0.04, 0.43, 0.04, -0.2, 0.22, -0.2), part(0.04, 0.43, 0.04, 0.2, 0.22, -0.2)),
  table: () => join(part(2.6, 0.05, 1.2, 0, 0.74), part(0.1, 0.72, 0.1, -1.1, 0.36, -0.45), part(0.1, 0.72, 0.1, 1.1, 0.36, -0.45), part(0.1, 0.72, 0.1, -1.1, 0.36, 0.45), part(0.1, 0.72, 0.1, 1.1, 0.36, 0.45)),
  bench: () => join(part(1.8, 0.05, 0.8, 0, 0.9), part(1.8, 0.85, 0.75, 0, 0.43)),
  board: () => join(part(2.6, 1.2, 0.04, 0, 1.6), part(2.7, 0.06, 0.1, 0, 0.98)),
  sofa: () => join(part(2, 0.42, 0.85, 0, 0.21), part(2, 0.45, 0.2, 0, 0.62, 0.33), part(0.2, 0.3, 0.85, -0.9, 0.57), part(0.2, 0.3, 0.85, 0.9, 0.57)),
  shelf: () => join(part(1, 2, 0.38, 0, 1), part(0.96, 0.03, 0.34, 0, 0.7, 0.02), part(0.96, 0.03, 0.34, 0, 1.35, 0.02)),
  plant: () => join(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 12).translate(0, 0.2, 0).toNonIndexed(), new THREE.IcosahedronGeometry(0.42, 1).translate(0, 0.8, 0).toNonIndexed()),
  podium: () => join(part(0.7, 1.1, 0.5, 0, 0.55), part(0.75, 0.04, 0.55, 0, 1.12)),
  bed: () => join(part(1, 0.45, 2, 0, 0.23), part(1, 0.6, 0.06, 0, 0.5, -0.97)),
}

const WOOD: Partial<Record<FurnitureKind, string>> = { desk: '#b88b5e', table: '#9c7350', bench: '#d9d4cb', board: '#f4f4f1', sofa: '#7d8f9b', shelf: '#a98161', plant: '#5f8a4e', podium: '#8c6a4c', chair: '#4f5b66', bed: '#c9c2b6' }

export interface Placement {
  roomId: string
  kind: FurnitureKind
  pos: [number, number, number]
  rot: number
  colour: string
}

/** Every piece of furniture on a floor, in world space */
export function placeFurniture(floor: FloorGeo, rooms: Room[], tokens: Tokens): Placement[] {
  return floor.rooms.flatMap((g) => {
    const room = rooms.find((r) => r.id === g.id)
    if (!room) return []
    const list = room.furniture ?? arrangeFurniture(room.type, g.size[0], g.size[1])
    return list.map((f) => ({
      roomId: g.id,
      kind: f.kind,
      pos: [g.origin[0] + f.x, 0.01, g.origin[1] + f.z] as [number, number, number],
      rot: f.rot,
      colour: tint(tokens.bg, f.kind === 'board' || f.kind === 'plant' ? WOOD[f.kind]! : (room.style?.accent ?? WOOD[f.kind] ?? '#a0896f'), 0.85),
    }))
  })
}

export function Furnishings({ floor, rooms, tokens }: { floor: FloorGeo; rooms: Room[]; tokens: Tokens }) {
  const shapes = useMemo(() => Object.fromEntries((Object.keys(SHAPES) as FurnitureKind[]).map((k) => [k, SHAPES[k]()])) as Record<FurnitureKind, THREE.BufferGeometry>, [])
  useEffect(() => () => Object.values(shapes).forEach((g) => g.dispose()), [shapes])
  const byKind = useMemo(() => {
    const m = new Map<FurnitureKind, Placement[]>()
    for (const p of placeFurniture(floor, rooms, tokens)) m.set(p.kind, [...(m.get(p.kind) ?? []), p])
    return m
  }, [floor, rooms, tokens])
  return (
    <group name="Furniture" raycast={() => null}>
      {[...byKind].map(([kind, list]) => (
        <Instances key={kind} geometry={shapes[kind]} limit={list.length} range={list.length} castShadow receiveShadow>
          <meshStandardMaterial roughness={0.75} flatShading={kind === 'plant'} />
          {list.map((p, i) => (
            <Instance key={i} position={p.pos} rotation-y={p.rot} color={p.colour} />
          ))}
        </Instances>
      ))}
    </group>
  )
}

/** Each room's floor in its own colour, under the live status tint */
export function RoomFloors({ floor, rooms, tokens }: { floor: FloorGeo; rooms: Room[]; tokens: Tokens }) {
  const geos = useMemo(() => floor.rooms.map((g) => ({ id: g.id, geo: flat(g.poly) })), [floor])
  useEffect(() => () => geos.forEach((g) => g.geo.dispose()), [geos])
  return (
    <>
      {geos.map(({ id, geo }) => (
        <mesh key={id} geometry={geo} position-y={0.004} receiveShadow raycast={() => null}>
          <meshStandardMaterial color={rooms.find((r) => r.id === id)?.style?.floor ?? tint(tokens.bg, '#d8cdbb', 0.35)} roughness={0.9} />
        </mesh>
      ))}
    </>
  )
}
