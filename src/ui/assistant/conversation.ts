// The Assistant's conversation for this workspace, kept for the browser session (sessionStorage), and the one
// function that answers a question: the AI picks a tool, this browser runs it on the real twin, the AI words the
// answer from the tool's numbers. Offline or without a key, keyword routing and code-written answers stand in.

import { create } from 'zustand'
import { AiFailed, AiNeedsKey, copilotAnswer, copilotPlan, type CopilotTool, type Turn } from '@/ai/client'
import type { connectionGuide } from '@/ai/guides'
import { propose, type Proposal, type SiteChange } from '@/ai/proposals'
import { guessTool, OFF_TOPIC, runTool, templateAnswer } from '@/ai/tools'
import { getSite, pushSite, setSite, useSite } from '@/shared/site'
import { ns } from '@/shared/workspace'

export interface Message {
  id: string
  q: string
  a: string
  tool: CopilotTool['tool']
  /** 'ai' when the AI chose the tool and wrote the answer; 'offline' when code did */
  source: 'ai' | 'offline'
  /** Why the AI did not answer: no key in Settings, or the provider's reason */
  aiProblem?: 'no-key' | string
  steps?: ReturnType<typeof connectionGuide>['methods']
  proposal?: { change: SiteChange; summary: string; rows: Proposal['rows']; state: 'open' | 'approved' | 'dismissed' }
}

const KEY = ns('pratibimb:assistant')
const MAX = 40

function load(): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Message[]
  } catch {
    return []
  }
}

export const useConversation = create<{ messages: Message[]; busy: boolean }>(() => ({ messages: typeof sessionStorage === 'undefined' ? [] : load(), busy: false }))

function save(messages: Message[]) {
  useConversation.setState({ messages })
  try {
    sessionStorage.setItem(KEY, JSON.stringify(messages))
  } catch {
    // Storage blocked: the conversation lasts until the page closes.
  }
}

const update = (id: string, patch: Partial<Message>) => save(useConversation.getState().messages.map((m) => (m.id === id ? { ...m, ...patch } : m)))

export const clearConversation = () => save([])

const problemOf = (e: unknown) => (e instanceof AiNeedsKey ? 'no-key' : e instanceof AiFailed ? e.message : undefined)

/** Answers one question and appends it to the conversation; returns the message for speaking aloud */
export async function ask(question: string): Promise<Message | null> {
  const q = question.trim()
  if (!q || useConversation.getState().busy) return null
  useConversation.setState({ busy: true })
  try {
    return await answer(q)
  } finally {
    useConversation.setState({ busy: false })
  }
}

async function answer(q: string) {
  const history: Turn[] = useConversation
    .getState()
    .messages.slice(-6)
    .map((m) => ({ q: m.q, a: m.a.slice(0, 1500) }))
  let tool: CopilotTool
  let source: Message['source'] = 'ai'
  let aiProblem: string | undefined
  try {
    tool = await copilotPlan(q, getSite().rooms.map((r) => r.id), history)
  } catch (e) {
    tool = guessTool(q)
    source = 'offline'
    aiProblem = problemOf(e)
  }
  const result = runTool(tool)
  let a = tool.tool === 'none' ? OFF_TOPIC : templateAnswer(tool, result, q)
  const failed = 'error' in result && Boolean(result.error)
  // Off-topic, proposals and errors are answered by code; the rest is worded by the AI from the tool's numbers.
  if (source === 'ai' && !failed && tool.tool !== 'none' && tool.tool !== 'proposeSiteChange') {
    try {
      a = (await copilotAnswer(q, result, history)).answer
      // Numbered steps each on their own line, however the AI ran them together.
      if (tool.tool === 'knowledge') a = a.replace(/\s+(?=\d{1,2}\.\s)/g, '\n')
    } catch (e) {
      source = 'offline'
      aiProblem = problemOf(e)
    }
  }
  const msg: Message = { id: crypto.randomUUID(), q, a, tool: tool.tool, source, ...(aiProblem && { aiProblem }) }
  if (tool.tool === 'connectionGuide') msg.steps = (result as ReturnType<typeof connectionGuide>).methods
  if (tool.tool === 'proposeSiteChange' && !failed) {
    const p = propose(getSite(), tool.change)
    if (typeof p !== 'string') msg.proposal = { change: tool.change, summary: p.summary, rows: p.rows, state: 'open' }
  }
  save([...useConversation.getState().messages, msg].slice(-MAX))
  return msg
}

/**
 * The person approved a proposal: check it again against the site as it is now, then save it through the
 * same path as Setup. Returns a sentence for the toast.
 */
export async function approve(id: string): Promise<{ ok: boolean; text: string }> {
  const m = useConversation.getState().messages.find((x) => x.id === id)
  if (!m?.proposal || m.proposal.state !== 'open') return { ok: false, text: 'This change was already handled.' }
  const p = propose(getSite(), m.proposal.change)
  if (typeof p === 'string') return { ok: false, text: p }
  setSite(p.next)
  update(id, { proposal: { ...m.proposal, state: 'approved' } })
  const where = await pushSite(useSite.getState().site)
  return { ok: true, text: where === 'server' ? `${p.summary}. Saved for the whole workspace.` : `${p.summary}. Saved on this device; it uploads when the server is reachable.` }
}

export const dismiss = (id: string) => {
  const m = useConversation.getState().messages.find((x) => x.id === id)
  if (m?.proposal) update(id, { proposal: { ...m.proposal, state: 'dismissed' } })
}
