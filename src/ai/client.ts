// Browser side of the AI and of the workspace's server calls: caches by facts, falls back to templates.
// API keys never reach the browser; every call carries the workspace session.

import type { Command, FactsPack, Recommendation } from '@/shared/types'
import { getSite, type SetupDraft } from '@/shared/site'
import { apiFetch, online } from '@/shared/workspace'
import type { Metric, Topic } from './guides'
import type { SiteChange } from './proposals'
import { templateRecommendation } from './templates'

const cache = new Map<string, Recommendation>()
/** The server said this workspace has no AI key: stop asking for two minutes (a key may be added meanwhile). */
let noKeyUntil = 0
const NO_KEY_PAUSE_MS = 120_000

/** The workspace has no AI key for this feature; the UI links to Settings, Keys and AI */
export class AiNeedsKey extends Error {
  constructor() {
    super('Add an AI key in Settings, Keys and AI')
  }
}
/** The AI call failed for a reason a person can act on, as the server words it ("Your OpenAI key was refused (401)") */
export class AiFailed extends Error {}

/** Reads an AI route's failure: no key, a provider's reason, or a plain status */
async function failure(path: string, res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
  if (res.status === 503 && path.startsWith('/api/ai/')) {
    noKeyUntil = Date.now() + NO_KEY_PAUSE_MS
    return new AiNeedsKey()
  }
  if (res.status === 502 && body.error && body.error !== 'AI unavailable') return new AiFailed(body.error)
  return new Error(`${path} ${res.status}`)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  // A workspace kept on this device has no server session: the templates answer instead.
  if (!online()) throw new Error('offline workspace')
  if (path.startsWith('/api/ai/') && Date.now() < noKeyUntil) throw new AiNeedsKey()
  const res = await apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw await failure(path, res)
  return res.json() as Promise<T>
}

/**
 * Code decides the action from the rule (title, action, priority, the switch-off command); the AI only
 * writes the reason. Same facts, same answer: identical situations never cost a second AI call.
 */
export async function recommend(facts: FactsPack): Promise<Recommendation> {
  const key = JSON.stringify(facts)
  const hit = cache.get(key)
  if (hit) return hit
  const rec = templateRecommendation(facts)
  try {
    const { reason } = await post<{ reason: string }>('/api/ai/recommend', { facts, action: rec.action })
    rec.reason = reason
    rec.source = 'ai'
  } catch {
    // The code-written reason stands.
  }
  cache.set(key, rec)
  return rec
}

export interface ReportSection {
  heading: string
  paragraphs: string[]
  bullets: string[]
}
export interface Report {
  title: string
  sections: ReportSection[]
  source: 'ai' | 'template'
}

export async function aiReport(facts: unknown): Promise<Omit<Report, 'source'>> {
  return post('/api/ai/report', { facts })
}

export interface SurveyItem {
  label: 'light' | 'fan' | 'ac' | 'projector' | 'pc'
  /** [ymin, xmin, ymax, xmax], 0-1000 */
  box: [number, number, number, number]
}

/** AI Surveyor: a ceiling photo becomes a device list. Throws AiNeedsKey when the workspace has no AI key. */
export async function surveyRoom(roomId: string, image: string): Promise<SurveyItem[]> {
  return (await post<{ items: SurveyItem[] }>('/api/ai/surveyor', { roomId, image })).items
}

export interface AuditTrail {
  days: number
  counts: Record<string, number>
  actions: { ts: string; roomId: string | null; text: string }[]
}

/** The stored event log summary; null for a workspace kept on this device or without server storage. */
export async function auditTrail(days = 30): Promise<AuditTrail | null> {
  if (!online()) return null
  try {
    const res = await apiFetch(`/api/events?days=${days}`)
    return res.ok ? ((await res.json()) as AuditTrail) : null
  } catch {
    return null
  }
}

export type CopilotTool =
  | { tool: 'liveSummary' }
  | { tool: 'runScenario'; policy: 'auto_off' | 'daylight' | 'consolidate' | 'combined'; emptyMinutes?: number }
  | { tool: 'topWasters' }
  | { tool: 'getRoom'; roomId: string }
  | { tool: 'patterns' }
  | { tool: 'coverage'; roomId?: string }
  | { tool: 'explainMetric'; metric: Metric; roomId?: string }
  | { tool: 'connectionGuide'; roomId?: string }
  | { tool: 'proposeSiteChange'; change: SiteChange }
  | { tool: 'teach'; topic: Topic }
  | { tool: 'knowledge' }
  | { tool: 'none' }

/** Earlier questions and answers of this conversation, so "and LH-2?" makes sense */
export type Turn = { q: string; a: string }

export async function copilotPlan(question: string, roomIds: string[], history: Turn[] = []): Promise<CopilotTool> {
  return post('/api/ai/copilot', { question, roomIds, history })
}

export async function copilotAnswer(question: string, toolResult: unknown, history: Turn[] = []): Promise<{ answer: string }> {
  return post('/api/ai/copilot', { question, toolResult, history })
}

/** Logs the command and broadcasts it to other devices. The twin applies it locally first. */
export async function logCommand(cmd: Command) {
  try {
    await post('/api/command', cmd)
  } catch {
    // Offline or not deployed: the local twin already applied the command.
  }
}

export async function sendTelegramAlert(facts: FactsPack, commandId: string) {
  if (!getSite().telegramChatId) return
  try {
    await post('/api/alert', { facts, commandId, languages: getSite().alertLanguages })
  } catch {
    // Telegram is a bonus channel; the in-app card has the same button.
  }
}


export async function setupFromText(text: string): Promise<{ draft: SetupDraft; dropped: string[]; unclear: string[] }> {
  return post('/api/ai/setup', { text })
}

/** Writes recorded speech down on the server with the workspace's speech key; `lang` is en, hi or kn */
export async function transcribe(audio: Blob, lang: string): Promise<string> {
  if (!online()) throw new Error('offline workspace')
  const res = await apiFetch(`/api/ai/transcribe?lang=${encodeURIComponent(lang)}`, {
    method: 'POST',
    headers: { 'content-type': audio.type || 'audio/webm' },
    body: audio,
  })
  if (!res.ok) throw await failure('/api/ai/transcribe', res)
  return ((await res.json()) as { text: string }).text
}
