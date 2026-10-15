// MediaPipe person, screen and face detection, running in this browser. Models and runtime are served
// from our own /public folder, so detection keeps working with no internet on stage.
// One detector set serves every camera of the device: calls run one after another on the main thread,
// so a single clock keeps the VIDEO timestamps increasing across feeds.

import { FaceDetector, FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { PERSON_MIN_SCORE } from '@/shared/config'

export interface Box {
  x: number
  y: number
  w: number
  h: number
  score: number
}

export interface Detection {
  /** People at or above PERSON_MIN_SCORE */
  people: Box[]
  /** The best person candidate below PERSON_MIN_SCORE (at least NEAR_MISS_FLOOR): how unsure "nobody" is */
  nearMiss: number
  /** COCO `tv` and `laptop`: screens and monitors the camera can see */
  screens: Box[]
  /** Only when asked: faces are needed just to blur the picture on screen */
  faces: Box[]
}

export interface Detectors {
  detect(video: HTMLVideoElement, withFaces: boolean): Detection
}

/** Candidates below this score are noise; it is also the doubt left when the detector finds nobody at all */
export const NEAR_MISS_FLOOR = 0.15

let last = 0
/** Strictly increasing milliseconds, whatever the clock's resolution, as MediaPipe's VIDEO mode requires */
export function nextTimestamp(now = performance.now()) {
  last = Math.max(now, last + 1)
  return last
}

type Raw = { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number; categoryName: string }[] }
const toBox = (d: Raw): Box[] => (d.boundingBox ? [{ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height, score: d.categories[0]?.score ?? 0 }] : [])

/** Splits raw detections into counted people, the best near miss and screens */
export function sortDetections(raw: Raw[]): Omit<Detection, 'faces'> {
  const of = (name: string) => raw.filter((d) => d.categories[0]?.categoryName === name)
  const persons = of('person')
  const people = persons.filter((d) => (d.categories[0]?.score ?? 0) >= PERSON_MIN_SCORE).flatMap(toBox)
  const misses = persons.map((d) => d.categories[0]?.score ?? 0).filter((s) => s < PERSON_MIN_SCORE)
  const screens = [...of('tv'), ...of('laptop')].filter((d) => (d.categories[0]?.score ?? 0) >= PERSON_MIN_SCORE).flatMap(toBox)
  return { people, nearMiss: Math.max(NEAR_MISS_FLOOR, ...misses), screens }
}

async function load(): Promise<Detectors> {
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  // CPU on purpose: the int8 person model returns wrong classes on the WebGL GPU delegate in Chrome,
  // and on CPU it already runs in about 30 ms a frame, far inside our 500 ms budget.
  const [objects, faces] = await Promise.all([
    ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/models/efficientdet_lite0.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO',
      scoreThreshold: NEAR_MISS_FLOOR,
      categoryAllowlist: ['person', 'tv', 'laptop'],
      maxResults: 60,
    }),
    FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.4,
    }),
  ])
  return {
    detect(video, withFaces) {
      const found = sortDetections(objects.detectForVideo(video, nextTimestamp()).detections)
      return { ...found, faces: withFaces ? faces.detectForVideo(video, nextTimestamp()).detections.flatMap(toBox) : [] }
    },
  }
}

let shared: Promise<Detectors> | null = null
/** The device's one detector set, loaded on first use; a failed load is retried on the next call */
export function getDetectors() {
  shared ??= load().catch((e) => {
    shared = null
    throw e
  })
  return shared
}
