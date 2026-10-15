// /settings/site  Onboard any building: site details, money settings, automation, floors, rooms and devices.
// Edits are a draft until saved; the draft survives a reload so nobody types a building twice.

import { Bell, Building2, Camera, Clock, Coins, DoorOpen, Download, Layers, MapPin, Plus, RotateCcw, Save, Timer, Trash2, Upload, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { WATTS } from '@/shared/config'
import { COUNTRY_PRESETS, deviceCounts, emptySite, makeDevices, parseSite, pushSite, ROOM_TEMPLATES, setSite, SiteSchema, useSite } from '@/shared/site'
import { send } from '@/twin/realtime'
import { ns, online } from '@/shared/workspace'
import { AiSetup } from '@/ui/components/AiSetup'
import type { AlertLanguage, DeviceType, Room, RoomType, Site } from '@/shared/types'
import { clearUsage, observedLeftOnShare, observedOpenHours } from '@/twin/usage'
import { PageHeader } from '../components/states'
import { useScrollToHash } from '../nav'

const DRAFT_KEY = ns('pratibimb:site-draft')
const TYPES: DeviceType[] = ['light', 'fan', 'ac', 'projector', 'pc']
const TYPE_NAMES: Record<DeviceType, string> = { light: 'Lights', fan: 'Fans', ac: 'ACs', projector: 'Projectors', pc: 'PCs' }
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY']
const LANGUAGES: { id: AlertLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'kn', label: 'Kannada' },
]
const CEILING_M = 3.2
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Place {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  country_code?: string
  admin1?: string
}

const num = (v: string, fallback = 0) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback)

function loadDraft(saved: Site): Site {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) {
      const parsed = SiteSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    }
  } catch {
    // Fall back to the saved site.
  }
  return saved
}

function newRoomId(type: RoomType, rooms: Room[]) {
  const prefix = { classroom: 'CR', lecture_hall: 'LH', lab: 'LAB', office: 'OFF', meeting: 'MR', other: 'SP' }[type]
  let i = 1
  while (rooms.some((r) => r.id === `${prefix}-${i}`)) i++
  return `${prefix}-${i}`
}

