// /live  The public view behind a room's QR code: anyone can watch the building on their phone.
// Read-only: it listens to the workspace's public channel (named in the link), whose snapshots carry the
// layout, so it needs no sign-in and no setup. A visitor's tip goes through the server, which checks the link's key.
// ?room=ID picks the featured room; otherwise the first room with a live input is featured.

import { Clock, Lightbulb, LightbulbOff, Megaphone, Users, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SNAPSHOT_STALE_MS } from '@/shared/config'
import { formatMoney } from '@/twin/energy'
import { send } from '@/twin/realtime'
import { PUBLIC_LINK, SESSION } from '@/shared/workspace'
import { useSnapshot } from '@/twin/store'
import { FloorPlan } from '../components/FloorPlan'
import { StatusBadge } from '../components/status'

export default function JudgeView() {
  const snapshot = useSnapshot((s) => s.snapshot)
  const [params] = useSearchParams()
  const [now, setNow] = useState(() => Date.now())
  const [reported, setReported] = useState<string | null>(null)
  // The last 3 minutes of building power, kept by the snapshot store as snapshots arrive.
  const series = useSnapshot((s) => s.watts)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const header = (
    <header className="flex items-center justify-between">
      <div>
        <p className="font-heading text-2xl font-semibold text-highlight">Pratibimb</p>
        <h1 className="text-sm font-normal text-muted-foreground [font-family:var(--font-sans)]">{snapshot?.layout.buildingName || 'Live building'}</h1>
      </div>
      {snapshot && (
        <span className={`flex items-center gap-1 text-xs ${now - snapshot.ts > SNAPSHOT_STALE_MS ? 'text-warn' : 'text-muted-foreground'}`} role="status">
          <Clock className="size-3.5" aria-hidden />
          {now - snapshot.ts > SNAPSHOT_STALE_MS ? 'Twin paused' : `Updated ${Math.max(0, Math.round((now - snapshot.ts) / 1000))} s ago`}
        </span>
      )}
    </header>
  )

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-4">
        {header}
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-24 w-full" />
        <p className="text-center text-sm text-muted-foreground">Waiting for the twin. It appears here as soon as the operator's screen is open. Open this page from the QR code on the operator's screen.</p>
      </main>
    )
  }

  const rooms = Object.fromEntries(snapshot.rooms.map((r) => [r.roomId, r]))
  const featuredId = params.get('room') ?? snapshot.rooms.find((r) => r.sources.length)?.roomId ?? snapshot.rooms[0]?.roomId
  const focus = featuredId ? rooms[featuredId] : undefined
  const zones = Object.values(focus?.zones ?? {})
  const lightsOn = zones.length ? zones.some(Boolean) : null
  const money = (v: number, d = 2) => formatMoney(v, d, snapshot.layout.currency)
  const counts = { occupied: 0, idle: 0, waste: 0, unknown: 0 }
  for (const r of snapshot.rooms) counts[r.status]++
  const firstFloor = snapshot.layout.floors[0]

  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      {header}
      {focus && (
        <Card className={focus.status === 'waste' ? 'border-waste' : undefined}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-mono text-2xl">{focus.roomId}</CardTitle>
            <StatusBadge status={focus.status} className="text-sm" />
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-center">
            <div>
              <Users className="mx-auto size-6" aria-hidden />
              <p className="num text-2xl font-semibold">{focus.occupancyKnown ? focus.headcount : '–'}</p>
              <p className="text-xs text-muted-foreground">people</p>
            </div>
            <div className={lightsOn ? 'text-warn' : 'text-muted-foreground'}>
              {lightsOn ? <Lightbulb className="mx-auto size-6" aria-hidden /> : <LightbulbOff className="mx-auto size-6" aria-hidden />}
              <p className="text-2xl font-semibold">{lightsOn === null ? '–' : lightsOn ? 'On' : 'Off'}</p>
              <p className="text-xs text-muted-foreground">lights</p>
            </div>
            <div className={focus.status === 'waste' ? 'text-waste' : undefined}>
              <Zap className="mx-auto size-6" aria-hidden />
              <p className="num text-2xl font-semibold">{Math.round(focus.watts)}</p>
              <p className="text-xs text-muted-foreground">watts</p>
            </div>
          </CardContent>
          {focus.status !== 'occupied' && (
            <CardContent className="border-t pt-4">
              {reported === focus.roomId ? (
                <p role="status" className="text-center text-sm text-occupied">
                  Thank you. The facility team has been asked to check {focus.roomId}.
                </p>
              ) : (
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => {
                    const link = PUBLIC_LINK ?? (SESSION?.mode === 'server' ? SESSION : null)
                    if (link) void fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: link.id, key: link.publicKey, roomId: focus.roomId }) }).catch(() => undefined)
                    // A workspace kept in this browser: tell the twin in the other tab directly.
                    else send('tip', { roomId: focus.roomId, ts: Date.now() }, { remote: false })
                    setReported(focus.roomId)
                  }}
                >
                  <Megaphone aria-hidden /> Lights left on here? Tell the facility team
                </Button>
              )}
            </CardContent>
          )}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Card className="py-3">
          <CardContent className="px-3">
            <p className="text-xs text-muted-foreground">Building now</p>
            <p className="num text-xl font-semibold">{(snapshot.totals.watts / 1000).toFixed(2)} kW</p>
            <p className="num text-xs text-muted-foreground">{money(snapshot.totals.costPerHour)}/hr</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="px-3">
            <p className="text-xs text-muted-foreground">Wasted this session</p>
            <p className="num text-xl font-semibold text-waste">{money(snapshot.totals.wasteCost)}</p>
            <p className="num text-xs text-occupied">{money(snapshot.totals.savedCost)} saved</p>
          </CardContent>
        </Card>
      </div>
      {series.length > 1 && <Sparkline values={series} />}
      {firstFloor && (
        <Card>
          <CardContent className="space-y-2 px-3">
            <FloorPlan plan={snapshot.layout.rooms} floor={firstFloor.level} floorName={firstFloor.name} rooms={rooms} compact />
            <p className="text-center text-xs text-muted-foreground">
              {counts.occupied} occupied · {counts.idle} empty and off · <span className="text-waste">{counts.waste} wasting</span>
              {counts.unknown ? ` · ${counts.unknown} without data` : ''}
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  )
}

/** Building power over the last minutes as a hand-drawn SVG line: no chart library on the phone page. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 300},${58 - (v / max) * 52}`).join(' ')
  const now = values.at(-1)! / 1000
  return (
    <Card className="py-3">
      <CardContent className="space-y-1 px-3">
        <p className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>Building power, last {Math.max(1, Math.round((values.length * 2) / 60))} min</span>
          <span className="num">peak {(max / 1000).toFixed(2)} kW</span>
        </p>
        <svg viewBox="0 0 300 60" className="h-16 w-full" role="img" aria-label={`Building power over the last minutes, now ${now.toFixed(2)} kilowatts`}>
          <polyline points={`0,60 ${points} 300,60`} fill="var(--highlight)" fillOpacity="0.12" stroke="none" />
          <polyline points={points} fill="none" stroke="var(--highlight)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </CardContent>
    </Card>
  )
}
