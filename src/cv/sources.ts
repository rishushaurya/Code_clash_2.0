// Every camera source ends as a playing <video>; detection never knows where it came from.
// docs/INTEGRATIONS.md lists the options.

import type { CameraSourceKind } from '@/shared/types'

export type SourceChoice =
  /** deviceId '' is the browser's default camera (before permission, browsers hide every id) */
  | { kind: 'device'; deviceId: string; label: string }
  | { kind: 'rear' }
  | { kind: 'file'; file: File }
  | { kind: 'whep'; url: string }

const isPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent)

export function sourceKindOf(choice: SourceChoice): CameraSourceKind {
  if (choice.kind === 'file') return 'video_file'
  if (choice.kind === 'whep') return 'cctv'
  if (choice.kind === 'rear' || isPhone()) return 'phone'
  return /usb/i.test(choice.label) ? 'usb' : 'webcam'
}

export async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
}

/** Ask once so device labels become readable, then release the camera. */
export async function askCameraPermission() {
  const s = await navigator.mediaDevices.getUserMedia({ video: true })
  s.getTracks().forEach((t) => t.stop())
}

/**
 * An http:// stream on an https:// page is mixed content: the browser blocks it before it leaves.
 * Loopback addresses are exempt in Chrome and Firefox.
 */
export function mixedContent(url: string, pageProtocol = location.protocol) {
  return pageProtocol === 'https:' && /^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)
}

/** Wait before the n-th reconnect attempt: 1, 2, 4, 8, 16, then every 30 s */
export const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt)

type Media = Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>

/**
 * Opens a camera of this device. A saved id can go stale (Safari rotates ids, Chrome changes them when site data
 * is cleared): then the camera with the same name is used, else the default camera, and `note` says so.
 * Answers the source as it actually opened, so the next resume asks for the right camera.
 */
export async function openDevice(choice: Extract<SourceChoice, { kind: 'device' | 'rear' }>, media: Media = navigator.mediaDevices) {
  const open = (video: MediaTrackConstraints) => media.getUserMedia({ video, audio: false })
  if (choice.kind === 'rear') return { stream: await open({ facingMode: 'environment' }), source: choice as SourceChoice, note: undefined }
  const size = { width: 1280, height: 720 }
  let stream: MediaStream
  let note: string | undefined
  try {
    stream = await open(choice.deviceId ? { deviceId: { exact: choice.deviceId }, ...size } : size)
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (!choice.deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw e
    const same = (await media.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.deviceId && d.label && d.label === choice.label)
    stream = await open(same ? { deviceId: { exact: same.deviceId }, ...size } : size)
    if (!same) note = `${choice.label || 'The saved camera'} was not found, so the default camera is used.`
  }
  const track = stream.getVideoTracks()[0]
  const source: SourceChoice = { kind: 'device', deviceId: track?.getSettings().deviceId ?? choice.deviceId, label: track?.label || choice.label }
  return { stream, source, note }
}

/** MediaMTX and other WHEP servers: WebRTC playback */
async function openWhep(url: string) {
  const pc = new RTCPeerConnection()
  try {
    pc.addTransceiver('video', { direction: 'recvonly' })
    const stream = new MediaStream()
    pc.ontrack = (e) => stream.addTrack(e.track)
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve()
      pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve()
      setTimeout(resolve, 2000)
    })
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: pc.localDescription!.sdp })
    if (!res.ok) throw new Error(`Stream server answered ${res.status}`)
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
    return { stream, pc }
  } catch (e) {
    pc.close()
    throw e
  }
}

/**
 * Keeps a WHEP stream playing in `video`: the first connection must succeed (its error is shown), after that a
 * failed or long-disconnected connection reconnects with back-off for as long as the feed runs.
 */
async function playWhep(video: HTMLVideoElement, url: string) {
  let stopped = false
  let pc: RTCPeerConnection | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  const show = (w: Awaited<ReturnType<typeof openWhep>>) => {
    pc = w.pc
    video.srcObject = w.stream
    void video.play().catch(() => undefined)
    const peer = w.pc
    peer.onconnectionstatechange = () => {
      if (peer !== pc) return
      clearTimeout(timer)
      if (peer.connectionState === 'connected') attempt = 0
      // Disconnected often heals on its own within seconds; failed never does.
      else if (peer.connectionState === 'failed') retry()
      else if (peer.connectionState === 'disconnected') timer = setTimeout(retry, 5000)
    }
  }
  const retry = () => {
    if (stopped) return
    pc?.close()
    pc = null
    clearTimeout(timer)
    timer = setTimeout(() => {
      openWhep(url)
        .then((w) => (stopped ? w.pc.close() : show(w)))
        .catch(retry)
    }, backoff(attempt++))
  }
  show(await openWhep(url))
  return () => {
    stopped = true
    clearTimeout(timer)
    pc?.close()
  }
}

export interface Attached {
  stop: () => void
  /** The source as it opened (a device camera's real id and name) */
  source: SourceChoice
  /** Something the person should know, such as a fallback to the default camera */
  note?: string
}

/** Plays the source in `video` */
export async function attachSource(video: HTMLVideoElement, choice: SourceChoice): Promise<Attached> {
  video.muted = true
  video.playsInline = true
  if (choice.kind === 'file') {
    const url = URL.createObjectURL(choice.file)
    video.srcObject = null
    video.src = url
    video.loop = true
    await video.play()
    return { stop: () => URL.revokeObjectURL(url), source: choice }
  }
  if (choice.kind === 'whep') {
    if (mixedContent(choice.url)) throw new Error(MIXED_CONTENT)
    return { stop: await playWhep(video, choice.url), source: choice }
  }
  const { stream, source, note } = await openDevice(choice)
  video.srcObject = stream
  await video.play()
  return { stop: () => stream.getTracks().forEach((t) => t.stop()), source, note }
}

export const MIXED_CONTENT =
  'This page is https, so the browser blocks an http:// stream. Serve MediaMTX over HTTPS (its webrtcEncryption setting, or a reverse proxy with a certificate), or run the Python edge worker next to the CCTV, which sends only numbers.'

/**
 * Holds the camera's exposure (and white balance) where the camera supports it, so a light switching on does not
 * make the camera darken the whole picture. Answers whether it is held.
 */
export async function lockExposure(track: MediaStreamTrack | undefined) {
  if (!track?.getCapabilities) return false
  const caps = track.getCapabilities() as MediaTrackCapabilities & { exposureMode?: string[]; whiteBalanceMode?: string[] }
  if (!caps.exposureMode?.includes('manual')) return false
  const now = track.getSettings() as MediaTrackSettings & { exposureTime?: number; colorTemperature?: number }
  const set: Record<string, unknown> = { exposureMode: 'manual', ...(now.exposureTime && { exposureTime: now.exposureTime }) }
  if (caps.whiteBalanceMode?.includes('manual')) Object.assign(set, { whiteBalanceMode: 'manual', ...(now.colorTemperature && { colorTemperature: now.colorTemperature }) })
  try {
    await track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] })
    return (track.getSettings() as { exposureMode?: string }).exposureMode === 'manual'
  } catch {
    return false
  }
}
