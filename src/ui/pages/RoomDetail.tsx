// One room: live state, devices, indoor CO2, switch-off and staff-report controls, and the "Add camera" QR code.

import { Camera, Eye, Lightbulb, LightbulbOff, Power, Wind } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { can, joinLink } from '@/shared/workspace'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CO2_ALERT_PPM } from '@/shared/config'
import { useSite, zonesOf } from '@/shared/site'
import type { DeviceType } from '@/shared/types'
import { costPerHour, formatMoney } from '@/twin/energy'
import { useTwin } from '@/twin/store'
import { EmptyState, ErrorState, PanelSkeleton } from '../components/states'
import { RoomStatusBadge, SourceBadges } from '../components/status'
import { Surveyor } from '../components/Surveyor'
import { useEffect } from 'react'
import { syncCameras, useCameras } from '@/cv/cameras'
import { coverage } from '@/cv/coverage'

const NAMES: Record<DeviceType, string> = { light: 'Lights', fan: 'Fans', ac: 'ACs', projector: 'Projectors', pc: 'PCs' }

export default function RoomDetail() {
  const { id = '' } = useParams()
  const room = useSite((st) => st.site.rooms.find((r) => r.id === id))
  const s = useTwin((st) => st.rooms[id])
  const history = useTwin((st) => st.co2History[id])
  const events = useTwin((st) => st.events)
  const switchOff = useTwin((st) => st.switchOff)
  const reportDevices = useTwin((st) => st.reportDevices)
  const readings = useTwin((st) => st.readings)
  const emptyDelayS = useSite((st) => st.site.emptyDelayS)
  const saved = useCameras((c) => c.cameras)
  useEffect(() => void syncCameras(), [])

  if (!room) return <ErrorState message={`There is no room ${id} in this site.`} />
  if (!s) return <PanelSkeleton rows={6} />

  const types = [...new Set(room.devices.map((d) => d.type))]
  const cameraUrl = joinLink(`/camera/${room.id}/new`)
  const roomEvents = events.filter((e) => e.roomId === id).slice(0, 8)
  const cameras = Object.values(readings).filter((r) => r.roomId === id)
  const now = s.updatedAt // the twin's latest tick, so render stays pure
  const stat = (label: string, value: string, tone = '') => ({ label, value, tone })
  const tiles = [
    s.occupancyKnown ? stat('People', `${s.headcount} / ${room.capacity}`) : stat('People', 'No input', 'muted'),
    stat(s.metered ? 'Power (metered)' : 'Power (observed)', `${Math.round(s.watts)} W`),
    stat('Cost', `${formatMoney(costPerHour(s.watts), 2)}/hr`),
    s.occupancyKnown || s.co2Measured
      ? stat(s.co2Measured ? 'Indoor CO2 (measured)' : 'Indoor CO2 (estimated)', `${Math.round(s.co2ppm)} ppm`, s.co2ppm > CO2_ALERT_PPM ? 'warn' : '')
      : stat('Indoor CO2', 'Needs a head-count or sensor', 'muted'),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-mono text-2xl font-semibold md:text-3xl">{room.id}</h1>
        <span className="text-muted-foreground">{room.name}</span>
        <RoomStatusBadge state={s} emptyDelayS={emptyDelayS} />
        <SourceBadges sources={s.sources} />
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Room now">
        {tiles.map((t) => (
          <Card key={t.label} className="py-4">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className={`num font-semibold ${t.tone === 'muted' ? 'text-base text-muted-foreground' : 'text-2xl'} ${t.tone === 'warn' ? 'text-warn' : ''}`}>{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Devices</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={s.watts === 0 || !can('manager')} onClick={() => switchOff(room.id, 'lights')} title={can('manager') ? 'Ask your relay, integrations or staff to switch the lights off' : 'Viewers cannot send commands'}>
                <LightbulbOff aria-hidden /> Switch off lights
              </Button>
              <Button size="sm" disabled={s.watts === 0 || !can('manager')} onClick={() => switchOff(room.id, 'all')} title={can('manager') ? 'Ask your relay, integrations or staff to switch everything off' : 'Viewers cannot send commands'}>
                <Power aria-hidden /> Switch off all
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead className="text-right">On</TableHead>
                  <TableHead className="text-right">Off</TableHead>
                  <TableHead className="text-right">Not observed</TableHead>
                  <TableHead className="text-right">Watts now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((type) => {
                  const devs = room.devices.filter((d) => d.type === type)
                  const on = devs.filter((d) => s.deviceOn[d.id] === true)
                  const off = devs.filter((d) => s.deviceOn[d.id] === false)
                  return (
                    <TableRow key={type}>
                      <TableCell>{NAMES[type]}</TableCell>
                      <TableCell className="num text-right">{on.length}</TableCell>
                      <TableCell className="num text-right">{off.length}</TableCell>
                      <TableCell className="num text-right text-muted-foreground">{devs.length - on.length - off.length}</TableCell>
                      <TableCell className="num text-right">{on.reduce((a, d) => a + d.ratedW, 0)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">Camera zones:</span>
              {zonesOf(room).map((z) => {
                const seen = s.zones[z.id]
                return (
                  <span key={z.id} className={`flex items-center gap-1 ${seen ? 'text-warn' : 'text-muted-foreground'}`}>
                    {seen ? <Lightbulb className="size-4" aria-hidden /> : <LightbulbOff className="size-4" aria-hidden />} {z.id} ({z.label}){' '}
                    {seen === undefined ? 'not watched' : seen ? 'on' : 'off'}
                  </span>
                )
              })}
            </div>
            <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
              <p className="mb-2 flex items-center gap-1.5 font-medium">
                <Eye className="size-4" aria-hidden /> In the room? Report what you see
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => reportDevices(room.id, 'lights', true)}>
                  Lights are on
                </Button>
                <Button size="sm" variant="outline" onClick={() => reportDevices(room.id, 'lights', false)}>
                  Lights are off
                </Button>
                {types.includes('fan') && (
                  <Button size="sm" variant="outline" onClick={() => reportDevices(room.id, 'fans', true)}>
                    Fans are on
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => reportDevices(room.id, 'all', false)}>
                  Everything is off
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Reports count until people come back into the room. They also confirm a switch-off where no sensor can.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wind className="size-4" aria-hidden /> Indoor CO2
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!s.occupancyKnown && !s.co2Measured ? (
              <EmptyState icon={Wind} title="Needs a head-count or a CO2 sensor">
                <p className="text-sm">Connect a camera or a people counter to estimate indoor CO2.</p>
              </EmptyState>
            ) : history && history.length > 1 ? (
              <div className="h-40" role="img" aria-label={`Indoor CO2 now ${Math.round(s.co2ppm)} ppm; guideline 1000 ppm`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history.map((v, i) => ({ i, v }))}>
                    <YAxis domain={[400, (max: number) => Math.max(1200, max)]} width={40} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <ReferenceLine y={CO2_ALERT_PPM} stroke="var(--status-warn)" strokeDasharray="4 4" label={{ value: '1000 ppm', fill: 'var(--status-warn)', fontSize: 11 }} />
                    <Line dataKey="v" dot={false} stroke="var(--highlight)" strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <PanelSkeleton rows={2} />
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {s.co2Measured ? 'From the room sensor.' : 'Estimated from the head-count with a single-zone mass balance; a CO2 sensor on the sensor API replaces the estimate.'}
              {s.temperatureC !== undefined && ` Temperature ${s.temperatureC.toFixed(1)} °C.`}
              {s.humidity !== undefined && ` Humidity ${Math.round(s.humidity)} %.`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="size-4" aria-hidden /> Cameras
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={cameraUrl} size={170} level="L" aria-label={`QR code that adds a phone camera to ${room.id}`} />
            </div>
            <p className="text-center text-xs text-muted-foreground">Scan with a phone to add it as a camera. The code signs the phone in to this workspace, so keep it off public walls.</p>
            {room.devices.length > 0 && (
              <p className="w-full border-t pt-2 text-xs">
                <span className="text-muted-foreground">Camera coverage: </span>
                {Object.values(saved).some((c) => c.roomId === room.id)
                  ? coverage(room, Object.values(saved)).map((c) => `${c.watched} of ${c.total} ${NAMES[c.type].toLowerCase()}`).join(', ')
                  : 'no camera has marked this room yet'}
              </p>
            )}
            {cameras.length > 0 && (
              <ul className="w-full space-y-1 border-t pt-2 text-xs" aria-label="Cameras that reported">
                {cameras.map((c) => {
                  const age = Math.round((now - c.ts) / 1000)
                  const live = age < 6
                  return (
                    <li key={c.cameraId} className="flex items-center justify-between gap-2">
                      <span className="num truncate" title={c.cameraId}>
                        <span className={`mr-1 inline-block size-2 rounded-full ${live ? 'bg-occupied' : 'bg-waste'}`} aria-hidden />
                        {c.sourceKind.replace('_', ' ')}
                      </span>
                      <span className="num text-muted-foreground">
                        {live ? 'live' : `silent ${age < 120 ? `${age} s` : `${Math.round(age / 60)} min`}`} · confidence {c.confidence.toFixed(2)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/camera/${room.id}/new`}>Add a camera on this device</Link>
            </Button>
          </CardContent>
        </Card>
        <Surveyor room={room} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today in {room.id}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="num">{s.kwh.toFixed(4)} kWh this session</p>
            <p className="num">{formatMoney(s.cost, 2)} spent</p>
            <p className="num text-waste">{formatMoney(s.wasteCost, 2)} while empty</p>
            <p className="num">{s.co2Kg.toFixed(4)} kg CO2</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent events</CardTitle>
          </CardHeader>
          <CardContent>
            {roomEvents.length === 0 ? (
              <EmptyState icon={Power} title="Nothing yet" />
            ) : (
              <ul className="space-y-1 text-sm">
                {roomEvents.map((e) => (
                  <li key={e.id}>
                    <span className="num mr-2 text-xs text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
                    {e.text}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
