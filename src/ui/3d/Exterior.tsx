// The building as people see it from outside: a facade with glass bands and mullions, columns, a roof with
// a parapet and the AC condensers that serve the rooms below, an entrance canopy, and the site around it
// (paving, lawn, trees, a path, parking, benches). Everything is computed from the model, so it follows
// every edit. Decorative pieces use natural colours blended into the page background, so they sit
// quietly in both themes and never compete with the status colours.

import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BuildingFrame, Model, V2 } from './model'
import type { Tokens } from './Scene'

const EDGE = 0.45
const FACADE = 0.14
const MULLION_EVERY = 1.6

/** A natural colour pulled toward the page background, so it suits light and dark themes alike */
export const tint = (bg: string, natural: string, k = 0.55) => '#' + new THREE.Color(bg).lerp(new THREE.Color(natural), k).getHexString()

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rotY) g.rotateY(rotY)
  g.translate(x, y, z)
  return g
}

function merged(parts: THREE.BufferGeometry[]) {
  if (!parts.length) return null
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))
  parts.forEach((p) => p.dispose())
  return g
}

/** A small seeded random, so trees and cars stand in the same place on every visit */
function rng(seed: number) {
  let s = seed % 2147483647 || 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

interface Footprint {
  b: BuildingFrame
  min: V2
  max: V2
  floors: { y: number; h: number }[]
}

function footprints(model: Model): Footprint[] {
  return model.buildings.map((b) => {
    const floors = model.floors.filter((f) => f.building === b.name && f.y >= 0).map((f) => ({ y: f.y, h: f.h }))
    return { b, min: [b.min[0] - EDGE, b.min[1] - EDGE], max: [b.max[0] + EDGE, b.max[1] + EDGE], floors }
  })
}

/** Facade, columns, roof and canopy of every building, as three merged meshes per building */
function Shell({ fp, tokens, acs }: { fp: Footprint; tokens: Tokens; acs: number }) {
  const geo = useMemo(() => {
    const solid: THREE.BufferGeometry[] = []
    const glass: THREE.BufferGeometry[] = []
    const frame: THREE.BufferGeometry[] = []
    const [x0, z0] = fp.min
    const [x1, z1] = fp.max
    const W = x1 - x0
    const D = z1 - z0
    const sides: { a: V2; b: V2 }[] = [
      { a: [x0, z1], b: [x1, z1] },
      { a: [x1, z0], b: [x0, z0] },
      { a: [x0, z0], b: [x0, z1] },
      { a: [x1, z1], b: [x1, z0] },
    ]
    for (const f of fp.floors) {
      const sill = Math.min(0.9, f.h * 0.3)
      const head = Math.min(0.45, f.h * 0.15)
      for (const { a, b } of sides) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        const rot = -Math.atan2(b[1] - a[1], b[0] - a[0])
        const cx = (a[0] + b[0]) / 2
        const cz = (a[1] + b[1]) / 2
        solid.push(box(len + FACADE, sill, FACADE, cx, f.y + sill / 2, cz, rot))
        solid.push(box(len + FACADE, head, FACADE, cx, f.y + f.h - head / 2, cz, rot))
        glass.push(box(len, f.h - sill - head, FACADE / 3, cx, f.y + sill + (f.h - sill - head) / 2, cz, rot))
        const n = Math.max(1, Math.round(len / MULLION_EVERY))
        for (let i = 1; i < n; i++) {
          const t = i / n
          frame.push(box(0.07, f.h - sill - head, FACADE * 1.3, a[0] + (b[0] - a[0]) * t, f.y + sill + (f.h - sill - head) / 2, a[1] + (b[1] - a[1]) * t, rot))
        }
      }
    }
    const top = fp.floors.length ? Math.max(...fp.floors.map((f) => f.y + f.h)) : 3
    // Columns at the corners and along the long sides.
    const posts: V2[] = [fp.min, [x1, z0], fp.max, [x0, z1]]
    for (let x = x0 + 7.5; x < x1 - 3; x += 7.5) posts.push([x, z0], [x, z1])
    for (const [px, pz] of posts) frame.push(box(0.4, top + 0.6, 0.4, px, (top + 0.6) / 2 - 0.3, pz))
    // Roof slab and parapet.
    solid.push(box(W + 0.3, 0.3, D + 0.3, (x0 + x1) / 2, top + 0.15, (z0 + z1) / 2))
    for (const { a, b } of sides) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      solid.push(box(len + 0.3, 0.9, 0.18, (a[0] + b[0]) / 2, top + 0.75, (a[1] + b[1]) / 2, -Math.atan2(b[1] - a[1], b[0] - a[0])))
    }
    // Stair and lift core head on the roof.
    solid.push(box(Math.min(5, W * 0.25), 2.6, Math.min(4, D * 0.4), x0 + Math.min(5, W * 0.25) / 2 + 1, top + 1.6, z0 + Math.min(4, D * 0.4) / 2 + 1))
    // Entrance canopy, centred on the front (south) side.
    const ex = (x0 + x1) / 2
    solid.push(box(Math.min(6, W * 0.4), 0.22, 2.6, ex, Math.min(3.2, fp.floors[0]?.h ?? 3) + 0.1, z1 + 1.3))
    for (const s of [-1, 1]) frame.push(box(0.16, 3.2, 0.16, ex + s * (Math.min(6, W * 0.4) / 2 - 0.3), 1.6, z1 + 2.4))
    return { solid: merged(solid), glass: merged(glass), frame: merged(frame), top }
  }, [fp])

  // One condenser on the roof for every two ACs in the building, in tidy rows.
  const units = useMemo(() => {
    const n = Math.min(60, Math.ceil(acs / 2))
    const [x0, z0] = fp.min
    const [x1, z1] = fp.max
    const cols = Math.max(1, Math.floor((x1 - x0 - 8) / 1.5))
    return Array.from({ length: n }, (_, i): [number, number, number] => [x1 - 1.2 - (i % cols) * 1.5, geo.top + 0.75, z1 - 1.5 - Math.floor(i / cols) * 1.6]).filter(([, , z]) => z > z0 + 0.8)
  }, [acs, fp, geo.top])

  const wall = tint(tokens.bg, '#e8e2d6', 0.85)
  return (
    <group name="Facade" raycast={() => null}>
      {geo.solid && (
        <mesh geometry={geo.solid} castShadow receiveShadow raycast={() => null}>
          <meshStandardMaterial color={wall} roughness={0.9} />
        </mesh>
      )}
      {geo.glass && (
        <mesh geometry={geo.glass} raycast={() => null}>
          <meshStandardMaterial color={tint(tokens.bg, '#8fb3c7', 0.7)} transparent opacity={0.28} roughness={0.05} metalness={0.4} depthWrite={false} />
        </mesh>
      )}
      {geo.frame && (
        <mesh geometry={geo.frame} castShadow raycast={() => null}>
          <meshStandardMaterial color={tint(tokens.bg, '#5d5a55', 0.75)} roughness={0.5} metalness={0.3} />
        </mesh>
      )}
      {units.length > 0 && (
        <Instances limit={units.length} range={units.length}>
          <boxGeometry args={[1.1, 0.9, 0.9]} />
          <meshStandardMaterial color={tint(tokens.bg, '#d9d6cf', 0.9)} roughness={0.6} />
          {units.map((p, i) => (
            <Instance key={i} position={p} />
          ))}
        </Instances>
      )}
      {units.length > 0 && (
        <Instances limit={units.length} range={units.length}>
          <cylinderGeometry args={[0.3, 0.3, 0.04, 20]} />
          <meshStandardMaterial color={tint(tokens.bg, '#3c3a37', 0.85)} />
          {units.map(([x, y, z], i) => (
            <Instance key={i} position={[x, y + 0.47, z]} />
          ))}
        </Instances>
      )}
    </group>
  )
}

