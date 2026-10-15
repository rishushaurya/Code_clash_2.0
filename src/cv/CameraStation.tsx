// /camera  The camera station. Any device runs one or more cameras for any rooms of the workspace:
// a laptop with two USB cameras, a phone on a tripod, a CCTV stream. The station stays mounted while you
// use the rest of the app, so cameras keep sending when you go back to the twin, and it resumes them after
// a reload. Every camera of the workspace is listed with its live status, and a QR code adds a phone.
// /camera/<room>/new or /camera/<room>/cam-<n> opens with that camera picked (the QR codes use this).

import { Camera, CameraOff, CircleCheck, Copy, Eye, FileVideo, LayoutDashboard, LoaderCircle, Play, Plus, QrCode, ShieldCheck, Smartphone, Trash2, TriangleAlert, Video } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'
import { CAMERA_FRESH_MS } from '@/shared/config'
import { every } from '@/shared/timer'
import { useSite } from '@/shared/site'
import type { CameraConfig, CvReading, Room } from '@/shared/types'
import { joinLink, online, SESSION } from '@/shared/workspace'
import { EmptyState } from '@/ui/components/states'
import { CameraFeed } from './CameraFeed'
import { cameraNumber, createCamera, nextCameraId, postReadings, saveCamera, syncCameras, useCameras } from './cameras'
import { coverage, coverageText } from './coverage'
import { askCameraPermission, listCameras, MIXED_CONTENT, mixedContent, type SourceChoice } from './sources'
import { addFeed, OFFSCREEN, removeFeed, useStation } from './station'

const isPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent)

