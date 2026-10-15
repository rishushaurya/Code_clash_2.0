// Overview: how the building is doing right now and what to do about it. Health, power, money, waste, the three
// biggest fixes, the live building, and where the energy goes.

import { lazy, Suspense, useState } from 'react'
import { ArrowRight, BellOff, Box, Gauge, History, Coins, Maximize2, PiggyBank, Power, Radio, TriangleAlert, Zap, type LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { isConfigured, useSite } from '@/shared/site'
import { formatMoney } from '@/twin/energy'
import { ALERT_LABELS } from '@/twin/rules'
import { useTwin } from '@/twin/store'
import { EnergyLeague } from '../components/EnergyLeague'
import { FloorPlan } from '../components/FloorPlan'
import { GetLive } from '../components/GetLive'
import { EmptyState, ErrorBoundary, PageHeader, PanelSkeleton } from '../components/states'
import { SimulatedBadge, STATUS } from '../components/status'
import { buildingTotals, healthScore, topActions } from '../live'

// The 3D model and the Sankey bring heavy libraries; they load after the numbers are on screen.
const Building3DView = lazy(() => import('@/ui/3d').then((m) => ({ default: m.Building3DView })))
const EnergySankey = lazy(() => import('../components/EnergySankey'))

function Metric({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-4" aria-hidden /> {label}
        </p>
        <p className={cn('num text-2xl leading-tight font-semibold md:text-3xl', tone)}>{value}</p>
        {sub && <p className="num text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Health() {
  const rooms = useTwin((s) => s.rooms)
  const alerts = useTwin((s) => s.alerts.length)
  const h = healthScore(Object.values(rooms), alerts)
  const grade = !h ? null : h.score >= 80 ? { label: 'Good', tone: 'text-occupied' } : h.score >= 50 ? { label: 'Fair', tone: 'text-warn' } : { label: 'Needs attention', tone: 'text-waste' }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4" aria-hidden /> Building health
        </CardTitle>
        <CardDescription>Out of 100, from what the twin measures right now.</CardDescription>
      </CardHeader>
      <CardContent>
        {!h || !grade ? (
          <EmptyState icon={Radio} title="Nothing measured yet">
            <p className="max-w-xs text-sm">The score starts when a camera, sensor or staff report covers a room.</p>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            <p className="flex items-baseline gap-2" role="status">
              <span className={cn('num text-5xl font-semibold', grade.tone)}>{h.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <span className={cn('ml-1 text-sm font-medium', grade.tone)}>{grade.label}</span>
            </p>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">What moves it</p>
              <ul className="space-y-2 text-sm">
                {h.factors.map((f) => (
                  <li key={f.label} className="grid grid-cols-[3rem_1fr] items-baseline gap-2">
                    <span className={cn('num text-right', f.lost ? 'text-waste' : 'text-muted-foreground')}>{f.lost ? `-${f.lost}` : '0'}</span>
                    <span>
                      {f.label}
                      <span className="num block text-xs text-muted-foreground">
                        {f.detail}, up to -{f.max}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TodaysActions() {
  const alerts = useTwin((s) => s.alerts)
  const recs = useTwin((s) => s.recs)
  const switchOff = useTwin((s) => s.switchOff)
  const top = topActions(alerts, recs)
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Today's three actions</CardTitle>
        <CardDescription>The biggest savings available right now.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to="/alerts">
              All alerts <ArrowRight aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <EmptyState icon={BellOff} title="Nothing to fix right now">
            <p className="text-sm">Empty rooms with power on appear here with the fix and what it saves.</p>
          </EmptyState>
        ) : (
          <ol className="space-y-3">
            {top.map((a, i) => {
              const rec = recs[a.id]
              const ready = rec && rec !== 'loading' ? rec : null
              const saving = ready?.monthlySavingCost ?? a.facts.monthlySavingCost
              return (
                <li key={a.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
                  <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-highlight/15 text-sm font-semibold text-highlight" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <p className="font-medium">
                      <Link to={`/room/${a.roomId}`} className="num hover:underline">
                        {a.roomId}
                      </Link>{' '}
                      <span className="text-muted-foreground">· {ALERT_LABELS[a.type]}</span>
                    </p>
                    <p>{ready ? ready.action : a.type === 'empty_with_load' ? `${a.facts.wattsNow} W on in an empty room.` : 'Writing the recommendation.'}</p>
                    <p className="num flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {a.facts.costPerHourNow > 0 && <span>{formatMoney(a.facts.costPerHourNow, 2)}/hr now</span>}
                      {saving ? (
                        <>
                          <span className="text-occupied">saves about {formatMoney(saving)}/month</span>
                          <SimulatedBadge />
                        </>
                      ) : null}
                    </p>
                  </div>
                  {ready?.command && (
                    <Button size="sm" onClick={() => switchOff(ready.command!.roomId, ready.command!.target)}>
                      <Power aria-hidden /> Apply
                    </Button>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function LiveBuilding() {
  const site = useSite((s) => s.site)
  const liveRooms = useTwin((s) => s.rooms)
  const history = useTwin((s) => s.history)
  const navigate = useNavigate()
  const [view, setView] = useState('3d')
  const [replay, setReplay] = useState<number | null>(null)
  const past = replay !== null ? history[replay] : null
  const rooms = past ? Object.fromEntries(past.rooms.map((r) => [r.roomId, r])) : liveRooms
  const ready = Object.keys(liveRooms).length > 0
  const select = (id: string) => navigate(`/room/${id}`)
  const floor = site.floors.find((f) => String(f.level) === view)
  const views = [{ id: '3d', label: '3D' }, ...site.floors.map((f) => ({ id: String(f.level), label: f.building ? `${f.building} · ${f.name}` : f.name }))]

  return (
    <Card className="xl:col-span-2">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Live building</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1">
            {views.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={view === o.id}
                onClick={() => setView(o.id)}
                className={cn('shrink-0 rounded-md px-3 py-1 text-sm transition-colors', view === o.id ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/building">
              <Maximize2 aria-hidden /> Open 3D
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs" aria-label="Legend">
          {(['occupied', 'idle', 'waste', 'unknown'] as const).map((k) => {
            const S = STATUS[k]
            return (
              <span key={k} className={`flex items-center gap-1 ${S.text}`}>
                <S.icon className="size-3.5" aria-hidden /> {S.label}
              </span>
            )
          })}
        </div>
        <ErrorBoundary label="the live building">
          {!ready ? (
            <PanelSkeleton rows={6} />
          ) : view === '3d' ? (
            <div className="h-[min(60vh,480px)] overflow-hidden rounded-lg">
              <Suspense fallback={<PanelSkeleton rows={6} />}>
                <Building3DView rooms={rooms} onSelect={select} />
              </Suspense>
            </div>
          ) : (
            <FloorPlan plan={site.rooms} floor={Number(view)} floorName={floor?.name} rooms={rooms} onSelect={select} />
          )}
        </ErrorBoundary>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
          <History className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">Time travel</span>
          <Slider
            className="min-w-40 flex-1"
            min={0}
            max={Math.max(0, history.length - 1)}
            step={1}
            disabled={history.length < 2}
            value={[replay ?? Math.max(0, history.length - 1)]}
            onValueChange={([v]) => setReplay(v >= history.length - 1 ? null : v)}
            aria-label="Replay the building over the last hour"
          />
          {past ? (
            <>
              <span className="num text-warn" role="status">
                Replaying {new Date(past.ts).toLocaleTimeString()}
              </span>
              <Button size="sm" variant="outline" onClick={() => setReplay(null)}>
                <Radio aria-hidden /> Back to live
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">{history.length < 2 ? 'Recording, one frame every 10 s' : 'Live'}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Overview() {
  const site = useSite((s) => s.site)
  const rooms = useTwin((s) => s.rooms)
  const savedCost = useTwin((s) => s.savedCost)
  const list = Object.values(rooms)
  const t = buildingTotals(list)

  if (!isConfigured(site)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Welcome to Pratibimb" description="A live twin of your building: who is in each room, what is switched on, and what it costs. Five steps bring it to life." />
        <GetLive always />
        <Card>
          <CardContent>
            <EmptyState icon={Box} title="Your building appears here">
              <p className="max-w-md text-sm">Once the rooms are added, this page shows the live 3D building, power, cost and the biggest savings available right now.</p>
              <Button asChild className="mt-2">
                <Link to="/settings/site">Set up the building</Link>
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Overview of {site.buildingName || 'your building'}</h1>
      <GetLive />
      {list.length ? (
        <section aria-label="Building now" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={Zap} label="Power now" value={`${(t.watts / 1000).toFixed(2)} kW`} sub={list.some((r) => r.metered) ? 'Metered and observed devices' : 'Observed devices only'} />
          <Metric icon={Coins} label="Cost per hour" value={formatMoney(t.costPerHour, 2)} sub={`at ${formatMoney(site.tariffPerKwh, 2)} per kWh`} />
          <Metric
            icon={TriangleAlert}
            label="Waste now"
            value={`${formatMoney(t.wasteCostPerHour, 2)}/hr`}
            sub={`${Math.round(t.wasteWatts)} W in empty rooms`}
            tone={t.wasteWatts > 0 ? 'text-waste' : undefined}
          />
          <Metric icon={PiggyBank} label="Saved this session" value={formatMoney(savedCost, 2)} sub="by confirmed switch-offs" tone={savedCost > 0 ? 'text-occupied' : undefined} />
          <p className="sr-only" role="status">{`Building draws ${(t.watts / 1000).toFixed(1)} kilowatts; ${(t.wasteWatts / 1000).toFixed(1)} kilowatts are in empty rooms.`}</p>
        </section>
      ) : (
        <PanelSkeleton rows={1} />
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <ErrorBoundary label="building health">
          <Health />
        </ErrorBoundary>
        <ErrorBoundary label="today's actions">
          <TodaysActions />
        </ErrorBoundary>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <LiveBuilding />
        <EnergyLeague rooms={list} />
      </div>
      <ErrorBoundary label="the energy flow">
        <Suspense fallback={<PanelSkeleton rows={4} />}>
          <EnergySankey rooms={list} />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
