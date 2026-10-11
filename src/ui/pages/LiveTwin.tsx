// The main screen: totals, the floor plan, alerts with AI fixes, energy flow and the Copilot.

import { lazy, Suspense, useState } from 'react'
import { Building2, History, Radio } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isConfigured, useSite } from '@/shared/site'
import { useTwin } from '@/twin/store'
import { AlertFeed } from '../components/AlertFeed'
import { Building3D } from '../components/Building3D'
import { ConnectInputs } from '../components/ConnectInputs'
import { Copilot } from '../components/Copilot'
import { EnergyLeague } from '../components/EnergyLeague'
import { FloorPlan } from '../components/FloorPlan'
import { MetricStrip } from '../components/Metrics'
import { Patterns } from '../components/Patterns'
import { EmptyState, ErrorBoundary, PanelSkeleton } from '../components/states'
import { STATUS } from '../components/status'

// The Sankey brings the chart library; load it after the floor plan is on screen.
const EnergySankey = lazy(() => import('../components/EnergySankey'))

export default function LiveTwin() {
  const liveRooms = useTwin((s) => s.rooms)
  const savedCost = useTwin((s) => s.savedCost)
  const history = useTwin((s) => s.history)
  const navigate = useNavigate()
  const [view, setView] = useState('0')
  const [replay, setReplay] = useState<number | null>(null)
  const past = replay !== null ? history[replay] : null
  const rooms = past ? Object.fromEntries(past.rooms.map((r) => [r.roomId, r])) : liveRooms
  const list = Object.values(liveRooms)
  const ready = list.length > 0
  const select = (id: string) => navigate(`/room/${id}`)
  const site = useSite((s) => s.site)
  const floor = site.floors.find((f) => String(f.level) === view)
  const floorName = floor && (floor.building ? `${floor.building}, ${floor.name}` : floor.name)

  if (!isConfigured(site)) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent>
          <EmptyState icon={Building2} title="Set up your building to start">
            <p className="max-w-md text-sm">Add your rooms, devices and electricity tariff. Then connect a camera or sensor and the twin comes alive with real data.</p>
            <Button asChild className="mt-2">
              <Link to="/setup">Open setup</Link>
            </Button>
          </EmptyState>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Live twin of {site.buildingName || 'your building'}</h1>
      {ready && list.every((r) => !r.sources.length) && <ConnectInputs firstRoomId={site.rooms[0].id} />}
      {ready ? <MetricStrip rooms={list} savedCost={savedCost} /> : <PanelSkeleton rows={1} />}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{site.buildingName || 'Your building'}</CardTitle>
            <div className="flex flex-wrap items-center gap-3 text-xs" aria-label="Legend">
              {(['occupied', 'idle', 'waste', 'unknown'] as const).map((k) => {
                const S = STATUS[k]
                return (
                  <span key={k} className={`flex items-center gap-1 ${S.text}`}>
                    <S.icon className="size-3.5" aria-hidden /> {S.label}
                  </span>
                )
              })}
            </div>
            <div role="group" aria-label="Floor" className="inline-flex rounded-lg bg-muted p-1">
              {[...site.floors.map((f) => ({ id: String(f.level), label: f.building ? `${f.building} · ${f.name}` : f.name })), { id: '3d', label: '3D' }].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={view === o.id}
                  onClick={() => setView(o.id)}
                  className={`rounded-md px-3 py-1 text-sm transition-colors ${view === o.id ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ErrorBoundary label="the floor plan">
              {!ready ? (
                <PanelSkeleton rows={6} />
              ) : view === '3d' ? (
                <Building3D rooms={rooms} onSelect={select} />
              ) : (
                <FloorPlan plan={site.rooms} floor={Number(view)} floorName={floorName} rooms={rooms} onSelect={select} />
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
        <ErrorBoundary label="alerts">
          <AlertFeed />
        </ErrorBoundary>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ErrorBoundary label="the energy flow">
          <div className="lg:col-span-2">
            <Suspense fallback={<PanelSkeleton rows={4} />}>
              <EnergySankey rooms={list} />
            </Suspense>
          </div>
        </ErrorBoundary>
        <div className="space-y-4">
          <ErrorBoundary label="the Copilot">
            <Copilot />
          </ErrorBoundary>
          <ErrorBoundary label="patterns">
            <Patterns />
          </ErrorBoundary>
          <EnergyLeague rooms={list} />
        </div>
      </div>
    </div>
  )
}