function LocationSearch({ value, onPick }: { value: Site['location']; onPick: (p: Place) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const query = q.trim()
  useEffect(() => {
    if (query.length < 2) return
    // Debounced: search 300 ms after the last keystroke.
    const t = setTimeout(() => {
      setState('loading')
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`)
        .then((r) => r.json())
        .then((d: { results?: Place[] }) => {
          setResults(d.results ?? [])
          setState('idle')
        })
        .catch(() => setState('error'))
    }, 300)
    return () => clearTimeout(t)
  }, [query])
  const shown = query.length < 2 ? [] : results

  return (
    <div className="space-y-2">
      <Label htmlFor="place">City or campus location</Label>
      <Input id="place" value={q} onChange={(e) => setQ(e.target.value)} placeholder={value?.name ?? 'Search a city, for example Bengaluru'} autoComplete="off" />
      {state === 'error' && <p className="text-xs text-waste">Location search is offline. You can still save the rest.</p>}
      {shown.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card" role="listbox" aria-label="Places">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPick(p)
                  setQ('')
                  setResults([])
                }}
              >
                <MapPin className="size-4 text-highlight" aria-hidden />
                {[p.name, p.admin1, p.country].filter(Boolean).join(', ')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && (
        <p className="num text-xs text-muted-foreground">
          {value.name} · {value.lat.toFixed(3)}, {value.lon.toFixed(3)} · used for daylight and outdoor air advice
        </p>
      )}
    </div>
  )
}

const SECTIONS = [
  { id: 'building', label: 'Building' },
  { id: 'money', label: 'Money and emissions' },
  { id: 'automation', label: 'Automation' },
  { id: 'hours', label: 'Opening hours' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'floors', label: 'Floors' },
  { id: 'rooms', label: 'Rooms and devices' },
  { id: 'ratings', label: 'Device ratings' },
  { id: 'start-over', label: 'Start over' },
]

function Section({ id, icon: Icon, title, description, action, children }: { id: string; icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card id={id} tabIndex={-1} className="scroll-mt-20 outline-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="size-4" aria-hidden />} {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// Every ISO 4217 code the browser knows, so any country's currency can be chosen.
const ALL_CURRENCIES: string[] = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency') ?? CURRENCIES

export default function SiteSettings() {
  const saved = useSite((s) => s.site)
  const [draft, setDraft] = useState<Site>(() => loadDraft(saved))
  const [errors, setErrors] = useState('')
  const [currencyNote, setCurrencyNote] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const [observed] = useState(observedLeftOnShare)
  const [observedHours] = useState(observedOpenHours)
  useScrollToHash()

  // Keep the draft through reloads and failed saves; clear it once saved.
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      // Draft lasts for this page only.
    }
  }, [draft, dirty])

  const update = (patch: Partial<Site>) => setDraft((d) => ({ ...d, ...patch }))
  const updateRoom = (id: string, patch: Partial<Room>) => setDraft((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  const setCount = (room: Room, type: DeviceType, n: number) => {
    const counts = { ...deviceCounts(room), [type]: Math.max(0, Math.min(500, Math.round(n))) }
    const ratings = Object.fromEntries(room.devices.map((d) => [d.type, d.ratedW]))
    updateRoom(room.id, { devices: makeDevices(room.id, counts, ratings) })
  }
  const setRating = (type: DeviceType, w: number) =>
    setDraft((d) => ({ ...d, rooms: d.rooms.map((r) => ({ ...r, devices: r.devices.map((dev) => (dev.type === type ? { ...dev, ratedW: Math.max(0, w) } : dev)) })) }))
  const rating = (type: DeviceType) => draft.rooms.flatMap((r) => r.devices).find((d) => d.type === type)?.ratedW ?? WATTS[type]

  function addRoom(type: RoomType) {
    const t = ROOM_TEMPLATES[type]
    const id = newRoomId(type, draft.rooms)
    const room: Room = {
      id,
      name: `${t.label} ${id.split('-')[1]}`,
      floor: draft.floors[0]?.level ?? 0,
      type,
      capacity: t.capacity,
      areaM2: t.areaM2,
      volumeM3: t.areaM2 * CEILING_M,
      windowSide: true,
      devices: makeDevices(id, t.counts),
    }
    setDraft((d) => ({ ...d, rooms: [...d.rooms, room] }))
  }

  function save() {
    const next = draft
    const parsed = SiteSchema.safeParse(next)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      setErrors(`Check ${issue.path.join(' > ')}: ${issue.message}`)
      return
    }
    if (new Set(next.rooms.map((r) => r.id)).size !== next.rooms.length) return setErrors('Two rooms share an id. Every room id must be unique.')
    setErrors('')
    setSite(parsed.data)
    setDraft(useSite.getState().site)
    void pushSite(useSite.getState().site).then((where) => {
      // Open screens of the workspace fetch the new rooms at once.
      if (where === 'server') send('site', { ts: Date.now() })
      toast.success('Site saved', {
        description: where === 'server' ? 'Every device and camera of this workspace now uses these rooms.' : online() ? 'Saved on this device; it uploads when the server is reachable.' : 'Saved in this browser.',
      })
    })
  }

  function exportSite() {
    const blob = new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${(saved.buildingName || 'site').replace(/\W+/g, '-').toLowerCase()}.pratibimb.json` })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importSite(file: File) {
    const result = parseSite(await file.text())
    if (typeof result === 'string') return setErrors(result)
    setErrors('')
    setDraft(result)
    toast('Site file loaded', { description: 'Review it, then press Save.' })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Site" description="Describe your building once. Cameras, sensors and staff reports then fill it with live data.">
        <AiSetup draft={draft} onApply={setDraft} />
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import a site file" tabIndex={-1} onChange={(e) => e.target.files?.[0] && importSite(e.target.files[0])} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} title="Load a site file exported from Pratibimb or produced by your own system">
          <Upload aria-hidden /> Import
        </Button>
        <Button variant="outline" onClick={exportSite} disabled={!saved.rooms.length} title="Download this site as JSON, the integration format">
          <Download aria-hidden /> Export
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-0.5 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <Section id="building" icon={Building2} title="Building" description="The location sets the currency, typical tariff and grid factor, and the weather used for daylight and outdoor-air advice.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="org">Organization</Label>
                <Input id="org" value={draft.organization} onChange={(e) => update({ organization: e.target.value })} placeholder="For example, City Engineering College" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bname">Building</Label>
                <Input id="bname" value={draft.buildingName} onChange={(e) => update({ buildingName: e.target.value })} placeholder="For example, Main Block" />
              </div>
              <div className="sm:col-span-2">
                <LocationSearch
                  value={draft.location}
                  onPick={(p) => {
                    const preset = COUNTRY_PRESETS[p.country_code ?? '']
                    setCurrencyNote(preset ? `Set to ${preset.currency} for ${p.country}.` : `Pratibimb does not know the currency of ${p.country ?? 'this place'} yet. Choose it below.`)
                    update({
                      location: { name: [p.name, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude, countryCode: p.country_code },
                      ...(preset && { currency: preset.currency }),
                      ...(preset?.tariffPerKwh && !draft.tariffPerKwh && { tariffPerKwh: preset.tariffPerKwh }),
                      ...(preset?.gridKgPerKwh && !draft.gridKgPerKwh && { gridKgPerKwh: preset.gridKgPerKwh }),
                    })
                  }}
                />
              </div>
            </div>
          </Section>

          <Section id="money" icon={Coins} title="Money and emissions" description="From your electricity bill and your grid operator. Every cost and CO2 figure uses these.">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select value={draft.currency} onValueChange={(v) => update({ currency: v })}>
                  <SelectTrigger id="currency" aria-describedby="currency-note">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([draft.currency, ...CURRENCIES, ...ALL_CURRENCIES])].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="currency-note" className={`text-xs ${!draft.location ? 'text-warn' : 'text-muted-foreground'}`}>
                  {currencyNote || (draft.location ? `From ${draft.location.name}.` : 'Not set from a location yet: search the location above, or choose it here.')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tariff">Energy charge per kWh ({draft.currency})</Label>
                <Input id="tariff" className="num" type="number" min={0} step={0.01} value={draft.tariffPerKwh || ''} onChange={(e) => update({ tariffPerKwh: num(e.target.value) })} placeholder="From your electricity bill" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ef">Grid emission factor (kg CO2 per kWh)</Label>
                <Input id="ef" className="num" type="number" min={0} step={0.001} value={draft.gridKgPerKwh || ''} onChange={(e) => update({ gridKgPerKwh: num(e.target.value) })} placeholder="From your national grid authority" />
                <p className="text-xs text-muted-foreground">{COUNTRY_PRESETS[draft.location?.countryCode ?? '']?.source ?? 'From your grid operator or national greenhouse gas inventory.'}</p>
              </div>
            </div>
          </Section>

          <Section id="automation" icon={Timer} title="Automation" description="When a room counts as empty, and what the twin does about it.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="delay">Room counts as empty after (seconds)</Label>
                <Input id="delay" className="num" type="number" min={5} max={3600} value={draft.emptyDelayS} onChange={(e) => update({ emptyDelayS: num(e.target.value, 300) })} />
                <p className="text-xs text-muted-foreground">300 is the common occupancy-sensor delay. Use 20 for a live demonstration.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="leftOn">Assumed share of classes after which lights stay on (%)</Label>
                <Input id="leftOn" className="num" type="number" min={0} max={100} value={Math.round(draft.leftOnProbability * 100)} onChange={(e) => update({ leftOnProbability: Math.min(1, Math.max(0, num(e.target.value) / 100)) })} />
                {observed ? (
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => update({ leftOnProbability: Math.round(observed.share * 100) / 100 })}>
                    Use the observed {Math.round(observed.share * 100)}% from {observed.emptyHours.toFixed(1)} h of empty rooms
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Used only by the Scenario Lab. Pratibimb measures it once cameras or sensors have watched empty rooms for half an hour.</p>
                )}
              </div>
              <fieldset className="space-y-2 rounded-lg border border-highlight/30 p-3 sm:col-span-2">
                <legend className="px-1 text-sm font-medium">Automatic switch-off</legend>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <Switch aria-label="Switch off empty rooms automatically" checked={draft.autoOff.enabled} onCheckedChange={(v) => update({ autoOff: { ...draft.autoOff, enabled: v } })} />
                    Switch off watched rooms left empty with power on for
                  </label>
                  <Input
                    aria-label="Minutes before automatic switch-off"
                    className="num w-20"
                    type="number"
                    min={1}
                    max={240}
                    value={draft.autoOff.minutes}
                    onChange={(e) => update({ autoOff: { ...draft.autoOff, minutes: Math.min(240, Math.max(1, num(e.target.value, 10))) } })}
                  />
                  minutes
                </div>
                <p className="text-xs text-muted-foreground">
                  The twin sends the switch-off to your relay, smart plugs or control system after the empty delay plus these minutes, once per room until people return. Without any, staff see it as an instruction. Try the saving first in the{' '}
                  <Link to="/lab" className="underline">
                    Scenario Lab
                  </Link>
                  .
                </p>
              </fieldset>
            </div>
          </Section>

          <Section id="hours" icon={Clock} title="Opening hours" description="The Scenario Lab models classes and office hours inside these times.">
            <div className="flex flex-wrap items-center gap-3">
              <Label className="flex items-center gap-2 text-sm font-normal">
                From
                <Input aria-label="Opening hour" className="num w-20" type="number" min={0} max={23} value={draft.hours.from} onChange={(e) => update({ hours: { ...draft.hours, from: Math.min(23, Math.max(0, num(e.target.value, 9))) } })} />
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal">
                to
                <Input aria-label="Closing hour" className="num w-20" type="number" min={1} max={24} value={draft.hours.to} onChange={(e) => update({ hours: { ...draft.hours, to: Math.min(24, Math.max(1, num(e.target.value, 17))) } })} />
              </Label>
              <div role="group" aria-label="Open days" className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={draft.hours.days.includes(i)}
                    onClick={() => update({ hours: { ...draft.hours, days: draft.hours.days.includes(i) ? draft.hours.days.filter((x) => x !== i) : [...draft.hours.days, i].sort() } })}
                    className={`h-9 w-11 rounded-md border text-xs ${draft.hours.days.includes(i) ? 'border-highlight bg-highlight/10 font-medium text-highlight' : 'text-muted-foreground'}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            {observedHours ? (
              <Button variant="link" size="sm" className="mt-2 h-auto p-0 text-xs" onClick={() => update({ hours: observedHours })}>
                Use the observed hours: {observedHours.from}:00 to {observedHours.to}:00 on {observedHours.days.map((d) => DAYS[d]).join(', ')}
              </Button>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">After 5 hours of observed occupancy, Pratibimb suggests them from data.</p>
            )}
          </Section>

          <Section id="alerts" icon={Bell} title="Alerts" description="Where alerts and the weekly digest go, and in which languages.">
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Languages</legend>
                <div className="flex flex-wrap gap-3">
                  {LANGUAGES.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm">
                      <Switch
                        aria-label={`Alerts in ${l.label}`}
                        checked={draft.alertLanguages.includes(l.id)}
                        disabled={l.id === 'en'}
                        onCheckedChange={(on) => update({ alertLanguages: on ? [...draft.alertLanguages, l.id] : draft.alertLanguages.filter((x) => x !== l.id) })}
                      />
                      {l.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor="tg-chat">Telegram chat id (deployment's bot)</Label>
                <Input id="tg-chat" className="num" value={draft.telegramChatId ?? ''} onChange={(e) => update({ telegramChatId: e.target.value.trim() || undefined })} placeholder="Send /chatid to the bot in your group" inputMode="numeric" />
                <p className="text-xs text-muted-foreground">
                  With your own bot this fills itself: add its token in{' '}
                  <Link to="/settings/keys#telegram" className="underline">
                    Keys and AI
                  </Link>{' '}
                  and press Connect.
                </p>
              </div>
            </div>
          </Section>

          <Section
            id="floors"
            icon={Layers}
            title="Buildings and floors"
            description="Name each floor; give it a building when one site covers several buildings of a campus."
            action={
              <Button size="sm" variant="outline" onClick={() => update({ floors: [...draft.floors, { level: Math.max(-1, ...draft.floors.map((f) => f.level)) + 1, name: `Floor ${draft.floors.length}` }] })}>
                <Plus aria-hidden /> Add floor
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {draft.floors.map((f, i) => (
                <div key={f.level} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Building of floor ${f.level}`}
                    className="w-40"
                    placeholder="Building (optional)"
                    value={f.building ?? ''}
                    onChange={(e) => update({ floors: draft.floors.map((x, j) => (j === i ? { ...x, building: e.target.value || undefined } : x)) })}
                  />
                  <Input aria-label={`Name of floor ${f.level}`} className="w-44" value={f.name} onChange={(e) => update({ floors: draft.floors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <span className="text-xs text-muted-foreground">{draft.rooms.filter((r) => r.floor === f.level).length} rooms</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${f.name}`}
                    disabled={draft.floors.length === 1 || draft.rooms.some((r) => r.floor === f.level)}
                    title={draft.rooms.some((r) => r.floor === f.level) ? 'Move or remove its rooms first' : 'Remove floor'}
                    onClick={() => update({ floors: draft.floors.filter((_, j) => j !== i) })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          </Section>

          <Section id="rooms" icon={DoorOpen} title="Rooms and devices" description="Start from a template, then match the counts to what is really in each room. The AI Surveyor on a room's page can count from a photo.">
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Add a room from a template">
              {(Object.keys(ROOM_TEMPLATES) as RoomType[]).map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => addRoom(t)} title={`Add a ${ROOM_TEMPLATES[t].label.toLowerCase()} with typical seats and devices`}>
                  <Plus aria-hidden /> {ROOM_TEMPLATES[t].label}
                </Button>
              ))}
            </div>
            <div className="space-y-3">
              {draft.rooms.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No rooms yet. Add the first one with a template above, or use Set up with AI.</p>}
              {draft.rooms.map((room) => {
                const counts = deviceCounts(room)
                return (
                  <div key={room.id} className="space-y-3 rounded-xl border p-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_5rem_5rem_auto]">
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`${room.id}-id`}>
                          Id
                        </Label>
                        <Input id={`${room.id}-id`} className="num" value={room.id} disabled title="Ids stay fixed so cameras and sensors keep reporting to the right room" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`${room.id}-name`}>
                          Name
                        </Label>
                        <Input id={`${room.id}-name`} value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`${room.id}-floor`}>
                          Floor
                        </Label>
                        <Select value={String(room.floor)} onValueChange={(v) => updateRoom(room.id, { floor: Number(v) })}>
                          <SelectTrigger id={`${room.id}-floor`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {draft.floors.map((f) => (
                              <SelectItem key={f.level} value={String(f.level)}>
                                {f.building ? `${f.building} · ${f.name}` : f.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`${room.id}-seats`}>
                          Seats
                        </Label>
                        <Input id={`${room.id}-seats`} className="num" type="number" min={1} value={room.capacity} onChange={(e) => updateRoom(room.id, { capacity: Math.max(1, num(e.target.value, 1)) })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`${room.id}-area`}>
                          Area m²
                        </Label>
                        <Input
                          id={`${room.id}-area`}
                          className="num"
                          type="number"
                          min={1}
                          value={room.areaM2}
                          onChange={(e) => {
                            const a = Math.max(1, num(e.target.value, 1))
                            updateRoom(room.id, { areaM2: a, volumeM3: a * CEILING_M })
                          }}
                        />
                      </div>
                      <div className="flex items-end gap-1">
                        <Button size="sm" variant="ghost" asChild title="Open the camera page for this room">
                          <Link to={`/camera/${room.id}/new`}>
                            <Camera aria-hidden /> Camera
                          </Link>
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Remove ${room.id}`} onClick={() => setDraft((d) => ({ ...d, rooms: d.rooms.filter((r) => r.id !== room.id) }))}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {TYPES.map((t) => (
                        <div key={t} className="space-y-1">
                          <Label className="text-xs" htmlFor={`${room.id}-${t}`}>
                            {TYPE_NAMES[t]}
                          </Label>
                          <Input id={`${room.id}-${t}`} className="num" type="number" min={0} value={counts[t] ?? 0} onChange={(e) => setCount(room, t, num(e.target.value))} />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                      <label className="flex items-center gap-2">
                        <Switch aria-label={`${room.id} has windows`} checked={room.windowSide} onCheckedChange={(v) => updateRoom(room.id, { windowSide: v })} /> Windows (daylight advice)
                      </label>
                      <label className="flex items-center gap-2" title="Labs with long runs or server rooms: never switched off automatically">
                        <Switch aria-label={`Keep ${room.id} out of automatic switch-off`} checked={Boolean(room.autoOffExempt)} onCheckedChange={(v) => updateRoom(room.id, { autoOffExempt: v })} /> Never auto-off
                      </label>
                      <label className="flex items-center gap-2" title="With several cameras in this room: add their counts when each sees a different part, or take the largest when they overlap">
                        <Switch aria-label={`${room.id} cameras split the room`} checked={room.cameraMerge === 'sum'} onCheckedChange={(v) => updateRoom(room.id, { cameraMerge: v ? 'sum' : undefined })} /> Cameras split the room
                      </label>
                      <label className="flex items-center gap-2" title="A relay on the operator's computer switches this room's lights">
                        <Switch aria-label={`${room.id} lights on a USB relay`} checked={Boolean(room.hasRealRelay)} onCheckedChange={(v) => updateRoom(room.id, { hasRealRelay: v })} /> USB relay
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          <Section id="ratings" icon={Zap} title="Device ratings (watts)" description="Applies to every device of that type. Take the numbers from nameplates where you can.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {TYPES.map((t) => (
                <div key={t} className="space-y-1">
                  <Label className="text-xs" htmlFor={`rating-${t}`}>
                    {TYPE_NAMES[t]}
                  </Label>
                  <Input id={`rating-${t}`} className="num" type="number" min={0} value={rating(t)} onChange={(e) => setRating(t, num(e.target.value))} />
                </div>
              ))}
            </div>
          </Section>

          <Section id="start-over" icon={RotateCcw} title="Start over" description="Removes every room and setting, and the recorded occupancy, from this browser.">
            <Button
              variant="outline"
              className="border-waste/50 text-waste"
              onClick={() => {
                if (!confirm('Remove every room and setting, and the recorded occupancy, from this browser?')) return
                clearUsage()
                setDraft(emptySite())
                setSite(emptySite())
              }}
            >
              <RotateCcw aria-hidden /> Start over
            </Button>
          </Section>
        </div>
      </div>

      <div className="no-print sticky bottom-16 z-10 md:bottom-0">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
          <p className="min-w-0 flex-1 text-sm" role="status">
            {errors ? (
              <span className="text-waste">{errors}</span>
            ) : dirty ? (
              <span className="font-medium">Unsaved changes</span>
            ) : (
              <span className="text-muted-foreground">
                All saved · {draft.rooms.length} rooms, {draft.rooms.reduce((a, r) => a + r.devices.length, 0)} devices, {draft.rooms.reduce((a, r) => a + r.capacity, 0)} seats
              </span>
            )}
          </p>
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(saved)
                setErrors('')
              }}
            >
              Discard
            </Button>
          )}
          <Button onClick={save} disabled={!dirty}>
            <Save aria-hidden /> {dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>
    </div>
  )
}
