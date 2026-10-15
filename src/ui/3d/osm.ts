// The real building's outline from OpenStreetMap (Overpass API, free, no key; ODbL: "Map data OpenStreetMap contributors").
// The search point comes from an address (Nominatim) or typed coordinates, because the site's location is a city.

import { inPoly, type V2 } from './model'

export interface Outline {
  osmId: number
  name: string | null
  /** Metres around the polygon's own centre, turned so its longest side runs along x */
  poly: V2[]
  levels: number | null
  heightM: number | null
}

interface OverpassWay {
  type: string
  id: number
  tags?: Record<string, string | undefined>
  geometry?: { lat: number; lon: number }[]
}

const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON = 111_320

/** Degrees to metres around a point: east is +x, north is -z (north up in the plan view) */
const project = (lat0: number, lon0: number) => (lat: number, lon: number): V2 => [
  (lon - lon0) * Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LON,
  -(lat - lat0) * M_PER_DEG_LAT,
]

const centroid = (p: V2[]): V2 => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length]

/** Turns a polygon about its centre so its longest edge lies along x, and centres it on the origin */
export function alignToX(p: V2[]): V2[] {
  let best = 0
  let angle = 0
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l > best) [best, angle] = [l, Math.atan2(b[1] - a[1], b[0] - a[0])]
  })
  const [cx, cz] = centroid(p)
  const [c, s] = [Math.cos(-angle), Math.sin(-angle)]
  const r = (x: number, z: number): V2 => [Math.round((x * c - z * s) * 100) / 100, Math.round((x * s + z * c) * 100) / 100]
  return p.map(([x, z]) => r(x - cx, z - cz))
}

/** Picks the building that contains the point, else the nearest one; null when there is none */
export function parseOverpass(json: { elements?: OverpassWay[] }, lat: number, lon: number): Outline | null {
  const toM = project(lat, lon)
  const ways = (json.elements ?? [])
    .filter((e) => e.type === 'way' && e.tags?.building && (e.geometry?.length ?? 0) >= 4)
    .map((e) => {
      const pts = e.geometry!.map((g) => toM(g.lat, g.lon))
      // A closed way repeats its first point at the end.
      const poly = pts.slice(0, -1)
      return { e, poly, d: Math.hypot(...centroid(poly)), hit: inPoly([0, 0], poly) }
    })
    .sort((a, b) => Number(b.hit) - Number(a.hit) || a.d - b.d)
  const w = ways[0]
  if (!w) return null
  const num = (v?: string) => {
    const n = Number.parseFloat(v ?? '')
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const tags = w.e.tags!
  return { osmId: w.e.id, name: tags.name ?? null, poly: alignToX(w.poly), levels: num(tags['building:levels']), heightM: num(tags.height) }
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']

export async function fetchOutline(lat: number, lon: number, signal?: AbortSignal): Promise<Outline | null> {
  const q = `[out:json][timeout:20];way(around:40,${lat},${lon})[building];out tags geom;`
  let status = 0
  // The public servers are often at capacity; the next one in the list is tried.
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal })
      if (res.ok) return parseOverpass(await res.json(), lat, lon)
      status = res.status
    } catch (e) {
      if (signal?.aborted) throw e
    }
  }
  throw new Error(status ? `OpenStreetMap servers are busy (${status}); try again in a minute` : 'OpenStreetMap could not be reached')
}

/** "12.97, 77.59" is used as typed; anything else is looked up as an address */
export async function findPlace(text: string, signal?: AbortSignal): Promise<{ lat: number; lon: number; label: string } | null> {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (m) return { lat: Number(m[1]), lon: Number(m[2]), label: `${m[1]}, ${m[2]}` }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`, { signal })
  if (!res.ok) throw new Error(`Address search answered ${res.status}`)
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[]
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name } : null
}
