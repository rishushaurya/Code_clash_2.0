// One running camera: plays its source, counts people inside the room boundary, reads the light, fan and
// screen zones, and sends a small reading every 2 s. Frames never leave this browser.
// Its zones and calibration are the camera's saved settings, so they come back on any device.
// Only one tab of the browser runs a camera; it stops sending the moment its picture stops.

import { toast } from 'sonner'
import { AppWindow, CircleCheck, CircleDashed, ClipboardCopy, Gauge, Lightbulb, LightbulbOff, Lock, LockOpen, Moon, RotateCcw, SquareDashed, Sun, Timer, Trash2, TriangleAlert, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import type { Found } from './fixtures'
import { AutoFind, type Placement } from './AutoFind'
import { queueReading, saveCamera, useCameras, zonesFor } from './cameras'
import { getDetectors, type Box, type Detectors } from './detector'
import { classifyZone, insideRegion, isCalibrated, meanLuminance, meanMotion, REF, relativeLuminance, zoneReady, type Frame, type Zone } from './lightZones'
import { buildReading, DETECTION_STALE_MS } from './reading'
import { attachSource, lockExposure, sourceKindOf } from './sources'
import { holdCamera, OFFSCREEN, setSource, type Feed } from './station'

type Phase = 'waiting' | 'starting' | 'running' | 'error'

/** Mean picture brightness (0-255) below which people cannot be counted reliably */
const TOO_DARK = 35

interface Health {
  fps?: number
  /** ms since the last detection */
  sinceDetect?: number
  dark: boolean
  exposureHeld: boolean
}

/** Only the settings are saved; what the camera measures now stays on this device. */
const saved = (zones: Zone[]): CameraZone[] =>
  zones.map(({ id, kind, x, y, w, h, onRef, offRef }) => ({ id, kind: kind ?? 'brightness', x, y, w, h, ...(onRef !== undefined && { onRef }), ...(offRef !== undefined && { offRef }) }))

const WHOLE = { x: 0, y: 0, w: 1, h: 1 }
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function CameraFeed({ feed, room, visible, onRemove, onSent }: { feed: Feed; room: Room; visible: boolean; onRemove: () => void; onSent: (r: CvReading) => void }) {
  const config = useCameras((s) => s.cameras[feed.camId])
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [zones, setZones] = useState<Zone[]>(() => zonesFor(room, config?.zones))
  const [drawing, setDrawing] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [health, setHealth] = useState<Health>({ dark: false, exposureHeld: false })

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detectorsRef = useRef<Detectors | null>(null)
  const peopleRef = useRef<Box[]>([])
  const facesRef = useRef<{ boxes: Box[]; at: number }>({ boxes: [], at: 0 })
  const countsRef = useRef<number[]>([])
  const scoresRef = useRef<number[]>([])
  const nearMissRef = useRef(0)
  const lastDetectRef = useRef<number | undefined>(undefined)
  const darkRef = useRef(false)
  const screensRef = useRef<Found[][]>([])
  const zonesRef = useRef<Zone[]>(zones)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const prevFrameRef = useRef<Frame | null>(null)
  const grabRef = useRef<{ n: number; frames: Frame[]; done: (f: Frame[]) => void } | null>(null)
  const previewRef = useRef<Found[]>([])
  const exposureRef = useRef(false)
  const sourceRef = useRef(feed.source)
  /** When this device last saved the settings: a newer copy from elsewhere replaces the zones */
  const [savedAt, setSavedAt] = useState(config?.updatedAt ?? 0)
  const visibleRef = useRef(visible)
  const onSentRef = useRef(onSent)
  useEffect(() => {
    visibleRef.current = visible
    onSentRef.current = onSent
    sourceRef.current = feed.source
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
  const track = () => (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
  /** Hold exposure before brightness is recorded, and from then on (where the camera allows it) */
  const holdExposure = async () => {
    if (!exposureRef.current) exposureRef.current = await lockExposure(track())
  }

  // Start (and restart after an error) the source once this tab holds the camera; stop it when the feed is removed.
  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    const release = holdCamera(
      feed.camId,
      () => setPhase('waiting'),
      () => {
        setPhase('starting')
        void (async () => {
          try {
            detectorsRef.current ??= await getDetectors()
            const a = await attachSource(videoRef.current!, sourceRef.current)
            if (cancelled) return a.stop()
            stop = a.stop
            if (JSON.stringify(a.source) !== JSON.stringify(sourceRef.current) && a.source.kind === 'device') setSource(feed.camId, a.source)
            setNote(a.note ?? '')
            lastDetectRef.current = undefined
            countsRef.current = []
            exposureRef.current = false
            if (zonesRef.current.some((z) => z.kind === 'brightness' && isCalibrated(z))) await holdExposure()
            setPhase('running')
          } catch (e) {
            if (cancelled) return
            const name = (e as { name?: string })?.name
            setError(
              name === 'NotAllowedError'
                ? 'Camera permission is needed. Allow it in the address bar, then press Try again.'
                : name === 'NotReadableError'
                  ? 'The camera is in use by another app, or it was unplugged. Close the other app, then press Try again.'
                  : e instanceof Error
                    ? e.message
                    : String(e),
            )
            setPhase('error')
          }
        })()
      },
    )
    return () => {
      cancelled = true
      release()
      stop?.()
    }
    // The source is read from a ref: remembering the camera's real id must not restart it.
  }, [feed.camId, attempt])

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
    const color = { person: token('--highlight'), on: token('--status-warn'), off: '#e2e8f0', found: token('--highlight'), occupied: token('--status-occupied') }
    let raf = 0
    // Frame rate from the frames the video decoded (frame callbacks are throttled for a 1 px video).
    const decoded = () => video.getVideoPlaybackQuality?.().totalVideoFrames
    let frames = decoded()
    let framesSince = performance.now()

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!visibleRef.current || !video.videoWidth) return
      // Faces are blurred before anything is shown: with no fresh face detection, keep the last picture.
      if (performance.now() - facesRef.current.at > DETECT_EVERY_MS * 2.5) return
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      ctx.drawImage(video, 0, 0)
      // Padded so a moving head stays covered.
      for (const f of facesRef.current.boxes) {
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
      const line = Math.max(2, canvas.width / 400)
      const font = Math.max(14, canvas.width / 60)
      ctx.lineWidth = line
      ctx.font = `${font}px "JetBrains Mono", monospace`
      const label = (text: string, x: number, y: number, fill: string) => {
        const w = ctx.measureText(text).width + 8
        ctx.fillStyle = 'rgba(20, 17, 14, 0.75)'
        ctx.fillRect(x, y, w + 4, font + 8)
        ctx.fillStyle = fill
        ctx.fillRect(x, y, 4, font + 8)
        ctx.fillStyle = '#faf8f4'
        ctx.fillText(text, x + 8, y + font + 2)
      }
      for (const p of peopleRef.current) {
        ctx.strokeStyle = color.person
        ctx.strokeRect(p.x, p.y, p.w, p.h)
        label(`person ${p.score.toFixed(2)}`, p.x, p.y, color.person)
      }
      for (const z of zonesRef.current) {
        if (!z.w) continue
        const c = z.kind === 'region' ? color.person : z.id === REF ? color.occupied : z.on ? color.on : color.off
        ctx.setLineDash(z.kind === 'region' ? [16, 8] : [8, 6])
        ctx.strokeStyle = c
        ctx.strokeRect(z.x * canvas.width, z.y * canvas.height, z.w * canvas.width, z.h * canvas.height)
        ctx.setLineDash([])
        const text = z.kind === 'region' ? 'room boundary' : z.id === REF ? 'reference wall' : `${z.id} ${z.on === undefined ? 'not ready' : z.on ? 'on' : 'off'}`
        label(text, z.x * canvas.width, z.y * canvas.height, c)
      }
      previewRef.current.forEach((f, i) => {
        ctx.lineWidth = line * 2
        ctx.setLineDash([line * 4, line * 3])
        ctx.strokeStyle = color.found
        ctx.strokeRect(f.x * canvas.width, f.y * canvas.height, f.w * canvas.width, f.h * canvas.height)
        ctx.setLineDash([])
        ctx.lineWidth = line
        const r = font
        const cx = f.x * canvas.width + r
        const cy = f.y * canvas.height + r
        ctx.fillStyle = color.found
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(String(i + 1), cx, cy + font / 3)
        ctx.textAlign = 'start'
      })
    }
    raf = requestAnimationFrame(draw)

    const stopDetect = every(DETECT_EVERY_MS, () => {
      const det = detectorsRef.current
      const t = track()
      // Unplugged or taken by another app: say so. A CCTV stream reconnects by itself (sources.ts).
      if (t?.readyState === 'ended' && sourceRef.current.kind !== 'whep') {
        setError('Camera stopped: it was unplugged, or another app took it. Plug it back in, then press Try again.')
        setPhase('error')
        return
      }
      // No picture (muted track, paused file, not loaded): skip, so readings stop after DETECTION_STALE_MS.
      const live = t ? t.readyState === 'live' && !t.muted : !video.paused
      if (!det || !live || video.readyState < 2 || !video.videoWidth) return
      // Faces only matter for the picture on screen.
      const withFaces = visibleRef.current && document.visibilityState === 'visible'
      let found
      try {
        found = det.detect(video, withFaces)
      } catch {
        return
      }
      if (withFaces) facesRef.current = { boxes: found.faces, at: performance.now() }
      // Only people standing inside the drawn room count; with no boundary, the whole frame is the room.
      const boundary = zonesRef.current.find((z) => z.kind === 'region')
      peopleRef.current = found.people.filter((b) => insideRegion(b, boundary, video.videoWidth, video.videoHeight))
      countsRef.current = [...countsRef.current, peopleRef.current.length].slice(-SMOOTHING_WINDOW)
      scoresRef.current = peopleRef.current.map((p) => p.score)
      nearMissRef.current = found.nearMiss
      screensRef.current = [...screensRef.current, found.screens].slice(-6)

      probe.width = 320
      probe.height = Math.round((320 * video.videoHeight) / video.videoWidth) || 180
      pctx.drawImage(video, 0, 0, probe.width, probe.height)
      const frame = pctx.getImageData(0, 0, probe.width, probe.height)
      const prev = prevFrameRef.current
      prevFrameRef.current = frame
      darkRef.current = meanLuminance(frame, WHOLE) < TOO_DARK
      const ref = zonesRef.current.find((z) => z.id === REF && z.w > 0)
      const refLum = ref ? meanLuminance(frame, ref) : undefined
      zonesRef.current = zonesRef.current.map((z) => {
        if (!z.w || z.kind === 'region') return z
        if (z.id === REF) return { ...z, lum: refLum }
        const value = z.kind === 'motion' ? (prev ? meanMotion(prev, frame, z) : 0) : relativeLuminance(meanLuminance(frame, z), refLum)
        return { ...z, lum: value, on: classifyZone(z, value, MOTION_ON_THRESHOLD) }
      })
      lastDetectRef.current = Date.now()

      const g = grabRef.current
      if (g) {
        g.frames.push(frame)
        if (g.frames.length >= g.n) {
          grabRef.current = null
          g.done(g.frames)
        }
      }
    })

    const stopPublish = every(READING_EVERY_MS, () => {
      const now = Date.now()
      const reading = buildReading(
        {
          roomId: room.id,
          cameraId: feed.camId,
          sourceKind: sourceKindOf(sourceRef.current),
          counts: countsRef.current,
          scores: scoresRef.current,
          nearMiss: nearMissRef.current,
          zones: zonesRef.current,
          lastDetectAt: lastDetectRef.current,
        },
        now,
      )
      if (reading) {
        send('reading', reading)
        queueReading(reading)
        onSentRef.current(reading)
      }
      if (!visibleRef.current) return
      const nowFrames = decoded()
      const fps = nowFrames !== undefined && frames !== undefined ? Math.round(((nowFrames - frames) * 1000) / (performance.now() - framesSince)) : track()?.getSettings().frameRate
      frames = nowFrames
      framesSince = performance.now()
      setCount(reading ? reading.headcount : null)
      setZones(zonesRef.current)
      setHealth({ fps, sinceDetect: lastDetectRef.current === undefined ? undefined : now - lastDetectRef.current, dark: darkRef.current, exposureHeld: exposureRef.current })
    })

    return () => {
      cancelAnimationFrame(raf)
      stopDetect()
      stopPublish()
      grabRef.current = null
    }
  }, [phase, room.id, feed.camId])

  /** The next `n` probe frames, one per detection; fails when the picture stops */
  const grab = (n: number) =>
    new Promise<Frame[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        grabRef.current = null
        reject(new Error('No picture'))
      }, n * DETECT_EVERY_MS * 4 + 2000)
      grabRef.current = {
        n,
        frames: [],
        done: (f) => {
          clearTimeout(timer)
          resolve(f)
        },
      }
    })

  // Zone marking: drag a box on the live picture, or use the keyboard.
  const toFrame = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  /** A new reference patch changes the brightness scale, so every light and screen calibration starts again */
  const withScale = (next: Zone[], id: string) => (id === REF ? next.map((z) => (z.kind === 'brightness' && z.id !== REF ? { ...z, onRef: undefined, offRef: undefined, on: undefined } : z)) : next)
  const updateZone = (id: string, patch: Partial<Zone>, save = true) => {
    zonesRef.current = zonesRef.current.map((z) => (z.id === id ? { ...z, ...patch } : z))
    if ('w' in patch || 'x' in patch) zonesRef.current = withScale(zonesRef.current, id)
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
      updateZone(drawing, e.shiftKey ? { w: clamp(z.w + dx), h: clamp(z.h + dy), onRef: undefined, offRef: undefined } : { x: clamp(z.x + dx), y: clamp(z.y + dy), onRef: undefined, offRef: undefined })
    } else return
    e.preventDefault()
  }
  const mark = (id: string) => {
    setDrawing(id)
    canvasRef.current?.focus()
  }
  const calibrate = async (id: string, which: 'onRef' | 'offRef') => {
    const z = zonesRef.current.find((x) => x.id === id)
    if (z?.kind === 'brightness') await holdExposure()
    const now = zonesRef.current.find((x) => x.id === id)
    if (now?.lum !== undefined) updateZone(id, { [which]: Math.round(now.lum * 10) / 10, on: which === 'onRef' })
  }
  const place = (placements: Placement[]) => {
    for (const p of placements) zonesRef.current = zonesRef.current.map((z) => (z.id === p.id ? { ...z, ...p.box, onRef: p.onRef, offRef: p.offRef, on: undefined } : z))
    setZones(zonesRef.current)
    persist(zonesRef.current)
    const uncalibrated = placements.filter((p) => !p.id.startsWith('F') && p.onRef === undefined).map((p) => p.id)
    toast.success(`${placements.length} ${placements.length === 1 ? 'zone' : 'zones'} marked`, {
      description: uncalibrated.length ? `Record on and off for ${uncalibrated.join(', ')}.` : 'They report from the next detection.',
    })
  }

  const label = (id: string) => zonesOf(room).find((z) => z.id === id)?.label ?? ''
  const name = config?.name ?? `Camera ${feed.camId.split('/cam-')[1]}`
  const deviceZones = zones.filter((z) => z.kind !== 'region' && z.id !== REF)
  const ready = deviceZones.filter((z) => zoneReady({ ...z, kind: z.kind ?? 'brightness' })).length
  const stale = phase === 'running' && health.sinceDetect !== undefined && health.sinceDetect > DETECTION_STALE_MS
  const running = phase === 'running'
  const boundary = zones.find((z) => z.kind === 'region')
  const ref = zones.find((z) => z.id === REF)

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
        <span role="status" className={`num ml-auto rounded-md px-2 py-1 text-sm ${running && !stale && count !== null ? 'bg-occupied/10 text-occupied' : 'bg-muted text-muted-foreground'}`}>
          {phase === 'waiting'
            ? 'In another tab'
            : phase === 'starting'
              ? 'Starting'
              : phase === 'error'
                ? 'Stopped'
                : stale
                  ? 'No picture'
                  : count === null
                    ? 'Counting'
                    : `${count} ${count === 1 ? 'person' : 'people'}`}
        </span>
        <Button size="icon" variant="ghost" aria-label={`Stop and remove ${name} from this device`} title="Stop this camera on this device (its settings stay saved)" onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <video ref={videoRef} className={OFFSCREEN} muted playsInline aria-hidden />
        {phase === 'waiting' && (
          <div role="status" className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
            <AppWindow className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              <span className="font-medium">Running in another tab of this browser.</span> <span className="text-muted-foreground">One tab runs each camera so the room is not counted twice. This tab takes over if that tab closes.</span>
            </p>
          </div>
        )}
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
        {note && running && (
          <p className="flex items-start gap-2 rounded-md bg-warn/10 p-2 text-sm text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {note}
          </p>
        )}
        {stale && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-waste/40 bg-waste/10 p-2 text-sm">
            <TriangleAlert className="size-4 text-waste" aria-hidden />
            <span className="flex-1">Camera stopped sending: no picture for {Math.round((health.sinceDetect ?? 0) / 1000)} s. Readings pause until it returns.</span>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCcw aria-hidden /> Try again
            </Button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          aria-label={drawing ? `Marking ${drawing}: press Enter to place a box, arrows to move it, Shift and arrows to resize, Escape to finish` : `Live view of ${room.id} with faces blurred`}
          className={running ? `w-full touch-none rounded-lg bg-muted ${drawing ? 'cursor-crosshair ring-2 ring-highlight' : ''}` : 'hidden'}
          tabIndex={drawing ? 0 : -1}
          onKeyDown={onKey}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
        {running && <HealthRow health={health} />}
        <details className="group rounded-lg border p-3 text-sm" open={!config || ready < deviceZones.length ? true : undefined}>
          <summary className="cursor-pointer font-medium">
            Zones and calibration{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {ready} of {deviceZones.length} device zones ready
            </span>
          </summary>
          <div className="mt-3 space-y-4">
            <p className="text-muted-foreground">
              Mark the floor of the room, a patch of plain wall, then a box around each light, fan or screen this camera can see, or let the camera find them. Zones this camera cannot see can stay empty: another camera can watch them.
            </p>
            <AutoFind
              zones={zones}
              grab={grab}
              screens={() => ({ seen: screensRef.current, w: videoRef.current?.videoWidth ?? 1, h: videoRef.current?.videoHeight ?? 1 })}
              onPreview={(f) => (previewRef.current = f)}
              onApply={place}
              onBeforeCapture={holdExposure}
              label={label}
              disabled={!running || stale}
            />
            <ul className="divide-y rounded-lg border">
              {boundary && (
                <ZoneRow title="Room boundary" hint={boundary.w > 0 ? 'Only people standing inside it count' : 'Optional: people anywhere in the picture count'} done={boundary.w > 0}>
                  <MarkButton active={drawing === boundary.id} disabled={!running} onClick={() => mark(boundary.id)} title="Drag around the floor of the room so people in a corridor or doorway are not counted" />
                  {boundary.w > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => updateZone(boundary.id, { x: 0, y: 0, w: 0, h: 0 })} title="Count people anywhere in the picture">
                      Clear
                    </Button>
                  )}
                </ZoneRow>
              )}
              {ref && (
                <ZoneRow
                  title="Reference wall"
                  hint={
                    ref.w > 0
                      ? 'Lights are read relative to it, so the camera adjusting its own brightness does not fool them'
                      : health.exposureHeld
                        ? 'Not needed while exposure is held. Marking it resets light calibrations.'
                        : 'Recommended while exposure is automatic: a patch of plain wall no lamp shines on directly. Marking it resets light calibrations.'
                  }
                  done={ref.w > 0}
                >
                  <MarkButton active={drawing === ref.id} disabled={!running} onClick={() => mark(ref.id)} title="Drag a box on a plain patch of wall" />
                  {ref.w > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => updateZone(ref.id, { x: 0, y: 0, w: 0, h: 0 })} title="Read raw brightness instead">
                      Clear
                    </Button>
                  )}
                </ZoneRow>
              )}
              {deviceZones.map((z) => {
                const isFan = z.kind === 'motion'
                const ok = zoneReady({ ...z, kind: z.kind ?? 'brightness' })
                const recorded = z.onRef !== undefined && z.offRef !== undefined
                return (
                  <ZoneRow
                    key={z.id}
                    title={
                      <>
                        <span className="num">{z.id}</span> <span className="text-xs font-normal text-muted-foreground">{label(z.id)}</span>
                      </>
                    }
                    hint={
                      !z.w
                        ? 'Not marked'
                        : isFan
                          ? recorded
                            ? 'Uses your on and off recordings'
                            : 'Works from its motion; record on and off to tune it'
                          : !recorded
                            ? 'Record it once on and once off'
                            : !ok
                              ? 'On and off look the same: mark the box tighter on the fixture and record again'
                              : 'Ready'
                    }
                    done={ok}
                    warn={z.w > 0 && !ok}
                    state={ok && z.on !== undefined ? z.on : undefined}
                  >
                    <MarkButton active={drawing === z.id} disabled={!running} onClick={() => mark(z.id)} title="Drag on the picture, or use Enter and the arrow keys, to mark this zone" />
                    <Button size="sm" variant="outline" disabled={!z.w || !running} onClick={() => void calibrate(z.id, 'onRef')} title={isFan ? 'Record the motion with the fan running' : 'Record the brightness with this device on'}>
                      <Lightbulb aria-hidden /> On
                    </Button>
                    <Button size="sm" variant="outline" disabled={!z.w || !running} onClick={() => void calibrate(z.id, 'offRef')} title={isFan ? 'Record the motion with the fan still' : 'Record the brightness with this device off'}>
                      <LightbulbOff aria-hidden /> Off
                    </Button>
                  </ZoneRow>
                )
              })}
            </ul>
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