/** Paving, lawn, a path to the entrance, parking, trees and benches around the buildings */
function Grounds({ model, tokens }: { model: Model; tokens: Tokens }) {
  const g = useMemo(() => {
    const fps = footprints(model)
    const min: V2 = [Math.min(...fps.map((f) => f.min[0])), Math.min(...fps.map((f) => f.min[1]))]
    const max: V2 = [Math.max(...fps.map((f) => f.max[0])), Math.max(...fps.map((f) => f.max[1]))]
    const r = rng(Math.round((max[0] - min[0]) * 100 + (max[1] - min[1])))
    const pave = 4
    const lawn = 16
    // Parking bays on the west side; cars in some of them.
    const bays: [number, number][] = []
    const px = min[0] - pave - 6
    for (let z = min[1]; z < max[1] - 2.5; z += 2.7) bays.push([px, z + 1.35])
    const cars = bays.filter(() => r() < 0.55)
    // Trees around the lawn's edge, leaving the front path and the parking clear.
    const trees: [number, number, number][] = []
    const ring = [min[0] - lawn + 2, min[1] - lawn + 2, max[0] + lawn - 2, max[1] + lawn - 2]
    const pathX = (min[0] + max[0]) / 2
    for (let x = ring[0]; x <= ring[2]; x += 5 + r() * 3) {
      if (Math.abs(x - pathX) > 3.5) trees.push([x + r() - 0.5, ring[3] + r() - 0.5, 0.8 + r() * 0.5])
      trees.push([x + r() - 0.5, ring[1] + r() - 0.5, 0.8 + r() * 0.5])
    }
    for (let z = ring[1] + 5; z <= ring[3] - 5; z += 5 + r() * 3) trees.push([ring[2] + r() - 0.5, z, 0.8 + r() * 0.5])
    const benches: [number, number][] = [
      [pathX - 4, max[1] + pave - 1],
      [pathX + 4, max[1] + pave - 1],
    ]
    return { min, max, pave, lawn, bays, cars, trees, pathX, px, benches }
  }, [model])

  const { min, max, pave, lawn } = g
  const cx = (min[0] + max[0]) / 2
  const cz = (min[1] + max[1]) / 2
  const carColours = ['#8a9aa8', '#b8b2a6', '#6f6a64', '#a35d4a']
  return (
    <group name="Grounds" raycast={() => null}>
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.06, cz]} receiveShadow raycast={() => null}>
        <planeGeometry args={[max[0] - min[0] + lawn * 2, max[1] - min[1] + lawn * 2]} />
        <meshStandardMaterial color={tint(tokens.bg, '#a9c08c', 0.45)} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.04, cz]} receiveShadow raycast={() => null}>
        <planeGeometry args={[max[0] - min[0] + pave * 2, max[1] - min[1] + pave * 2]} />
        <meshStandardMaterial color={tint(tokens.bg, '#d6d0c4', 0.6)} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[g.pathX, -0.035, max[1] + pave + (lawn - pave) / 2]} receiveShadow raycast={() => null}>
        <planeGeometry args={[2.6, lawn - pave]} />
        <meshStandardMaterial color={tint(tokens.bg, '#d6d0c4', 0.6)} roughness={1} />
      </mesh>
      {/* Parking lot with bay lines. */}
      <mesh rotation-x={-Math.PI / 2} position={[g.px, -0.035, cz]} receiveShadow raycast={() => null}>
        <planeGeometry args={[6, max[1] - min[1] + 1]} />
        <meshStandardMaterial color={tint(tokens.bg, '#7d7a75', 0.45)} roughness={1} />
      </mesh>
      {g.bays.length > 0 && (
        <Instances limit={g.bays.length} range={g.bays.length}>
          <boxGeometry args={[4.6, 0.01, 0.08]} />
          <meshBasicMaterial color={tint(tokens.bg, '#ffffff', 0.7)} />
          {g.bays.map(([x, z], i) => (
            <Instance key={i} position={[x, -0.025, z - 1.35]} />
          ))}
        </Instances>
      )}
      {g.cars.length > 0 && (
        <Instances limit={g.cars.length} range={g.cars.length} castShadow>
          <boxGeometry args={[4.2, 1.2, 1.8]} />
          <meshStandardMaterial roughness={0.4} metalness={0.3} />
          {g.cars.map(([x, z], i) => (
            <Instance key={i} position={[x, 0.6, z]} color={tint(tokens.bg, carColours[i % carColours.length], 0.8)} />
          ))}
        </Instances>
      )}
      {g.trees.length > 0 && (
        <>
          <Instances limit={g.trees.length} range={g.trees.length} castShadow>
            <cylinderGeometry args={[0.15, 0.22, 2.2, 8]} />
            <meshStandardMaterial color={tint(tokens.bg, '#7a5c43', 0.7)} roughness={1} />
            {g.trees.map(([x, z, s], i) => (
              <Instance key={i} position={[x, 1.1 * s, z]} scale={s} />
            ))}
          </Instances>
          <Instances limit={g.trees.length} range={g.trees.length} castShadow>
            <icosahedronGeometry args={[1.6, 1]} />
            <meshStandardMaterial color={tint(tokens.bg, '#5f8a4e', 0.7)} roughness={0.9} flatShading />
            {g.trees.map(([x, z, s], i) => (
              <Instance key={i} position={[x, 3 * s, z]} scale={s} />
            ))}
          </Instances>
        </>
      )}
      {g.benches.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.25, z]} castShadow raycast={() => null}>
          <boxGeometry args={[1.8, 0.5, 0.5]} />
          <meshStandardMaterial color={tint(tokens.bg, '#8a6e55', 0.7)} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * `envelope` draws the facade and roof; it is off when the view looks inside (one floor, exploded or walking).
 * `acs` counts the ACs of each building, for the condensers on its roof.
 */
export function Exterior({ model, tokens, envelope, acs }: { model: Model; tokens: Tokens; envelope: boolean; acs: Record<string, number> }) {
  const fps = useMemo(() => footprints(model), [model])
  return (
    <>
      <Grounds model={model} tokens={tokens} />
      {envelope && fps.map((fp) => <Shell key={fp.b.name || 'main'} fp={fp} tokens={tokens} acs={acs[fp.b.name] ?? 0} />)}
    </>
  )
}
