// GET /api/status  Which integrations the server has keys for. Booleans only, never the keys.

import { authConfigured } from '../_lib/auth.js'
import { json } from '../_lib/http.js'
import { aiConfigured } from '../_lib/llm.js'

export function GET() {
  const has = (k: string) => Boolean(process.env[k])
  const storage = (has('SUPABASE_URL') || has('VITE_SUPABASE_URL')) && has('SUPABASE_SERVICE_ROLE_KEY')
  return json({
    ai: aiConfigured(),
    aiVision: has('GEMINI_API_KEY') || has('GROQ_API_KEY'),
    workspaces: storage && authConfigured(),
    realtime: storage && has('VITE_SUPABASE_ANON_KEY'),
    telegram: has('TELEGRAM_BOT_TOKEN') && has('TELEGRAM_WEBHOOK_SECRET'),
    ingest: storage && authConfigured(),
    commandWebhook: has('COMMAND_WEBHOOK_URL'),
  })
}
