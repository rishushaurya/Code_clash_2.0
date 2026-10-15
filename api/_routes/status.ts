// GET /api/status  Which integrations the server has keys for, and whether the server's minute tick runs.
// Booleans and a time only, never the keys. While serverTick is true the server sends Telegram alerts and
// automatic switch-offs, so the browser twin stops sending its own (no duplicates).

import { authConfigured } from '../_lib/auth.js'
import { rows } from '../_lib/db.js'
import { json } from '../_lib/http.js'
import { aiConfigured } from '../_lib/llm.js'

/** The tick runs every minute; three missed runs mean it stopped */
export const TICK_HEALTHY_MS = 3 * 60_000

export async function GET() {
  const has = (k: string) => Boolean(process.env[k])
  const storage = (has('SUPABASE_URL') || has('VITE_SUPABASE_URL')) && has('SUPABASE_SERVICE_ROLE_KEY')
  const beat = storage ? await rows<{ updated_at: string }>('twin_state?workspace=eq._tick&select=updated_at') : null
  const tickAt = beat?.[0] ? Date.parse(beat[0].updated_at) : null
  return json({
    ai: aiConfigured(),
    aiVision: has('GEMINI_API_KEY') || (has('GROQ_API_KEY') && has('GROQ_VISION_MODEL')),
    workspaces: storage && authConfigured(),
    realtime: storage && has('VITE_SUPABASE_ANON_KEY'),
    telegram: has('TELEGRAM_BOT_TOKEN') && has('TELEGRAM_WEBHOOK_SECRET'),
    ingest: storage && authConfigured(),
    commandWebhook: has('COMMAND_WEBHOOK_URL'),
    serverTick: tickAt !== null && Date.now() - tickAt < TICK_HEALTHY_MS,
    tickAt,
  })
}
