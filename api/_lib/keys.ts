// Which AI provider, model and key an AI call uses, for a workspace and a task.
// Gate 1 contract: the AI routes call aiCandidates() and try the list in order.
// This first version reads only the deployment's environment keys (today's behaviour). The server
// session replaces it with the workspace's own encrypted keys and AiSettings, falling back to these
// only when the workspace allows it (AiSettings.useDeploymentKeys).

import type { AiProvider, AiTask } from '../../src/shared/types'

export interface AiCandidate {
  provider: AiProvider
  /** OpenAI-compatible chat completions URL, or Gemini's generateContent URL */
  url: string
  apiKey: string
  model: string
  /** 'workspace' when the customer's own key, 'deployment' when the operator's */
  owner: 'workspace' | 'deployment'
}

const gemini = (model: string, apiKey: string): AiCandidate => ({
  provider: 'gemini',
  url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  apiKey,
  model,
  owner: 'deployment',
})

export async function aiCandidates(_workspaceId: string | null, task: AiTask): Promise<AiCandidate[]> {
  const env = process.env
  const out: AiCandidate[] = []
  const groqModel = (task === 'vision' ? env.GROQ_VISION_MODEL : task === 'speech' ? 'whisper-large-v3-turbo' : env.GROQ_MODEL) || (task === 'vision' ? '' : 'openai/gpt-oss-120b')
  const groq: AiCandidate | null = env.GROQ_API_KEY && groqModel ? { provider: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', apiKey: env.GROQ_API_KEY, model: groqModel, owner: 'deployment' } : null
  const geminiModels = [...new Set([env.GEMINI_MODEL?.trim() || 'gemini-flash-latest', 'gemini-flash-lite-latest'])]
  const geminis = env.GEMINI_API_KEY && task !== 'speech' ? geminiModels.map((m) => gemini(m, env.GEMINI_API_KEY!)) : []
  if (task === 'vision') out.push(...geminis, ...(groq ? [groq] : []))
  else out.push(...(groq ? [groq] : []), ...geminis)
  return out
}
