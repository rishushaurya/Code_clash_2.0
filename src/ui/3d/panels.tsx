// Floating panels of the 3D view. They render inside the view, not in a portal, so they stay visible in full screen.

import { useRef, useState, type ReactNode } from 'react'
import { Building2, Camera, Check, Loader2, MapPin, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Site } from '@/shared/types'
import { apiFetch } from '@/shared/workspace'
import { bbox, polyArea } from './model'
import { fetchOutline, findPlace, type Outline } from './osm'

export function Panel({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('pointer-events-auto max-h-full overflow-y-auto rounded-xl border bg-card/95 p-4 text-sm shadow-[var(--shadow-card)] backdrop-blur', className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
          <X />
        </Button>
      </div>
      {children}
    </section>
  )
}

/** Look up the real building on OpenStreetMap and show its outline around the rooms */
export function OutlinePanel({ site, outline, onOutline, onGenerate, onClose }: { site: Site; outline: Outline | null; onOutline: (o: Outline | null) => void; onGenerate: (o: Outline, levels: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [levels, setLevels] = useState<number | null>(null)
  const [state, setState] = useState<{ busy?: boolean; error?: string; found?: Outline; place?: string }>({})
  async function find() {
    setState({ busy: true })
    try {
      const place = await findPlace(query)
      if (!place) return setState({ error: 'No place found for that address. Try the coordinates from your map app, for example 12.9716, 77.5946.' })
      const found = await fetchOutline(place.lat, place.lon)
      if (!found) return setState({ error: `OpenStreetMap has no building outline within 40 m of ${place.label}.` })
      setState({ found, place: place.label })
    } catch (e) {
      setState({ error: `The lookup failed: ${e instanceof Error ? e.message : String(e)}.` })
    }
  }
  const size = (o: Outline) => {
    const b = bbox(o.poly)
    return `${Math.round(b.max[0] - b.min[0])} x ${Math.round(b.max[1] - b.min[1])} m, ${Math.round(polyArea(o.poly))} m² footprint`
  }
  return (
    <Panel title="Real building outline" onClose={onClose} className="w-80">
      <p className="mb-3 text-muted-foreground">
        Find {site.buildingName || 'your building'} on OpenStreetMap. Its footprint and number of floors are drawn as a shell around your rooms.
      </p>
      {outline && (
        <div className="mb-3 rounded-lg bg-muted p-2">
          <p className="font-medium">{outline.name ?? 'Building'} is shown</p>
          <p className="text-muted-foreground">{size(outline)}{outline.levels ? `, ${outline.levels} floors` : ', floors not recorded'}</p>
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => onOutline(null)}>
            <Trash2 /> Remove outline
          </Button>
          <div className="mt-2 flex items-end gap-2 border-t pt-2">
            <div className="space-y-1">
              <Label htmlFor="osm-levels" className="text-xs">
                Floors
              </Label>
              <Input id="osm-levels" type="number" min={1} max={30} className="h-8 w-20" value={levels ?? outline.levels ?? 2} onChange={(e) => setLevels(Number(e.target.value) || 1)} />
            </div>
            <Button size="sm" className="flex-1" onClick={() => onGenerate(outline, Math.min(30, Math.max(1, levels ?? outline.levels ?? 2)))}>
              <Building2 /> Generate the building
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Builds floors and rooms inside this outline as a starting point. You review it before saving.</p>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void find()
        }}
        className="space-y-2"
      >
        <Label htmlFor="osm-place">Address or coordinates</Label>
        <Input id="osm-place" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={site.location ? `Street, ${site.location.name}` : 'Street and city, or 12.97, 77.59'} />
        <Button type="submit" disabled={!query.trim() || state.busy} className="w-full">
          {state.busy ? <Loader2 className="animate-spin" /> : <Search />} Find the building
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="mt-2 text-waste">
          {state.error}
        </p>
      )}
      {state.found && (
        <div className="mt-3 space-y-2 rounded-lg border p-2" role="status">
          <p className="flex items-start gap-1.5 font-medium">
            <MapPin className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden />
            {state.found.name ?? 'Building'} near {state.place}
          </p>
          <p className="text-muted-foreground">
            {size(state.found)}
            {state.found.levels ? `, ${state.found.levels} floors` : ', floors not recorded'}
            {state.found.heightM ? `, ${state.found.heightM} m tall` : ''}
          </p>
          <Button
            className="w-full"
            onClick={() => {
              onOutline(state.found!)
              setState({})
            }}
          >
            <Check /> Show as the building shell
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Map data OpenStreetMap contributors (ODbL). Saved with the site, so every device shows it.
      </p>
    </Panel>
  )
}

/** The answer of POST /api/ai/floorplan (api/_routes/ai/floorplan.ts): rectangles as fractions of the photo */
export interface FloorplanProposal {
  floors: { name: string; rooms: { name: string; x: number; y: number; w: number; h: number }[] }[]
}

/** Shrinks a photo so the upload stays small; the picture itself is never stored */
export async function toDataUrl(file: File, max = 1600): Promise<{ url: string; w: number; h: number }> {
  const img = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) })
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  img.close()
  return { url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Rooms read from a photo replace the shapes of the matching rooms. Each floor's rooms are fitted into the
 * 1000 x 600 floor plan keeping the photo's proportions. Rooms are matched, never created: seats, area and
 * devices come from Site setup.
 */
export function applyFloorplan(site: Site, p: FloorplanProposal, photo: { w: number; h: number }, floorFor: number[], match: Record<string, string>): Site {
  const shapes = new Map<string, [number, number][]>()
  p.floors.forEach((f, fi) => {
    if (floorFor[fi] === undefined) return
    const picked = f.rooms.map((r, ri) => ({ r, id: match[`${fi}-${ri}`] })).filter((x) => x.id)
    if (!picked.length) return
    const px = picked.map(({ r }) => [r.x * photo.w, r.y * photo.h, (r.x + r.w) * photo.w, (r.y + r.h) * photo.h])
    const x0 = Math.min(...px.map((q) => q[0]))
    const y0 = Math.min(...px.map((q) => q[1]))
    const k = Math.min(960 / (Math.max(...px.map((q) => q[2])) - x0), 560 / (Math.max(...px.map((q) => q[3])) - y0))
    picked.forEach(({ id }, i) => {
      const [a, b, c, d] = px[i].map((v, j) => Math.round((20 + (v - (j % 2 ? y0 : x0)) * k) * 10) / 10)
      shapes.set(id, [[a, b], [c, b], [c, d], [a, d]])
    })
  })
  return { ...site, rooms: site.rooms.map((r) => (shapes.has(r.id) ? { ...r, polygon: shapes.get(r.id), autoLayout: undefined } : r)) }
}

/** Photograph the evacuation map; the AI proposes room rectangles; the person matches and confirms */
export function PhotoPanel({ site, onApply, onClose }: { site: Site; onApply: (next: Site, count: number) => void; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<{ url: string; w: number; h: number } | null>(null)
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({})
  const [proposal, setProposal] = useState<FloorplanProposal | null>(null)
  const [floorFor, setFloorFor] = useState<number[]>([])
  const [match, setMatch] = useState<Record<string, string>>({})

  async function read(f: File) {
    setProposal(null)
    setState({ busy: true })
    try {
      const pic = await toDataUrl(f)
      setPhoto(pic)
      const res = await apiFetch('/api/ai/floorplan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: pic.url }) })
      if (!res.ok) {
        // The route answers { error, code? }: 503 no-key when no vision key is set, 429 when called too often.
        const { error, code } = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
        return setState({
          error:
            code === 'no-key'
              ? 'No AI key can read photos yet. Add one in Settings, Keys and AI.'
              : res.status === 429
                ? 'Too many photos in a row. Wait a minute and try again.'
                : `The AI could not read the plan${error ? `: ${error}` : ` (${res.status})`}. Try a straighter, brighter photo.`,
        })
      }
      const p = (await res.json()) as FloorplanProposal
      if (!p.floors?.some((x) => x.rooms.length)) return setState({ error: 'No rooms were found in this photo. Try a closer, straighter photo of the plan.' })
      // Floors match by name, else by order; rooms by id or name on that floor.
      const levels = p.floors.map((f, i) => (site.floors.find((s) => norm(s.name) === norm(f.name)) ?? site.floors[i])?.level ?? -999)
      setFloorFor(levels)
      setMatch(
        Object.fromEntries(
          p.floors.flatMap((f, fi) =>
            f.rooms.map((r, ri) => [`${fi}-${ri}`, site.rooms.find((x) => x.floor === levels[fi] && (norm(x.id) === norm(r.name) || norm(x.name) === norm(r.name)))?.id ?? '']),
          ),
        ),
      )
      setProposal(p)
      setState({})
    } catch (e) {
      setState({ error: `The photo could not be read: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const chosen = Object.values(match).filter(Boolean).length
  return (
    <Panel title="Floor plan from a photo" onClose={onClose} className="w-[min(40rem,calc(100vw-2rem))]">
      <p className="mb-3 text-muted-foreground">Photograph the evacuation map on the wall. The AI proposes the rooms; you match them to your rooms and confirm. The photo is not stored.</p>
      <input ref={file} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      <Button onClick={() => file.current?.click()} disabled={state.busy}>
        {state.busy ? <Loader2 className="animate-spin" /> : <Camera />} {photo ? 'Choose another photo' : 'Take or choose a photo'}
      </Button>
      {state.busy && <p className="mt-2 text-muted-foreground" role="status">Reading the plan...</p>}
      {state.error && (
        <p role="alert" className="mt-2 text-waste">
          {state.error}
        </p>
      )}
      {photo && proposal && (
        <div className="mt-3 space-y-3">
          <div className="relative overflow-hidden rounded-lg border">
            <img src={photo.url} alt="Your floor plan photo with the proposed rooms outlined" className="block w-full" />
            {proposal.floors.flatMap((f, fi) =>
              f.rooms.map((r, ri) => (
                <div
                  key={`${fi}-${ri}`}
                  className={cn('absolute border-2 text-[10px] font-semibold', match[`${fi}-${ri}`] ? 'border-highlight bg-highlight/15 text-highlight' : 'border-dashed border-muted-foreground text-muted-foreground')}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                >
                  <span className="bg-card/80 px-0.5">{r.name}</span>
                </div>
              )),
            )}
          </div>
          {proposal.floors.map((f, fi) => (
            <fieldset key={fi} className="space-y-1.5 rounded-lg border p-2">
              <legend className="px-1 font-medium">
                {f.name || `Floor ${fi + 1}`} is{' '}
                <select
                  aria-label={`Site floor for ${f.name || `floor ${fi + 1}`}`}
                  className="rounded border bg-background px-1"
                  value={floorFor[fi]}
                  onChange={(e) => setFloorFor((x) => x.map((v, i) => (i === fi ? Number(e.target.value) : v)))}
                >
                  <option value={-999}>not used</option>
                  {site.floors.map((s) => (
                    <option key={s.level} value={s.level}>
                      {s.building ? `${s.building}, ` : ''}
                      {s.name}
                    </option>
                  ))}
                </select>
              </legend>
              {f.rooms.map((r, ri) => (
                <label key={ri} className="flex items-center justify-between gap-2">
                  <span>{r.name}</span>
                  <select className="rounded border bg-background px-1" value={match[`${fi}-${ri}`]} onChange={(e) => setMatch((m) => ({ ...m, [`${fi}-${ri}`]: e.target.value }))}>
                    <option value="">skip</option>
                    {site.rooms
                      .filter((x) => x.floor === floorFor[fi])
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.id} {x.name !== x.id ? x.name : ''}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </fieldset>
          ))}
          <p className="text-muted-foreground">Rooms not in your site are skipped; add them in Site setup first. Areas and devices stay as they are.</p>
          <Button
            disabled={!chosen}
            onClick={() => onApply(applyFloorplan(site, proposal, photo, floorFor.map((l) => (l === -999 ? (undefined as unknown as number) : l)), match), chosen)}
          >
            <Check /> Use these shapes for {chosen} room{chosen === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </Panel>
  )
}
