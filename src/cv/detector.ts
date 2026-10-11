// MediaPipe person and face detection, running in this browser. Models and runtime are served
// from our own /public folder, so detection keeps working with no internet on stage.

import { FaceDetector, FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { PERSON_MIN_SCORE } from '@/shared/config'

export interface Box {
  x: number
  y: number
  w: number
  h: number
  score: number
}

export interface Detectors {
  people(video: HTMLVideoElement, t: number): Box[]
  faces(video: HTMLVideoElement, t: number): Box[]
}

export async function loadDetectors(): Promise<Detectors> {
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  // CPU on purpose: the int8 person model returns wrong classes on the WebGL GPU delegate in Chrome,
  // and on CPU it already runs in about 30 ms a frame, far inside our 500 ms budget.
  const [objects, faces] = await Promise.all([
    ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/models/efficientdet_lite0.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO',
      scoreThreshold: PERSON_MIN_SCORE,
      categoryAllowlist: ['person'],
      maxResults: 60,
    }),
    FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.4,
    }),
  ])

  const toBox = (b: { originX: number; originY: number; width: number; height: number } | undefined, score: number): Box[] =>
    b ? [{ x: b.originX, y: b.originY, w: b.width, h: b.height, score }] : []

  return {
    people: (video, t) => objects.detectForVideo(video, t).detections.flatMap((d) => toBox(d.boundingBox, d.categories[0]?.score ?? 0)),
    faces: (video, t) => faces.detectForVideo(video, t).detections.flatMap((d) => toBox(d.boundingBox, d.categories[0]?.score ?? 0)),
  }
}
