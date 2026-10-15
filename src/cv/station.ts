// The cameras this device runs, and from which source. Remembered per workspace, so the station resumes
// them after a reload or a visit to another page. Kept apart from the camera code so the app shell can
// check for running cameras without loading the vision models.

import { create } from 'zustand'
import { ns } from '@/shared/workspace'
import type { SourceChoice } from './sources'

export interface Feed {
  /** <roomId>/cam-<n> */
  camId: string
  source: SourceChoice
}

const KEY = ns('pratibimb:station')

function load(): Feed[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Feed[]
  } catch {
    return []
  }
}

export const useStation = create<{ feeds: Feed[] }>(() => ({ feeds: typeof localStorage === 'undefined' ? [] : load() }))

function save(feeds: Feed[]) {
  useStation.setState({ feeds })
  try {
    // A video file cannot be reopened after a reload, so file feeds last for this visit only.
    localStorage.setItem(KEY, JSON.stringify(feeds.filter((f) => f.source.kind !== 'file')))
  } catch {
    // Storage blocked: the feeds run until the page closes.
  }
}

export const addFeed = (feed: Feed) => save([...useStation.getState().feeds.filter((f) => f.camId !== feed.camId), feed])
export const removeFeed = (camId: string) => save(useStation.getState().feeds.filter((f) => f.camId !== camId))

/** The source as it actually opened (a default camera's real id): later resumes ask for that camera */
export const setSource = (camId: string, source: SourceChoice) => save(useStation.getState().feeds.map((f) => (f.camId === camId ? { ...f, source } : f)))

/**
 * Only one tab of this browser runs a camera: `start` runs while this tab holds the camera's lock. If another tab
 * holds it, `onWait` runs and this tab takes over when that tab closes. Returns the release.
 * Without the Web Locks API (old browsers, plain http on a LAN address) the camera just starts.
 */
export function holdCamera(camId: string, onWait: () => void, start: () => void, locks: LockManager | undefined = navigator.locks): () => void {
  let done = false
  const go = () => !done && start()
  if (!locks) {
    go()
    return () => void (done = true)
  }
  const abort = new AbortController()
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  const name = ns(`pratibimb:camera:${camId}`)
  locks
    .request(name, { ifAvailable: true }, (lock) => {
      if (!lock) return null
      go()
      return held
    })
    .then((r) => {
      if (r !== null || done) return
      onWait()
      return locks.request(name, { signal: abort.signal }, () => {
        go()
        return held
      })
    })
    .catch(() => undefined) // aborted on release
  return () => {
    done = true
    abort.abort()
    release()
  }
}

/**
 * Off screen but still painted: iOS Safari can stop decoding a display:none video, so hidden cameras and the
 * station's hidden page stay 1 px and transparent instead.
 */
export const OFFSCREEN = 'pointer-events-none fixed top-0 left-0 size-px overflow-hidden opacity-0'
