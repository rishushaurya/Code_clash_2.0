// /rooms  Every room at a glance: status, people, power, where the numbers come from, and how much of the room
// the cameras watch. Table on wide screens, cards in the grid view and on phones.

import { DoorOpen, LayoutGrid, Rows3, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { coverage } from '@/cv/coverage'
import { syncCameras, useCameras } from '@/cv/cameras'
import { cn } from '@/lib/utils'
import { isConfigured, useSite } from '@/shared/site'
import type { DeviceType, Room, RoomState } from '@/shared/types'
import { useTwin } from '@/twin/store'
import { EmptyState, PageHeader } from '../components/states'
import { RoomStatusBadge, SourceBadges, STATUS } from '../components/status'
import { emptyingSeconds } from '@/twin/compute'

const NAMES: Record<DeviceType, [string, string]> = { light: ['light', 'lights'], fan: ['fan', 'fans'], ac: ['AC', 'ACs'], projector: ['projector', 'projectors'], pc: ['PC', 'PCs'] }
type Filter = 'all' | 'occupied' | 'emptying' | 'waste' | 'idle' | 'unknown'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Every status' },
  { id: 'waste', label: STATUS.waste.label },
  { id: 'occupied', label: STATUS.occupied.label },
  { id: 'emptying', label: 'Emptying' },
  { id: 'idle', label: STATUS.idle.label },
  { id: 'unknown', label: STATUS.unknown.label },
]

function statusOf(s: RoomState | undefined, delay: number): Filter {
  if (!s) return 'unknown'
  return emptyingSeconds(s, delay, s.updatedAt) !== null ? 'emptying' : s.status
}

function Coverage({ room }: { room: Room }) {
  const cameras = useCameras((c) => c.cameras)
  const list = Object.values(cameras).filter((c) => c.roomId === room.id)
  if (!room.devices.length) return <span className="text-muted-foreground">No devices</span>
  if (!list.length) return <span className="text-muted-foreground">No camera</span>
  return (
    <span className="num flex flex-wrap gap-x-2 text-xs">
      {coverage(room, list).map((c) => (
        <span key={c.type} className={c.watched < c.total ? 'text-warn' : 'text-occupied'}>
          {c.watched}/{c.total} {NAMES[c.type][c.total === 1 ? 0 : 1]}
        </span>
      ))}
    </span>
  )
}

const people = (room: Room, s?: RoomState) => (s?.occupancyKnown ? `${s.headcount} / ${room.capacity}` : 'No input')
const watts = (s?: RoomState) => (s && (s.metered || Object.keys(s.deviceOn).length) ? `${Math.round(s.watts)} W` : 'No input')

export default function Rooms() {
  const site = useSite((st) => st.site)
  const live = useTwin((st) => st.rooms)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<Filter>('all')
  const [floor, setFloor] = useState('all')
  const [view, setView] = useState<'table' | 'grid'>('table')
  useEffect(() => void syncCameras(), [])

  if (!isConfigured(site))
    return (
      <Card>
        <CardContent>
          <EmptyState icon={DoorOpen} title="No rooms yet">
            <p className="text-sm">Add rooms from a template, a photo or a plain description.</p>
            <Button asChild className="mt-2">
              <Link to="/settings/site#rooms">Add rooms</Link>
            </Button>
          </EmptyState>
        </CardContent>
      </Card>
    )

  const needle = q.trim().toLowerCase()
  const floorName = (level: number) => {
    const f = site.floors.find((x) => x.level === level)
    return f ? (f.building ? `${f.building} · ${f.name}` : f.name) : `Floor ${level}`
  }
  const rooms = site.rooms.filter(
    (r) =>
      (!needle || r.id.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle)) &&
      (floor === 'all' || String(r.floor) === floor) &&
      (status === 'all' || statusOf(live[r.id], site.emptyDelayS) === status),
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Rooms" description={`${site.rooms.length} rooms on ${site.floors.length} ${site.floors.length === 1 ? 'floor' : 'floors'}. Open a room for its devices, cameras and staff reports.`}>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/site#rooms">Edit rooms</Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by id or name" aria-label="Search rooms" className="pl-8" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as Filter)}>
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {site.floors.length > 1 && (
          <Select value={floor} onValueChange={setFloor}>
            <SelectTrigger aria-label="Filter by floor" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every floor</SelectItem>
              {site.floors.map((f) => (
                <SelectItem key={f.level} value={String(f.level)}>
                  {floorName(f.level)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div role="group" aria-label="Layout" className="hidden rounded-lg bg-muted p-1 md:inline-flex">
          {(
            [
              ['table', 'Table', Rows3],
              ['grid', 'Grid', LayoutGrid],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm', view === id ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only" role="status">
        {rooms.length} of {site.rooms.length} rooms shown
      </p>

      {rooms.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={Search} title="No room matches">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQ('')
                  setStatus('all')
                  setFloor('all')
                }}
              >
                Clear the filters
              </Button>
            </EmptyState>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className={cn('py-0', view === 'grid' ? 'hidden' : 'hidden md:block')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Room</TableHead>
                  <TableHead>Floor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead className="text-right">Power</TableHead>
                  <TableHead>Inputs</TableHead>
                  <TableHead className="pr-4">Camera coverage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((r) => {
                  const s = live[r.id]
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4">
                        <Link to={`/room/${r.id}`} className="font-medium hover:underline">
                          <span className="num">{r.id}</span>
                          <span className="block max-w-56 truncate text-xs font-normal text-muted-foreground">{r.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{floorName(r.floor)}</TableCell>
                      <TableCell>
                        <RoomStatusBadge state={s} emptyDelayS={site.emptyDelayS} />
                      </TableCell>
                      <TableCell className={cn('num text-right', !s?.occupancyKnown && 'text-muted-foreground')}>{people(r, s)}</TableCell>
                      <TableCell className={cn('num text-right', s?.status === 'waste' && 'text-waste', watts(s) === 'No input' && 'text-muted-foreground')}>{watts(s)}</TableCell>
                      <TableCell>{s?.sources.length ? <SourceBadges sources={s.sources} /> : <span className="text-muted-foreground">None</span>}</TableCell>
                      <TableCell className="pr-4">
                        <Coverage room={r} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
          <ul className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4', view === 'table' && 'md:hidden')}>
            {rooms.map((r) => {
              const s = live[r.id]
              return (
                <li key={r.id}>
                  <Link to={`/room/${r.id}`} className="block h-full rounded-xl focus-visible:outline-2">
                    <Card className={cn('h-full gap-3 py-4 transition-colors hover:border-highlight/50', s?.status === 'waste' && 'border-waste/50')}>
                      <CardContent className="space-y-3 px-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="num font-semibold">{r.id}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {r.name} · {floorName(r.floor)}
                            </p>
                          </div>
                          <RoomStatusBadge state={s} emptyDelayS={site.emptyDelayS} className="shrink-0" />
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <dt className="text-xs text-muted-foreground">People</dt>
                            <dd className="num">{people(r, s)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Power</dt>
                            <dd className={cn('num', s?.status === 'waste' && 'text-waste')}>{watts(s)}</dd>
                          </div>
                        </dl>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          {s?.sources.length ? <SourceBadges sources={s.sources} /> : <span className="text-muted-foreground">No inputs</span>}
                          <Coverage room={r} />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
