// "Set up with AI": describe the building in your own words, the AI reads it into the setup form.
// It only fills the form. Nothing is saved until you review it and press Save, numbers you did not write
// are left out (the server checks), and values taken from room templates are listed for you to check.

import { ClipboardCopy, Sparkles, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { setupFromText } from '@/ai/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { applySetupDraft, COUNTRY_PRESETS, ROOM_TEMPLATES, type SetupDraft } from '@/shared/site'
import type { Site } from '@/shared/types'
import { online } from '@/shared/workspace'

const FORMAT = `Organization: City Engineering College
Building: Main Block
City: Bengaluru, India
Currency: INR
Tariff per kWh: 8.73
Open: 9 to 17, Monday to Saturday
Floors: 0 = Ground floor; 1 = First floor (building: Main Block)
Rooms, one per line (id | name | floor | type | seats | devices):
LH-1 | Lecture Hall 1 | floor 0 | lecture hall | 120 seats | 16 lights, 8 fans, 2 ACs, 1 projector
CR-101 | Classroom 101 | floor 1 | classroom | 60 seats | 10 lights, 6 fans, 1 projector
LAB-1 | Computer Lab | floor 1 | lab | 40 seats | 12 lights, 2 ACs, 40 PCs, no windows`

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Place {
  name: string
  latitude: number
  longitude: number
  country?: string
  country_code?: string
}

interface Result {
  draft: SetupDraft
  dropped: string[]
  unclear: string[]
  place: Place | null
}

export function AiSetup({ draft, onApply }: { draft: Site; onApply: (site: Site) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'reading' | 'error'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const preview = result ? applySetupDraft(draft, result.draft) : null

  async function read() {
    setState('reading')
    setError('')
    try {
      const out = await setupFromText(text)
      // The city becomes coordinates through Open-Meteo, not through the AI.
      let place: Place | null = null
      if (out.draft.city) {
        const d = (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(out.draft.city.split(',')[0])}&count=1&language=en&format=json`)
          .then((r) => r.json())
          .catch(() => ({}))) as { results?: Place[] }
        place = d.results?.[0] ?? null
      }
      setResult({ ...out, place })
      setState('idle')
    } catch (e) {
      const status = String(e)
      setError(
        status.includes('401')
          ? 'Your session has ended. Sign out and open the workspace again.'
          : status.includes('503')
            ? 'The server is missing a key this needs: WORKSPACE_SECRET, and GROQ_API_KEY or GEMINI_API_KEY (docs/DEPLOY.md). You can fill the form by hand.'
            : 'The AI could not read it just now. Try again, or fill the form by hand.',
      )
      setState('error')
    }
  }

  function apply() {
    if (!preview || !result) return
    const next = { ...preview.site }
    const p = result.place
    if (p) {
      const preset = COUNTRY_PRESETS[p.country_code ?? '']
      next.location = { name: [p.name, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude, countryCode: p.country_code }
      if (preset && !result.draft.currency) next.currency = preset.currency
      if (preset?.tariffPerKwh && !next.tariffPerKwh) next.tariffPerKwh = preset.tariffPerKwh
      if (preset?.gridKgPerKwh && !next.gridKgPerKwh) next.gridKgPerKwh = preset.gridKgPerKwh
    }
    onApply(next)
    setOpen(false)
    setResult(null)
    toast.success('The form is filled in', { description: 'Check it, then press Save. Nothing is saved yet.' })
  }

  const d = result?.draft
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!online()} title={online() ? 'Describe your building and let the AI fill the form' : 'Needs the online version with an AI key'}>
          <Sparkles aria-hidden /> Set up with AI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Set up with AI</DialogTitle>
          <DialogDescription>Describe your building. The AI only fills the setup form: you review every value, and nothing is saved until you press Save.</DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-medium">Suggested format (plain sentences work too)</p>
                <Button size="sm" variant="ghost" onClick={() => setText(FORMAT)}>
                  <ClipboardCopy aria-hidden /> Use as a starting point
                </Button>
              </div>
              <pre className="num overflow-x-auto text-xs whitespace-pre-wrap">{FORMAT}</pre>
              <p className="mt-2 text-xs text-muted-foreground">Write numbers in digits. Anything you leave out stays as it is in the form. Room types: {Object.values(ROOM_TEMPLATES).map((t) => t.label.toLowerCase()).join(', ')}.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-setup-text">Your building</Label>
              <textarea
                id="ai-setup-text"
                className="num min-h-48 w-full rounded-md border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={text}
                maxLength={8000}
                onChange={(e) => setText(e.target.value)}
                placeholder="Describe the building, its floors and its rooms"
              />
              <p className="num text-right text-xs text-muted-foreground">{text.length} / 8000</p>
            </div>
            {state === 'error' && (
              <p role="alert" className="rounded-md border border-waste/50 bg-waste/10 p-2 text-sm text-waste">
                {error}
              </p>
            )}
            <Button onClick={read} disabled={text.trim().length < 10 || state === 'reading'} className="w-full">
              <Sparkles aria-hidden /> {state === 'reading' ? 'Reading your description' : 'Read it into the form'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              {d?.organization && (
                <>
                  <dt className="text-muted-foreground">Organization</dt>
                  <dd>{d.organization}</dd>
                </>
              )}
              {d?.buildingName && (
                <>
                  <dt className="text-muted-foreground">Building</dt>
                  <dd>{d.buildingName}</dd>
                </>
              )}
              {d?.city && (
                <>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{result.place ? `${[result.place.name, result.place.country].filter(Boolean).join(', ')} (${result.place.latitude.toFixed(2)}, ${result.place.longitude.toFixed(2)})` : `${d.city}: not found, pick it in the form`}</dd>
                </>
              )}
              {d?.currency && (
                <>
                  <dt className="text-muted-foreground">Currency</dt>
                  <dd>{d.currency}</dd>
                </>
              )}
              {d?.tariffPerKwh != null && (
                <>
                  <dt className="text-muted-foreground">Tariff</dt>
                  <dd className="num">{d.tariffPerKwh} per kWh</dd>
                </>
              )}
              {d?.hours && (
                <>
                  <dt className="text-muted-foreground">Open</dt>
                  <dd className="num">
                    {d.hours.from}:00 to {d.hours.to}:00, {d.hours.days.map((x) => DAYS[x]).join(', ')}
                  </dd>
                </>
              )}
            </dl>
            {preview && (d?.rooms?.length ?? 0) > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Rooms read from your description</caption>
                  <thead className="text-muted-foreground">
                    <tr>
                      {['Room', 'Name', 'Floor', 'Type', 'Seats', 'Lights', 'Fans', 'ACs', 'Projectors', 'PCs', ''].map((h) => (
                        <th key={h} scope="col" className="py-1 pr-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="num">
                    {d!.rooms!.map((r) => {
                      const room = preview.site.rooms.find((x) => x.id === r.id)!
                      const n = (t: string) => room.devices.filter((x) => x.type === t).length
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="py-1 pr-2">{r.id}</td>
                          <td className="pr-2">{room.name}</td>
                          <td className="pr-2">{room.floor}</td>
                          <td className="pr-2">{ROOM_TEMPLATES[room.type].label}</td>
                          <td className="pr-2">{room.capacity}</td>
                          <td className="pr-2">{n('light')}</td>
                          <td className="pr-2">{n('fan')}</td>
                          <td className="pr-2">{n('ac')}</td>
                          <td className="pr-2">{n('projector')}</td>
                          <td className="pr-2">{n('pc')}</td>
                          <td>{draft.rooms.some((x) => x.id === r.id) ? <Badge variant="outline">Updated</Badge> : <Badge variant="secondary">New</Badge>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(result.dropped.length > 0 || (preview?.assumed.length ?? 0) > 0 || result.unclear.length > 0) && (
              <div className="space-y-2 rounded-lg border border-warn/50 p-3">
                <p className="flex items-center gap-2 font-medium text-warn">
                  <TriangleAlert className="size-4" aria-hidden /> Check these before you save
                </p>
                {result.dropped.length > 0 && <p>Left out, because the number is not in your text: {result.dropped.join('; ')}.</p>}
                {preview && preview.assumed.length > 0 && <p>Taken from room templates: {preview.assumed.join('; ')}.</p>}
                {result.unclear.length > 0 && <p>The AI could not place: {result.unclear.join('; ')}.</p>}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setResult(null)}>
                Back to the text
              </Button>
              <Button onClick={apply}>Fill the form</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
