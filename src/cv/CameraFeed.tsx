// One running camera: plays its source, counts people inside the room boundary, reads the light, fan and
// screen zones, and sends a small reading every 2 s. Frames never leave this browser.
// Its zones and calibration are the camera's saved settings, so they come back on any device.

import { toast } from 'sonner'
import { ClipboardCopy, Lightbulb, LightbulbOff, SquareDashed, Trash2, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { DETECT_EVERY_MS, MOTION_ON_THRESHOLD, READING_EVERY_MS, SMOOTHING_WINDOW } from '@/shared/config'
import { every } from '@/shared/timer'
import { zonesOf } from '@/shared/site'
import type { CameraZone, CvReading, Room } from '@/shared/types'
import { send } from '@/twin/realtime'
import { ErrorState } from '@/ui/components/states'
import { saveCamera, useCameras, zonesFor } from './cameras'
import { loadDetectors, type Box, type Detectors } from './detector'
import { classifyZone, insideRegion, meanLuminance, meanMotion, median, type Zone } from './lightZones'
import { attachSource, sourceKindOf } from './sources'
import type { Feed } from './station'

type Phase = 'starting' | 'running' | 'error'

/** Only the settings are saved; what the camera measures now stays on this device. */
const saved = (zones: Zone[]): CameraZone[] =>
  zones.map(({ id, kind, x, y, w, h, onRef, offRef }) => ({ id, kind: kind ?? 'brightness', x, y, w, h, ...(onRef !== undefined && { onRef }), ...(offRef !== undefined && { offRef }) }))

export function CameraFeed({ feed, room, visible, onRemove, onSent }: { feed: Feed; room: Room; visible: boolean; onRemove: () => void; onSent: (r: CvReading) => void }) {
  const config = useCameras((s) => s.cameras[feed.camId])
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState('')
  const [zones, setZones] = useState<Zone[]>(() => zonesFor(room, config?.zones))
  const [drawing, setDrawing] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const [attempt, setAttempt] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detectorsRef = useRef<Detectors | null>(null)
  const peopleRef = useRef<Box[]>([])
  const facesRef = useRef<Box[]>([])
  const countsRef = useRef<number[]>([])
  const zonesRef = useRef<Zone[]>(zones)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const prevFrameRef = useRef<ImageData | null>(null)
  /** When this device last saved the settings: a newer copy from elsewhere replaces the zones */
  const [savedAt, setSavedAt] = useState(config?.updatedAt ?? 0)
  const visibleRef = useRef(visible)
  const onSentRef = useRef(onSent)
  useEffect(() => {
    visibleRef.current = visible
    onSentRef.current = onSent
  })

  // Settings changed on another device (or the room gained a light zone): take them, keep the live values.
  const [seenConfig, setSeenConfig] = useState(config)
  if (config !== seenConfig) {
    setSeenConfig(config)
    // Live values return on the next detection, half a second later.
    if (config && config.updatedAt > savedAt) setZones(zonesFor(room, config.zones))
  }
  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  const persist = (next: Zone[]) => {
    const t = Date.now()
    setSavedAt(t)
    saveCamera(feed.camId, { roomId: room.id, name: config?.name ?? `Camera ${feed.camId.split('/cam-')[1]}`, zones: saved(next), updatedAt: t })
  }

  // Start (and restart after an error) the source; stop it when the feed is removed.
  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    ;(async () => {
      try {
        detectorsRef.current ??= await loadDetectors()
        const s = await attachSource(videoRef.current!, feed.source)
        if (cancelled) return s()
        stop = s
        setPhase('running')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission is needed. Allow it in the address bar, then press Try again.' : e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [feed.source, attempt])

  // A phone on a tripod would sleep and stop detecting: hold a screen wake lock while running.
  useEffect(() => {
    if (phase !== 'running' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const take = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined)
    const onVisible = () => document.visibilityState === 'visible' && void take()
    void take()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [phase])

  // Drawing (only while shown), detection and sending (always, on worker timers that keep pace in the background).
  useEffect(() => {
    if (phase !== 'running') return
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const probe = document.createElement('canvas')
    const pctx = probe.getContext('2d', { willReadFrequently: true })!
    const canBlur = 'filter' in CanvasRenderingContext2D.prototype
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!visibleRef.current || !video.videoWidth) return
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      ctx.drawImage(video, 0, 0)
      // Faces are blurred before anything is shown; padded so a moving head stays covered.
      for (const f of facesRef.current) {
        const pad = f.w * 0.3
        ctx.save()
        ctx.beginPath()
        ctx.rect(f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2)
        ctx.clip()
        if (canBlur) {
          ctx.filter = 'blur(18px)'
          ctx.drawImage(video, 0, 0)
        } else {
          ctx.fillStyle = '#334155'
          ctx.fillRect(f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2)
        }
        ctx.restore()
      }
      ctx.lineWidth = Math.max(2, canvas.width / 400)
      ctx.font = `${Math.max(14, canvas.width / 60)}px "JetBrains Mono", monospace`
      for (const p of peopleRef.current) {
        ctx.strokeStyle = '#ff7a45'
        ctx.strokeRect(p.x, p.y, p.w, p.h)
        ctx.fillStyle = '#ff7a45'
        ctx.fillText(`person ${p.score.toFixed(2)}`, p.x + 4, p.y + 18)
      }
      for (const z of zonesRef.current) {
        if (!z.w) continue
        ctx.setLineDash(z.kind === 'region' ? [16, 8] : [8, 6])
        ctx.strokeStyle = z.kind === 'region' ? '#ff7a45' : z.on ? '#f59e0b' : '#94a3b8'
        ctx.strokeRect(z.x * canvas.width, z.y * canvas.height, z.w * canvas.width, z.h * canvas.height)
        ctx.setLineDash([])
        ctx.fillStyle = ctx.strokeStyle
        ctx.fillText(z.kind === 'region' ? 'room boundary' : `${z.id} ${z.on === undefined ? 'not calibrated' : z.on ? 'on' : 'off'}`, z.x * canvas.width + 4, z.y * canvas.height + 18)
      }
    }
    raf = requestAnimationFrame(draw)

    const stopDetect = every(DETECT_EVERY_MS, () => {
      const det = detectorsRef.current
      if (!det || video.readyState < 2) return
      const t = performance.now()
      // Only people standing inside the drawn room count; with no boundary, the whole frame is the room.
      const boundary = zonesRef.current.find((z) => z.kind === 'region')
      peopleRef.current = det.people(video, t).filter((b) => insideRegion(b, boundary, video.videoWidth, video.videoHeight))
      facesRef.current = det.faces(video, t)
      countsRef.current = [...countsRef.current, peopleRef.current.length].slice(-SMOOTHING_WINDOW)

      probe.width = 320
      probe.height = Math.round((320 * video.videoHeight) / video.videoWidth) || 180
      pctx.drawImage(video, 0, 0, probe.width, probe.height)
      const frame = pctx.getImageData(0, 0, probe.width, probe.height)
      const prev = prevFrameRef.current
      prevFrameRef.current = frame
      zonesRef.current = zonesRef.current.map((z) => {
        if (!z.w || z.kind === 'region') return z
        const value = z.kind === 'motion' ? (prev ? meanMotion(prev, frame, z) : 0) : meanLuminance(frame, z)
        return { ...z, lum: value, on: classifyZone(z, value, MOTION_ON_THRESHOLD) }
      })
    })

    const stopPublish = every(READING_EVERY_MS, () => {
      const states: Record<string, boolean> = {}
      for (const z of zonesRef.current) if (z.on !== undefined && z.w && z.kind !== 'region') states[z.id] = z.on
      const people = peopleRef.current
      const reading: CvReading = {
        roomId: room.id,
        cameraId: feed.camId,
        sourceKind: sourceKindOf(feed.source),
        ts: Date.now(),
        headcount: median(countsRef.current),
        zones: states,
        confidence: Number((people.length ? people.reduce((a, p) => a + p.score, 0) / people.length : 1).toFixed(2)),
      }
      send('reading', reading)
      onSentRef.current(reading)
      setCount(reading.headcount)
      if (visibleRef.current) setZones(zonesRef.current)
    })

    return () => {
      cancelAnimationFrame(raf)
      stopDetect()
      stopPublish()
    }
  }, [phase, room.id, feed.camId, feed.source])

  // Zone marking: drag a box on the live picture, or use the keyboard.
  const toFrame = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const updateZone = (id: string, patch: Partial<Zone>, save = true) => {
    zonesRef.current = zonesRef.current.map((z) => (z.id === id ? { ...z, ...patch } : z))
    setZones(zonesRef.current)
    if (save) persist(zonesRef.current)
  }
  const onDown = (e: React.PointerEvent) => {
    if (!drawing) return
    dragRef.current = toFrame(e)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drawing || !dragRef.current) return
    const p = toFrame(e)
    const s = dragRef.current
    updateZone(drawing, { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y), onRef: undefined, offRef: undefined, on: undefined }, false)
  }
  const onUp = () => {
    if (dragRef.current) persist(zonesRef.current)
    dragRef.current = null
    setDrawing(null)
  }
  // Keyboard marking: Enter places a box in the middle, arrows move it, Shift + arrows resize it, Escape finishes.
  const onKey = (e: React.KeyboardEvent) => {
    if (!drawing) return
    const z = zonesRef.current.find((x) => x.id === drawing)
    if (!z) return
    const step = 0.02
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    if (e.key === 'Enter' && !z.w) updateZone(drawing, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })
    else if (e.key === 'Escape' || (e.key === 'Enter' && z.w)) setDrawing(null)
    else if (e.key.startsWith('Arrow') && z.w) {
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      updateZone(drawing, e.shiftKey ? { w: clamp(z.w + dx), h: clamp(z.h + dy) } : { x: clamp(z.x + dx), y: clamp(z.y + dy) })
    } else return
    e.preventDefault()
  }
  const calibrate = (id: string, which: 'onRef' | 'offRef') => {
    const z = zonesRef.current.find((x) => x.id === id)
    if (z?.lum !== undefined) updateZone(id, { [which]: Math.round(z.lum * 10) / 10, on: which === 'onRef' })
  }
  const label = (id: string) => zonesOf(room).find((z) => z.id === id)?.label ?? ''
  const name = config?.name ?? `Camera ${feed.camId.split('/cam-')[1]}`
  /** On and off recordings this close cannot tell the states apart (lighting changed, or the box missed the fixture) */
  const tooClose = (z: Zone) => z.kind !== 'motion' && z.onRef !== undefined && z.offRef !== undefined && Math.abs(z.onRef - z.offRef) < 8
  const calibrated = zones.filter((z) => z.kind !== 'region' && z.w > 0 && (z.kind === 'motion' || (z.onRef !== undefined && z.offRef !== undefined && !tooClose(z)))).length
  const deviceZones = zones.filter((z) => z.kind !== 'region').length

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 px-4">
        <Video className="size-4 text-highlight" aria-hidden />
        <span className="num font-medium">{room.id}</span>
        <Input
          aria-label={`Name of camera ${feed.camId}`}
          className="h-8 w-40"
          defaultValue={name}
          maxLength={40}
          onBlur={(e) => e.target.value.trim() && e.target.value !== name && saveCamera(feed.camId, { roomId: room.id, name: e.target.value.trim(), zones: saved(zonesRef.current), updatedAt: Date.now() })}
        />
        <span role="status" className={`num ml-auto rounded-md px-2 py-1 text-sm ${phase === 'running' ? 'bg-occupied/10 text-occupied' : 'bg-muted text-muted-foreground'}`}>
          {phase === 'running' ? `${count} ${count === 1 ? 'person' : 'people'}` : phase === 'starting' ? 'Starting' : 'Stopped'}
        </span>
        <Button size="icon" variant="ghost" aria-label={`Stop and remove ${name} from this device`} title="Stop this camera on this device (its settings stay saved)" onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <video ref={videoRef} className="hidden" muted playsInline />
        {phase === 'starting' && <Skeleton className="aspect-video w-full" aria-label="Starting camera and loading models" />}
        {phase === 'error' && (
          <ErrorState
            message={error}
            onRetry={() => {
              setPhase('starting')
              setAttempt((n) => n + 1)
            }}
          />
        )}
        <canvas
          ref={canvasRef}
          aria-label={drawing ? `Marking ${drawing}: press Enter to place a box, arrows to move it, Shift and arrows to resize, Escape to finish` : `Live view of ${room.id} with faces blurred; ${count} people detected`}
          className={phase === 'running' ? `w-full touch-none rounded-lg ${drawing ? 'cursor-crosshair ring-2 ring-highlight' : ''}` : 'hidden'}
          tabIndex={drawing ? 0 : -1}
          onKeyDown={onKey}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
        <details className="rounded-lg border p-3 text-sm" open={!config || calibrated < deviceZones ? true : undefined}>
          <summary className="cursor-pointer font-medium">
            Zones and calibration{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {calibrated} of {deviceZones} device zones ready
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-muted-foreground">Mark the floor of the room, then a box around each light, fan or screen this camera can see. Lights and screens need one recording on and one off; fans work from their motion. Zones this camera cannot see can stay empty: another camera can watch them.</p>
            {zones.map((z) =>
              z.kind === 'region' ? (
                <div key={z.id} className="flex flex-wrap items-center gap-2 border-b pb-3">
                  <span className="w-24 text-xs font-medium">Room boundary</span>
                  <Button size="sm" variant={drawing === z.id ? 'default' : 'outline'} disabled={phase !== 'running'} onClick={() => setDrawing(z.id)} title="Drag around the floor of the room so people in a corridor or doorway are not counted">
                    <SquareDashed aria-hidden /> Mark
                  </Button>
                  {z.w > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => updateZone(z.id, { x: 0, y: 0, w: 0, h: 0 })} title="Count people anywhere in the picture">
                      Clear
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">{z.w > 0 ? 'Only people inside it count' : 'Optional: the whole picture counts'}</span>
                </div>
              ) : (
                <div key={z.id} className="flex flex-wrap items-center gap-2">
                  <span className="num w-24">
                    {z.id} <span className="text-xs text-muted-foreground">{label(z.id)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant={drawing === z.id ? 'default' : 'outline'}
                    disabled={phase !== 'running'}
                    onClick={() => {
                      setDrawing(z.id)
                      canvasRef.current?.focus()
                    }}
                    title="Drag on the picture, or use Enter and the arrow keys, to mark this zone"
                  >
                    <SquareDashed aria-hidden /> Mark
                  </Button>
                  <Button size="sm" variant="outline" disabled={!z.w || phase !== 'running'} onClick={() => calibrate(z.id, 'onRef')} title={z.kind === 'motion' ? 'Record the motion with the fan running' : 'Record the brightness with this device on'}>
                    <Lightbulb aria-hidden /> On
                  </Button>
                  <Button size="sm" variant="outline" disabled={!z.w || phase !== 'running'} onClick={() => calibrate(z.id, 'offRef')} title={z.kind === 'motion' ? 'Record the motion with the fan still' : 'Record the brightness with this device off'}>
                    <LightbulbOff aria-hidden /> Off
                  </Button>
                  {z.on !== undefined && z.w > 0 && <Badge variant="secondary">{z.on ? 'on' : 'off'}</Badge>}
                  {z.w > 0 && z.kind !== 'motion' && (z.onRef === undefined || z.offRef === undefined) && <span className="text-xs text-warn">Record on and off</span>}
                  {z.w > 0 && tooClose(z) && <span className="text-xs text-warn">On and off look the same: mark the box tighter on the fixture and record again</span>}
                </div>
              ),
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!zones.some((z) => z.w > 0)}
              title="Copy calibrated zones as JSON for the Python edge worker (edge/edge.py --zones)"
              onClick={() =>
                navigator.clipboard
                  .writeText(JSON.stringify(saved(zones.filter((z) => z.w > 0)), null, 2))
                  .then(() => toast.success('Zones copied for the edge worker'))
                  .catch(() => toast.error('Clipboard is blocked in this browser'))
              }
            >
              <ClipboardCopy aria-hidden /> Copy zones
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
