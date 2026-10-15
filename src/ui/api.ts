// Reading the workspace's API from a screen. Routes other sessions are still building may answer 404 on this
// deployment; screens show that as "not on this server yet" instead of an error.

import { useCallback, useEffect, useState } from 'react'
import type { AiProvider, AiSettings, KeyStatus } from '@/shared/types'
import { apiFetch, online } from '@/shared/workspace'

export type ApiState<T> =
  | { state: 'loading' }
  | { state: 'ok'; data: T }
  /** The route does not exist here yet, or needs an online workspace */
  | { state: 'missing'; reason: 'server' | 'local' }
  | { state: 'error'; message: string }

/** Calls the API and turns any answer into a message a person can act on */
export async function callApi<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<ApiState<T>> {
  const { json, ...rest } = init
  try {
    const res = await apiFetch(path, json === undefined ? rest : { ...rest, headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
    if (res.status === 404 || res.status === 405 || res.status === 501) return { state: 'missing', reason: 'server' }
    if (!online() && (res.status === 401 || res.status === 403)) return { state: 'missing', reason: 'local' }
    const body = await res.json().catch(() => null)
    if (!res.ok) return { state: 'error', message: (body as { error?: string } | null)?.error ?? `The server answered ${res.status}.` }
    return { state: 'ok', data: body as T }
  } catch {
    return { state: 'error', message: 'The server is not reachable. Check the connection and try again.' }
  }
}

/** GET a route once on mount; `reload` asks again */
export function useApi<T>(path: string | null) {
  const [result, setResult] = useState<ApiState<T>>({ state: 'loading' })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    void callApi<T>(path).then((r) => live && setResult(r))
    return () => {
      live = false
    }
  }, [path, n])
  const reload = useCallback(() => {
    setResult({ state: 'loading' })
    setN((x) => x + 1)
  }, [])
  return [result, reload] as const
}

/** GET /api/keys (Gate 1 contract): what is set, never a value */
export interface KeysResponse {
  keys: KeyStatus[]
  ai: AiSettings
  deployment: Record<AiProvider, boolean>
}

/** GET /api/status: which integrations the deployment itself has keys for */
export type ServerStatus = Partial<Record<'ai' | 'aiVision' | 'workspaces' | 'realtime' | 'telegram' | 'ingest' | 'commandWebhook' | 'tick', boolean>>

export const AI_PROVIDERS: AiProvider[] = ['groq', 'gemini', 'openai', 'anthropic', 'openrouter', 'custom']
