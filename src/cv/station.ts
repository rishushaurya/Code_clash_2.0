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
