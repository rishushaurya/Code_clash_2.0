// One check per Phase 0 camera fix (docs/PLAN.md section 2, C1 to C16), each failing if its bug comes back.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CALIBRATION_MIN_GAP } from '@/shared/config'
import type { CvReading } from '@/shared/types'
import { postReadings, queueReading } from './cameras'
import { NEAR_MISS_FLOOR, nextTimestamp, sortDetections } from './detector'
import { classify, isCalibrated, relativeLuminance, zoneReady, type Zone } from './lightZones'
import { buildReading, confidenceOf, DETECTION_STALE_MS, type Measured } from './reading'
import { backoff, mixedContent, openDevice } from './sources'

import { holdCamera, OFFSCREEN } from './station'

/** A fake MediaDevices: `ids` are the cameras that exist now, with their labels */
function media(ids: Record<string, string>, defaultId = Object.keys(ids)[0]) {
  const getUserMedia = vi.fn(async ({ video }: { video: MediaTrackConstraints }) => {
    const want = (video.deviceId as { exact?: string } | undefined)?.exact
    if (want && !ids[want]) throw Object.assign(new Error('not found'), { name: 'OverconstrainedError' })
    const id = want ?? defaultId
    const track = { label: ids[id], getSettings: () => ({ deviceId: id }), stop() {} }
    return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
  })
  const enumerateDevices = vi.fn(async () => Object.entries(ids).map(([deviceId, label]) => ({ kind: 'videoinput', deviceId, label }) as MediaDeviceInfo))
  return { getUserMedia, enumerateDevices }
}

const measured = (patch: Partial<Measured> = {}): Measured => ({
  roomId: 'LH-1',
  cameraId: 'LH-1/cam-1',
  sourceKind: 'webcam',
  counts: [3, 3, 3],
  scores: [0.9, 0.7, 0.8],
  nearMiss: NEAR_MISS_FLOOR,
  zones: [],
  lastDetectAt: 10_000,
  ...patch,
})

describe('C1 first visit: Start works before camera permission', () => {
  it('opens the default camera when the browser hides device ids, and remembers its real id and name', async () => {
    const m = media({ abc: 'USB Camera' })
    const { source, note } = await openDevice({ kind: 'device', deviceId: '', label: '' }, m)
    expect(m.getUserMedia.mock.calls[0][0].video).not.toHaveProperty('deviceId')
    expect(source).toEqual({ kind: 'device', deviceId: 'abc', label: 'USB Camera' })
    expect(note).toBeUndefined()
  })
})

describe('C2 stale saved camera id', () => {
  it('falls back to the camera with the same name, quietly', async () => {
    const m = media({ new1: 'Front cam', other: 'Back cam' })
    const { source, note } = await openDevice({ kind: 'device', deviceId: 'old1', label: 'Back cam' }, m)
    expect(source).toMatchObject({ deviceId: 'other', label: 'Back cam' })
    expect(note).toBeUndefined()
  })

  it('then to the default camera, and says so in plain words', async () => {
    const { source, note } = await openDevice({ kind: 'device', deviceId: 'old1', label: 'Gone cam' }, media({ new1: 'Front cam' }))
    expect(source).toMatchObject({ deviceId: 'new1' })
    expect(note).toBe('Gone cam was not found, so the default camera is used.')
  })

  it('still reports a refused permission as it is', async () => {
    const m = { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })), enumerateDevices: vi.fn() }
    await expect(openDevice({ kind: 'device', deviceId: 'x', label: 'X' }, m)).rejects.toMatchObject({ name: 'NotAllowedError' })
  })
})

describe('C3 frozen or unplugged camera', () => {
  it('stops sending once no detection has run for 3 s', () => {
    expect(buildReading(measured(), 10_000 + DETECTION_STALE_MS)).not.toBeNull()
    expect(buildReading(measured(), 10_001 + DETECTION_STALE_MS)).toBeNull()
  })
})

describe('C4 no reading before the first detection', () => {
  it('sends nothing, instead of zero people, until a detection ran', () => {
    expect(buildReading(measured({ lastDetectAt: undefined, counts: [] }), 1)).toBeNull()
    expect(buildReading(measured({ counts: [] }), 10_000)).toBeNull()
    expect(buildReading(measured(), 10_500)?.headcount).toBe(3)
  })
})

describe('C5 http stream on an https page', () => {
  it('is recognised as mixed content, except on loopback', () => {
    expect(mixedContent('http://10.0.0.5:8889/lh1/whep', 'https:')).toBe(true)
    expect(mixedContent('https://cctv.campus.in:8889/lh1/whep', 'https:')).toBe(false)
    expect(mixedContent('http://localhost:8889/lh1/whep', 'https:')).toBe(false)
    expect(mixedContent('http://10.0.0.5:8889/lh1/whep', 'http:')).toBe(false)
  })
})