function MarkButton({ active, ...props }: { active: boolean; disabled: boolean; onClick: () => void; title: string }) {
  return (
    <Button size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} {...props}>
      <SquareDashed aria-hidden /> {active ? 'Marking' : 'Mark'}
    </Button>
  )
}

function ZoneRow({ title, hint, done, warn, state, children }: { title: React.ReactNode; hint: string; done: boolean; warn?: boolean; state?: boolean; children: React.ReactNode }) {
  const Icon = done ? CircleCheck : warn ? TriangleAlert : CircleDashed
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <Icon className={`size-4 shrink-0 ${done ? 'text-occupied' : warn ? 'text-warn' : 'text-muted-foreground'}`} aria-hidden />
      <div className="min-w-40 flex-1">
        <p className="font-medium">
          {title}
          {state !== undefined && (
            <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-normal ${state ? 'bg-warn/15 text-warn' : 'bg-muted text-muted-foreground'}`}>
              {state ? 'On now' : 'Off now'}
            </span>
          )}
        </p>
        <p className={`text-xs ${warn ? 'text-warn' : 'text-muted-foreground'}`}>{hint}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  )
}

function HealthRow({ health }: { health: Health }) {
  const since = health.sinceDetect
  const items = [
    { icon: Gauge, text: health.fps !== undefined ? `${health.fps} fps` : 'Frame rate unknown', warn: health.fps !== undefined && health.fps < 5, title: 'Frames per second the camera delivers' },
    { icon: Timer, text: since === undefined ? 'Not detected yet' : `Detected ${(since / 1000).toFixed(1)} s ago`, warn: since === undefined || since > DETECTION_STALE_MS, title: 'When people and zones were last read' },
    { icon: health.dark ? Moon : Sun, text: health.dark ? 'Too dark to count people' : 'Light good for counting', warn: health.dark, title: 'Brightness of the whole picture' },
    { icon: health.exposureHeld ? Lock : LockOpen, text: health.exposureHeld ? 'Exposure held' : 'Exposure automatic', warn: false, title: health.exposureHeld ? 'The camera keeps its brightness, so lights read steadily' : 'This camera adjusts its brightness by itself; mark a reference wall to keep light readings steady' },
  ]
  return (
    <ul aria-label="Camera health" className="flex flex-wrap gap-2 text-xs">
      {items.map(({ icon: Icon, text, warn, title }) => (
        <li key={title} title={title} className={`num inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${warn ? 'border-warn/40 bg-warn/10 text-warn' : 'text-muted-foreground'}`}>
          <Icon className="size-3.5" aria-hidden /> {text}
        </li>
      ))}
    </ul>
  )
}
