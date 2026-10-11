// Every camera source ends as a playing <video>; detection never knows where it came from.
// docs/BUILD_SPEC.md section 11 lists the options.

import type { CameraSourceKind } from '@/shared/types'

export type SourceChoice =
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

/** MediaMTX and other WHEP servers: WebRTC playback in about twenty lines. */
async function openWhep(url: string) {
  const pc = new RTCPeerConnection()
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
  return { stream, stop: () => pc.close() }
}

/** Plays the source in `video`. Returns a function that stops it. */
export async function attachSource(video: HTMLVideoElement, choice: SourceChoice): Promise<() => void> {
  video.muted = true
  video.playsInline = true
  if (choice.kind === 'file') {
    const url = URL.createObjectURL(choice.file)
    video.srcObject = null
    video.src = url
    video.loop = true
    await video.play()
    return () => URL.revokeObjectURL(url)
  }
  if (choice.kind === 'whep') {
    const { stream, stop } = await openWhep(choice.url)
    video.srcObject = stream
    await video.play()
    return stop
  }
  const constraints: MediaStreamConstraints = {
    video: choice.kind === 'rear' ? { facingMode: 'environment' } : { deviceId: { exact: choice.deviceId }, width: 1280, height: 720 },
    audio: false,
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  video.srcObject = stream
  await video.play()
  return () => stream.getTracks().forEach((t) => t.stop())
}
