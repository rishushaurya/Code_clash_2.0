// npm run check:keys  Tests every key in .env against its service and prints pass or fail per check.
// It never prints a key. Run it after filling .env, and again after changing a key.

import { existsSync } from 'node:fs'

if (existsSync('.env')) process.loadEnvFile('.env')
// A service that does not answer within 15 s counts as a failure instead of hanging the check.
const fetchOnce = globalThis.fetch
globalThis.fetch = (url, init = {}) => fetchOnce(url, { signal: AbortSignal.timeout(15_000), ...init })
const env = process.env
let failed = 0
const say = (state, name, detail = '') => {
  if (state === 'FAIL') failed++
  console.log(`${state.padEnd(4)}  ${name}${detail ? `: ${detail}` : ''}`)
}
const short = async (res) => `${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 140)}`
const json = (o) => JSON.stringify(o)

// Supabase
const raw = env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''
// The app also accepts the REST address (…/rest/v1/); the checker tests what the app will use.
const url = raw.replace(/(\/rest\/v1)?\/*$/, '')
const secret = env.SUPABASE_SERVICE_ROLE_KEY
const publicKey = env.VITE_SUPABASE_ANON_KEY
// Secret keys (sb_secret_...) are not JWTs: apikey header only. Legacy keys are JWTs: both headers.
const headers = (key) => ({ apikey: key, 'content-type': 'application/json', ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}) })

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) say(url ? 'FAIL' : 'SKIP', 'Supabase URL', url ? 'expected https://<project-ref>.supabase.co' : 'VITE_SUPABASE_URL is empty')
else say('PASS', 'Supabase URL', url !== raw.replace(/\/+$/, '') ? 'ends in /rest/v1; the app strips it, but the project URL alone is cleaner' : '')

if (url && secret) {
  for (const table of ['workspaces', 'sites', 'events']) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: headers(secret) }).catch((e) => e)
    if (res instanceof Error) say('FAIL', `Supabase table ${table}`, res.message)
    else if (res.ok) say('PASS', `Supabase table ${table}`)
    else say('FAIL', `Supabase table ${table}`, `${await short(res)}${res.status === 404 ? ' (run supabase/schema.sql in the SQL editor)' : ''}`)
  }
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, { method: 'POST', headers: headers(secret), body: json({ messages: [{ topic: 'pratibimb-key-check', event: 'check', payload: {} }] }) }).catch((e) => e)
  if (res instanceof Error) say('FAIL', 'Supabase realtime broadcast', res.message)
  else say(res.ok ? 'PASS' : 'FAIL', 'Supabase realtime broadcast', res.ok ? '' : await short(res))
} else say('SKIP', 'Supabase server key', 'SUPABASE_SERVICE_ROLE_KEY is empty')

if (url && publicKey) {
  // The public key must reach Supabase but read nothing: row-level security with no policies.
  const res = await fetch(`${url}/rest/v1/workspaces?select=id&limit=1`, { headers: headers(publicKey) }).catch((e) => e)
  if (res instanceof Error) say('FAIL', 'Supabase public key', res.message)
  else {
    const body = await res.text()
    if (res.ok && body.trim() === '[]') say('PASS', 'Supabase public key', 'reaches Supabase and reads no rows')
    else if (res.ok) say('FAIL', 'Supabase public key', 'it can read workspaces: run supabase/schema.sql again')
    else if (res.status === 401 || res.status === 403) say('PASS', 'Supabase public key', 'reaches Supabase and is refused table access')
    else say('FAIL', 'Supabase public key', `${res.status} ${body.slice(0, 140)}`)
  }
} else say('SKIP', 'Supabase public key', 'VITE_SUPABASE_ANON_KEY is empty')

// Workspace secret
if (!env.WORKSPACE_SECRET) say('SKIP', 'WORKSPACE_SECRET', 'empty: workspaces stay in each browser')
else say(env.WORKSPACE_SECRET.length >= 32 ? 'PASS' : 'FAIL', 'WORKSPACE_SECRET', env.WORKSPACE_SECRET.length >= 32 ? '' : 'needs at least 32 characters')

// AI
const ask = 'Reply with this JSON only: {"ok": true}'
if (env.GROQ_API_KEY) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: json({ model: env.GROQ_MODEL || 'openai/gpt-oss-120b', messages: [{ role: 'user', content: ask }], response_format: { type: 'json_object' } }),
  }).catch((e) => e)
  if (res instanceof Error) say('FAIL', 'Groq', res.message)
  else say(res.ok ? 'PASS' : 'FAIL', `Groq (${env.GROQ_MODEL || 'openai/gpt-oss-120b'})`, res.ok ? '' : await short(res))
} else say('SKIP', 'Groq', 'GROQ_API_KEY is empty')

if (env.GEMINI_API_KEY) {
  const model = env.GEMINI_MODEL || 'gemini-flash-latest'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: json({ contents: [{ role: 'user', parts: [{ text: ask }] }], generationConfig: { responseMimeType: 'application/json' } }),
  }).catch((e) => e)
  if (res instanceof Error) say('FAIL', 'Gemini', res.message)
  else say(res.ok ? 'PASS' : 'FAIL', `Gemini (${model})`, res.ok ? '' : await short(res))
} else say('SKIP', 'Gemini', 'GEMINI_API_KEY is empty')

// Telegram
if (env.TELEGRAM_BOT_TOKEN) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`).catch((e) => e)
  if (res instanceof Error) say('FAIL', 'Telegram bot', res.message)
  else {
    const body = await res.json().catch(() => ({}))
    say(body.ok ? 'PASS' : 'FAIL', 'Telegram bot', body.ok ? `@${body.result.username}` : `${res.status}`)
  }
} else say('SKIP', 'Telegram bot', 'TELEGRAM_BOT_TOKEN is empty')

console.log(failed ? `\n${failed} check(s) failed.` : '\nEvery configured key works.')
process.exitCode = failed ? 1 : 0