describe('C6 CCTV reconnect', () => {
  it('waits longer after each failed attempt, up to 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoff)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })
})

describe('C7 and C8 one shared detector set', () => {
  it('keeps VIDEO timestamps strictly increasing when feeds call within the same millisecond', () => {
    const a = nextTimestamp(5_000_000)
    const b = nextTimestamp(5_000_000)
    const c = nextTimestamp(4_000_000)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
})

describe('C9 brightness relative to a reference wall patch', () => {
  const lamp: Zone = { id: 'L1', x: 0, y: 0, w: 0.1, h: 0.1, onRef: relativeLuminance(200, 50), offRef: relativeLuminance(60, 50) }
  it('reads the same state when daylight or auto-exposure scales the whole picture', () => {
    expect(classify(lamp, relativeLuminance(60, 50))).toBe(false)
    // Morning sun: the wall and the fixture both look 60 % brighter; raw luminance 96 would sit near "on".
    expect(classify(lamp, relativeLuminance(96, 80))).toBe(false)
    // Auto-exposure darkened everything when the lamp came on.
    expect(classify(lamp, relativeLuminance(150, 37))).toBe(true)
  })
  it('stays inside the 0-255 calibration range', () => {
    expect(relativeLuminance(255, 1)).toBe(255)
    expect(relativeLuminance(80, undefined)).toBe(80)
  })
})

describe('C10 one calibration threshold', () => {
  it('the marking panel and the classifier agree at CALIBRATION_MIN_GAP', () => {
    const z = (gap: number): Zone => ({ id: 'L1', kind: 'brightness', x: 0, y: 0, w: 0.1, h: 0.1, onRef: 100 + gap, offRef: 100 })
    expect(isCalibrated(z(CALIBRATION_MIN_GAP - 1))).toBe(false)
    expect(zoneReady({ ...z(CALIBRATION_MIN_GAP - 1), kind: 'brightness' })).toBe(false)
    expect(classify(z(CALIBRATION_MIN_GAP - 1), 200)).toBeUndefined()
    expect(isCalibrated(z(CALIBRATION_MIN_GAP))).toBe(true)
    expect(zoneReady({ ...z(CALIBRATION_MIN_GAP), kind: 'brightness' })).toBe(true)
  })
})

describe('C12 one tab per camera', () => {
  it('runs a camera in the tab holding its lock; another tab waits and takes over on release', async () => {
    const started: string[] = []
    const waiting: string[] = []
    const releaseA = holdCamera('LH-1/cam-1', () => waiting.push('A'), () => started.push('A'))
    await vi.waitFor(() => expect(started).toEqual(['A']))
    const releaseB = holdCamera('LH-1/cam-1', () => waiting.push('B'), () => started.push('B'))
    await vi.waitFor(() => expect(waiting).toEqual(['B']))
    expect(started).toEqual(['A'])
    releaseA()
    await vi.waitFor(() => expect(started).toEqual(['A', 'B']))
    releaseB()
  })
})

describe('C13 hidden video keeps painting on iPhone', () => {
  it('keeps the video on the page, 1 px and transparent, never display:none', () => {
    expect(OFFSCREEN).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/)
    expect(OFFSCREEN).toMatch(/size-px/)
    expect(OFFSCREEN).toMatch(/opacity-0/)
  })
})

describe('C14 honest confidence when nobody is seen', () => {
  it('is the doubt the detector had, not 1', () => {
    expect(confidenceOf([], NEAR_MISS_FLOOR)).toBe(0.85)
    expect(confidenceOf([], 0.35)).toBe(0.65)
    expect(confidenceOf([0.9, 0.7], 0.3)).toBe(0.8)
  })
  it('takes the best rejected person as the near miss, and screens apart', () => {
    const d = (categoryName: string, score: number) => ({ boundingBox: { originX: 1, originY: 2, width: 3, height: 4 }, categories: [{ categoryName, score }] })
    const s = sortDetections([d('person', 0.9), d('person', 0.3), d('tv', 0.7), d('laptop', 0.2)])
    expect(s.people).toHaveLength(1)
    expect(s.nearMiss).toBe(0.3)
    expect(s.screens).toEqual([{ x: 1, y: 2, w: 3, h: 4, score: 0.7 }])
    expect(sortDetections([]).nearMiss).toBe(NEAR_MISS_FLOOR)
  })
})

describe('C15 readings stored on the server every 10 s', () => {
  afterEach(() => vi.restoreAllMocks())
  it('posts the latest reading of each camera once', async () => {
    const r = (cameraId: string, ts: number) => ({ cameraId, ts }) as CvReading
    queueReading(r('LH-1/cam-1', 1))
    queueReading(r('LH-1/cam-1', 2))
    queueReading(r('LH-2/cam-1', 3))
    const post = vi.fn(async () => new Response(null, { status: 404 }))
    await postReadings(post)
    expect(JSON.parse((post.mock.calls[0] as unknown as [string])[0])).toEqual({ readings: [r('LH-1/cam-1', 2), r('LH-2/cam-1', 3)] })
    await postReadings(post)
    expect(post).toHaveBeenCalledTimes(1)
  })
})