/** /camera/<room>/<cam> from the address, for the QR codes */
function fromPath(pathname: string) {
  const [, , roomId = '', cam = ''] = pathname.split('/')
  return { roomId: decodeURIComponent(roomId), cam: cam === 'new' ? 'new' : /^cam-\d{1,2}$/.test(cam) ? `${decodeURIComponent(roomId)}/${cam}` : '' }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function PhoneDialog({ roomId, camId }: { roomId: string; camId?: string }) {
  const link = joinLink(`/camera/${roomId}/${camId ? `cam-${cameraNumber(camId)}` : 'new'}`)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" title={camId ? 'Run this camera on a phone' : `Add a phone camera to ${roomId}`}>
          <QrCode aria-hidden /> {camId ? 'On a phone' : 'Add a phone'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{camId ? `Run ${camId} on a phone` : `Add a phone camera to ${roomId}`}</DialogTitle>
          <DialogDescription>Scan with the phone's camera app. The phone joins this workspace and opens the camera, ready to start. Mount it where it sees the room and its lights.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-4">
          <QRCodeSVG value={link} size={240} level="L" aria-label={`QR code that opens the camera for ${roomId} on a phone`} />
        </div>
        <Button variant="outline" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copied')).catch(() => toast.error('Clipboard is blocked'))}>
          <Copy aria-hidden /> Copy link
        </Button>
        <p className="text-xs text-muted-foreground">This code signs a device in to your workspace. Share it only with devices you mount as cameras.{!online() && ' This workspace lives in this browser only, so the phone needs the online version to join.'}</p>
      </DialogContent>
    </Dialog>
  )
}

/** Room-level coverage: only the device types a camera can watch (zones in Setup) */
function CoverageChips({ room, cameras, label }: { room: Room; cameras: CameraConfig[]; label: string }) {
  const watchable = new Set(room.devices.filter((d) => d.zone).map((d) => d.type))
  const rows = coverage(room, cameras).filter((c) => watchable.has(c.type))
  if (!rows.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {rows.map((c) => {
        const full = c.watched === c.total
        return (
          <li key={c.type} className={`num inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${full ? 'border-occupied/30 text-occupied' : 'border-warn/40 bg-warn/10 text-warn'}`}>
            {full ? <CircleCheck className="size-3" aria-hidden /> : <Eye className="size-3" aria-hidden />}
            {coverageText(c)}
          </li>
        )
      })}
    </ul>
  )
}

const DEFAULT = 'default'

function AddCamera({ rooms, initial }: { rooms: Room[]; initial: { roomId: string; cam: string } }) {
  const cameras = useCameras((s) => s.cameras)
  const feeds = useStation((s) => s.feeds)
  const [roomId, setRoomId] = useState(rooms.some((r) => r.id === initial.roomId) ? initial.roomId : (rooms[0]?.id ?? ''))
  const [cam, setCam] = useState(initial.cam || 'new')
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [deviceId, setDeviceId] = useState(DEFAULT)
  const [whepUrl, setWhepUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const room = rooms.find((r) => r.id === roomId)
  const running = new Set(feeds.map((f) => f.camId))
  const existing = Object.entries(cameras).filter(([id, c]) => c.roomId === roomId && !running.has(id))
  const choice = cam !== 'new' && existing.some(([id]) => id === cam) ? cam : 'new'
  const canUseCamera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  /** Before permission, browsers list cameras with empty ids and no names */
  const named = devices.filter((d) => d.deviceId)
  const blocked = mixedContent(whepUrl)

  // Names appear once a camera has been allowed, so look again whenever a camera starts or one is plugged in.
  useEffect(() => {
    if (!canUseCamera) return
    const look = () =>
      listCameras()
        .then((c) => {
          setDevices(c)
          setDeviceId((d) => (d === DEFAULT || c.some((x) => x.deviceId === d) ? d : DEFAULT))
        })
        .catch(() => setDevices([]))
    void look()
    navigator.mediaDevices.addEventListener('devicechange', look)
    return () => navigator.mediaDevices.removeEventListener('devicechange', look)
  }, [canUseCamera, feeds.length])

  async function start(source: SourceChoice) {
    if (!room || busy) return
    setBusy(true)
    try {
      const camId = choice === 'new' ? await createCamera(room) : choice
      addFeed({ camId, source })
      setCam('new')
      toast.success(`${camId} is starting`, { description: 'Mark the room and its lights on the picture, or let the camera find them, then leave it running.' })
    } finally {
      setBusy(false)
    }
  }
  const startDevice = () => {
    const picked = named.find((c) => c.deviceId === deviceId)
    void start({ kind: 'device', deviceId: picked?.deviceId ?? '', label: picked?.label ?? '' })
  }
  const unnamed = devices.length === 0 || devices.every((d) => !d.deviceId || /^Camera \d+$/.test(d.label))

  if (!room) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="size-4" aria-hidden /> Add a camera on this device
        </CardTitle>
        <CardDescription>Pick the room, then the source. Several cameras can watch one room; each keeps its own zones.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="add-room">Room</Label>
            <Select
              value={roomId}
              onValueChange={(v) => {
                setRoomId(v)
                setCam('new')
              }}
            >
              <SelectTrigger id="add-room">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.id} · {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-cam">Camera</Label>
            <Select value={choice} onValueChange={setCam}>
              <SelectTrigger id="add-cam">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New camera ({nextCameraId(roomId)})</SelectItem>
                {existing.map(([id, c]) => (
                  <SelectItem key={id} value={id}>
                    {c.name} ({id}), saved zones
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CoverageChips room={room} cameras={Object.values(cameras)} label={`What the cameras of ${room.id} watch now`} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="add-device">Source</Label>
          {!canUseCamera && <p className="text-sm text-warn">This browser cannot open cameras on this page: cameras need https or localhost. A CCTV stream or a video file still works.</p>}
          {isPhone && canUseCamera && (
            <Button className="h-11 w-full" disabled={busy} onClick={() => void start({ kind: 'rear' })}>
              <Smartphone aria-hidden /> Use this phone's rear camera
            </Button>
          )}
          {canUseCamera && (
            <>
              <div className="flex gap-2">
                <Select value={deviceId} onValueChange={setDeviceId}>
                  <SelectTrigger id="add-device" className="min-w-0 flex-1" aria-label="Camera on this device">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>Default camera</SelectItem>
                    {named.map((c) => (
                      <SelectItem key={c.deviceId} value={c.deviceId}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button disabled={busy} onClick={startDevice}>
                  {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Play aria-hidden />} Start
                </Button>
              </div>
              {unnamed && (
                <p className="text-xs text-muted-foreground">
                  Start asks for the camera and uses the default one.{' '}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      askCameraPermission()
                        .then(listCameras)
                        .then(setDevices)
                        .catch(() => toast.error('Camera permission was refused. Allow it in the address bar.'))
                    }
                  >
                    Allow the camera to see its name
                  </Button>
                </p>
              )}
              {!isPhone && (
                <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={() => void start({ kind: 'rear' })}>
                  <Camera aria-hidden /> Back camera (tablets and phones)
                </Button>
              )}
            </>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (/^https?:\/\//.test(whepUrl) && !blocked) void start({ kind: 'whep', url: whepUrl })
            }}
          >
            <div className="flex gap-2">
              <Input
                value={whepUrl}
                onChange={(e) => setWhepUrl(e.target.value.trim())}
                placeholder="CCTV: https://host:8889/lh1/whep"
                aria-label="CCTV WHEP stream address"
                aria-invalid={blocked || undefined}
                aria-describedby={blocked ? 'whep-help' : undefined}
              />
              <Button type="submit" variant="outline" disabled={!/^https?:\/\//.test(whepUrl) || blocked || busy}>
                Open
              </Button>
            </div>
            {blocked && (
              <p id="whep-help" role="alert" className="flex gap-2 rounded-md bg-warn/10 p-2 text-xs text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {MIXED_CONTENT}
              </p>
            )}
          </form>
          <Label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-2 text-sm font-normal focus-within:ring-2 focus-within:ring-highlight">
            <FileVideo className="size-4" aria-hidden /> Play a recorded video file (this visit only)
            <input type="file" accept="video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void start({ kind: 'file', file: e.target.files[0] })} />
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}

function AllCameras({ rooms, active }: { rooms: Room[]; active: boolean }) {
  const cameras = useCameras((s) => s.cameras)
  const seen = useCameras((s) => s.seen)
  const feeds = useStation((s) => s.feeds)
  const site = useSite((s) => s.site)
  const now = useNow(active)
  const running = new Set(feeds.map((f) => f.camId))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="size-4" aria-hidden /> Every camera in this workspace
        </CardTitle>
        <CardDescription>Live means a reading arrived in the last {CAMERA_FRESH_MS / 1000} seconds. Rooms with several cameras merge them as set in Setup.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {site.floors.map((floor) => {
          const here = rooms.filter((r) => r.floor === floor.level)
          if (!here.length) return null
          return (
            <section key={floor.level} aria-label={floor.building ? `${floor.building}, ${floor.name}` : floor.name} className="space-y-2">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{floor.building ? `${floor.building} · ${floor.name}` : floor.name}</h2>
              {here.map((room) => {
                const ids = [...new Set([...Object.keys(cameras).filter((id) => cameras[id].roomId === room.id), ...Object.keys(seen).filter((id) => seen[id].roomId === room.id)])].sort()
                return (
                  <div key={room.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num font-medium">{room.id}</span>
                      <span className="text-sm text-muted-foreground">{room.name}</span>
                      {ids.length > 1 && <Badge variant="outline">{room.cameraMerge === 'sum' ? 'Counts added' : 'Largest count'}</Badge>}
                      <span className="ml-auto">
                        <PhoneDialog roomId={room.id} />
                      </span>
                    </div>
                    <div className="mt-2">
                      <CoverageChips room={room} cameras={ids.flatMap((id) => (cameras[id] ? [cameras[id]] : []))} label={`What the cameras of ${room.id} watch`} />
                    </div>
                    {ids.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No camera yet.</p>
                    ) : (
                      <ul className="mt-2 divide-y text-sm">
                        {ids.map((id) => {
                          const r: CvReading | undefined = seen[id]
                          const age = r ? now - r.ts : Infinity
                          const live = age < CAMERA_FRESH_MS
                          return (
                            <li key={id} className="flex flex-wrap items-center gap-2 py-2">
                              {live ? <Camera className="size-4 text-occupied" aria-hidden /> : <CameraOff className="size-4 text-muted-foreground" aria-hidden />}
                              <span className="font-medium">{cameras[id]?.name ?? id}</span>
                              <span className="num text-xs text-muted-foreground">{id}</span>
                              <span className={`num text-xs ${live ? 'text-occupied' : 'text-muted-foreground'}`}>
                                {live ? `Live · ${r!.headcount} people · ${Object.values(r!.zones).filter(Boolean).length} zones on` : r ? `Silent for ${Math.round(age / 1000)} s` : 'Not running anywhere'}
                              </span>
                              {running.has(id) && <Badge variant="secondary">This device</Badge>}
                              {cameras[id] && (
                                <span className="basis-full pl-6">
                                  <CoverageChips room={room} cameras={[cameras[id]]} label={`What ${id} watches`} />
                                </span>
                              )}
                              <span className="ml-auto flex gap-1">
                                {!running.has(id) && <PhoneDialog roomId={room.id} camId={id} />}
                                {cameras[id] && !live && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Delete ${id} and its zones`}
                                    title="Delete this camera and its saved zones"
                                    onClick={() => confirm(`Delete ${id} and its saved zones?`) && saveCamera(id, null)}
                                  >
                                    <Trash2 aria-hidden />
                                  </Button>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default function CameraStation({ visible }: { visible: boolean }) {
  const rooms = useSite((s) => s.site.rooms)
  const feeds = useStation((s) => s.feeds)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const sentRef = useRef<CvReading[]>([])
  const [sent, setSent] = useState<CvReading[]>([])
  const initial = fromPath(pathname)

  useEffect(() => void syncCameras(), [])
  // The server keeps each camera's latest reading, so the twin runs on when no browser has it open.
  useEffect(() => (online() ? every(10_000, () => void postReadings()) : undefined), [])
  // The privacy log refreshes only while the page is shown.
  useEffect(() => {
    if (!visible) return
    const t = setInterval(() => setSent(sentRef.current), 2000)
    return () => clearInterval(t)
  }, [visible])
  const onSent = (r: CvReading) => {
    sentRef.current = [r, ...sentRef.current].slice(0, 8)
  }

  // One tree whether shown or not, so hiding the page never restarts a camera.
  return (
    // Hidden, the page stays painted at 1 px: iOS can stop a display:none camera video.
    <main className={visible ? 'mx-auto max-w-7xl space-y-4 p-4' : OFFSCREEN} aria-hidden={!visible} inert={!visible}>
      {visible && (
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="font-heading text-xl font-semibold text-highlight">
            Pratibimb
          </Link>
          <h1 className="text-base font-normal text-muted-foreground [font-family:var(--font-sans)]">Cameras · {SESSION?.name}</h1>
          <Button variant="outline" size="sm" className="ml-auto" asChild>
            <Link to="/">
              <LayoutDashboard aria-hidden /> Live twin
            </Link>
          </Button>
        </header>
      )}
      {visible && !rooms.length && (
        <EmptyState icon={Video} title={online() ? 'Loading the rooms of this workspace' : 'No rooms yet'}>
          <p className="max-w-md text-sm">Cameras report to rooms. Add rooms in Setup, then come back here.</p>
          <Button size="sm" onClick={() => navigate('/setup')}>
            Open Setup
          </Button>
        </EmptyState>
      )}
      {/* Opened from a room's QR code: the phone's next step comes first. */}
      {visible && rooms.length > 0 && initial.roomId && <AddCamera key={`${initial.roomId}|${initial.cam}`} rooms={rooms} initial={initial} />}
      {feeds.length > 0 && (
        <section aria-label="Cameras running on this device" className="space-y-2">
          {visible && <h2 className="text-sm font-medium">Running on this device ({feeds.length})</h2>}
          <div className="grid gap-4 lg:grid-cols-2">
            {feeds.map((f) => {
              const room = rooms.find((r) => r.id === f.camId.split('/')[0])
              return room ? (
                <CameraFeed key={f.camId} feed={f} room={room} visible={visible} onRemove={() => removeFeed(f.camId)} onSent={onSent} />
              ) : (
                <Card key={f.camId} className="p-4 text-sm">
                  {f.camId}: its room is not in this workspace any more.{' '}
                  <Button size="sm" variant="link" onClick={() => removeFeed(f.camId)}>
                    Remove
                  </Button>
                </Card>
              )
            })}
          </div>
          {visible && <p className="text-xs text-muted-foreground">Cameras keep running while you use the other pages of this tab, and start again when you come back to this device.</p>}
        </section>
      )}
      {visible && rooms.length > 0 && (
        <>
          {!initial.roomId && <AddCamera rooms={rooms} initial={initial} />}
          <AllCameras rooms={rooms} active={visible} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-5 text-occupied" aria-hidden /> Privacy inspector
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <dl className="grid grid-cols-2 gap-1 sm:max-w-xs">
                <dt className="text-muted-foreground">Images stored</dt>
                <dd className="num font-semibold text-occupied">0</dd>
                <dt className="text-muted-foreground">Images sent</dt>
                <dd className="num font-semibold text-occupied">0</dd>
              </dl>
              <p className="text-muted-foreground">Everything the cameras on this device send, newest first:</p>
              <pre className="num max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">{sent.length ? sent.map((r) => JSON.stringify(r)).join('\n') : 'Nothing sent yet.'}</pre>
            </CardContent>
          </Card>
          <Toaster position="bottom-right" />
        </>
      )}
    </main>
  )
}
