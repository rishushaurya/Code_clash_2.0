// Browser side of the AI and of the workspace's server calls: caches by facts, falls back to templates.
// API keys never reach the browser; every call carries the workspace session.

import type { Command, FactsPack, Recommendation } from '@/shared/types'
import { getSite, type SetupDraft } from '@/shared/site'
import { authHeaders, online } from '@/shared/workspace'
import { templateRecommendation } from './templates'

const cache = new Map<string, Recommendation>()
/** Set when the server says no AI key is configured: stop asking for the rest of the session. */
let aiOff = false

async function post<T>(path: string, body: unknown): Promise<T> {
  // A workspace kept on this device has no server session: the templates answer instead.
  if (!online()) throw new Error('offline workspace')
  const headers: Record<string, string> = { 'content-type': 'application/json', ...authHeaders() }
  if (aiOff && path.startsWith('/api/ai/')) throw new Error('AI not configured')
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
  if (res.status === 503 && path.startsWith('/api/ai/')) aiOff = true
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json() as Promise<T>
}

/** Same facts, same answer: identical situations never cost a second AI call. */
export async function recommend(facts: FactsPack): Promise<Recommendation> {
  const key = JSON.stringify(facts)
  const hit = cache.get(key)
  if (hit) return hit
  let rec: Recommendation
  try {
    const ai = await post<Omit<Recommendation, 'source' | 'command'>>('/api/ai/recommend', { facts })
    const fallback = templateRecommendation(facts)
    rec = { ...ai, command: fallback.command, source: 'ai' }
  } catch {
    rec = templateRecommendation(facts)
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

/** AI Surveyor: a ceiling photo becomes a device list. Throws 'not-configured' when no AI key is set. */
export async function surveyRoom(roomId: string, image: string): Promise<SurveyItem[]> {
  if (!online()) throw new Error('not-configured')
  const res = await fetch('/api/ai/surveyor', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ roomId, image }) })
  if (res.status === 503) throw new Error('not-configured')
  if (!res.ok) throw new Error(`surveyor ${res.status}`)
  return ((await res.json()) as { items: SurveyItem[] }).items
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
    const res = await fetch(`/api/events?days=${days}`, { headers: authHeaders() })
    return res.ok ? ((await res.json()) as AuditTrail) : null
  } catch {
    return null
  }
}

export type CopilotTool =
  | { tool: 'runScenario'; policy: 'auto_off' | 'daylight' | 'consolidate' | 'combined'; emptyMinutes?: number }
  | { tool: 'topWasters' }
  | { tool: 'getRoom'; roomId: string }
  | { tool: 'patterns' }
  | { tool: 'none' }

export async function copilotPlan(question: string, roomIds: string[]): Promise<CopilotTool> {
  return post('/api/ai/copilot', { question, roomIds })
}

export async function copilotAnswer(question: string, toolResult: unknown): Promise<{ answer: string }> {
  return post('/api/ai/copilot', { question, toolResult })
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

/** Writes recorded speech down on the server (Groq Whisper); `lang` is en, hi or kn */
export async function transcribe(audio: Blob, lang: string): Promise<string> {
  if (!online()) throw new Error('offline workspace')
  const res = await fetch(`/api/ai/transcribe?lang=${encodeURIComponent(lang)}`, {
    method: 'POST',
    headers: { 'content-type': audio.type || 'audio/webm', ...authHeaders() },
    body: audio,
  })
  if (!res.ok) throw new Error(`transcribe ${res.status}`)
  return ((await res.json()) as { text: string }).text
}
