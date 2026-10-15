// node tests/journey.mjs                      run the journey (BASE_URL=... to test another server)
// node tests/journey.mjs --cleanup <id>       delete a throwaway workspace made by hand in the browser
// End-to-end API journey against a running dev server (npm run dev, default http://localhost:5173) with the
// real Supabase and AI keys from .env. It creates a throwaway workspace "test-tester-<n>", drives every route,
// then deletes the workspace and every row it created, using the service key. It never prints a key or token.
// Routes that are not built yet answer 404 and are reported as SKIP, not as failures.

import { existsSync } from 'node:fs'

if (existsSync('.env')) process.loadEnvFile('.env')
const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '')
const env = process.env
const SB_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/(\/rest\/v1)?\/*$/, '')
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY || ''
const sbHeaders = { apikey: SB_KEY, 'content-type': 'application/json', ...(SB_KEY.startsWith('eyJ') ? { authorization: `Bearer ${SB_KEY}` } : {}) }

const results = []
const say = (state, name, detail = '') => {
  results.push({ state, name, detail })
  console.log(`${state.padEnd(4)}  ${name}${detail ? `: ${detail}` : ''}`)
}
const check = (name, ok, detail = '') => say(ok ? 'PASS' : 'FAIL', name, detail)

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data }
}
const brief = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`
const notBuilt = (name, r) => (r.status === 404 ? (say('SKIP', name, 'not built yet (404)'), true) : false)

const at = process.argv.indexOf('--cleanup')
const CLEANUP = at > 0 ? process.argv[at + 1] : null
if (CLEANUP !== null && !/^test-tester-[a-z0-9-]+$/.test(CLEANUP)) throw new Error('--cleanup takes a test-tester-<n> workspace id only')
const id = CLEANUP ?? `test-tester-${Date.now()}`
const password = `pw-${crypto.randomUUID()}`
const ROOM = 'LH-1'
const devices = (type, n, w) => Array.from({ length: n }, (_, i) => ({ id: `${ROOM}/${type}-${String(i + 1).padStart(2, '0')}`, type, ratedW: w }))
const site = {
  version: 1,
  organization: 'Tester',
  buildingName: 'Test Block',
  location: null,
  currency: 'INR',
  tariffPerKwh: 8.73,
  gridKgPerKwh: 0.727,
  emptyDelayS: 300,
  leftOnProbability: 0.4,
  alertLanguages: ['en'],
  hours: { from: 9, to: 17, days: [0, 1, 2, 3, 4] },
  autoOff: { enabled: false, minutes: 10 },
  floors: [{ level: 0, name: 'Ground floor' }],
  rooms: [
    { id: ROOM, name: 'Lecture hall 1', floor: 0, type: 'lecture_hall', capacity: 120, areaM2: 200, volumeM3: 700, windowSide: true, devices: [...devices('light', 4, 20), ...devices('fan', 2, 75), ...devices('ac', 1, 1500)] },
    { id: 'CR-1', name: 'Classroom 1', floor: 0, type: 'classroom', capacity: 60, areaM2: 100, volumeM3: 350, windowSide: true, devices: [] },
  ],
}
const facts = (extra) => ({
  roomId: ROOM,
  roomName: 'Lecture hall 1',
  devicesOn: [{ type: 'ac', count: 1, watts: 1500 }],
  wattsNow: 1500,
  costPerHourNow: 13.1,
  kwhToday: 6,
  costToday: 52.38,
  co2KgToday: 4.36,
  capacity: 120,
  currency: 'INR',
  ...extra,
})

let token = ''
if (CLEANUP) await cleanup()
else try {
  if (!SB_URL || !SB_KEY) throw new Error('Supabase keys missing in .env: the journey needs the real server storage')

  // Health
  let r = await api('GET', 'health')
  check('health: server and storage ok', r.status === 200 && r.data.status === 'ok', brief(r))
  r = await api('GET', 'status')
  check('status: AI, workspaces, realtime, ingest on', r.status === 200 && r.data.ai && r.data.workspaces && r.data.realtime && r.data.ingest, brief(r))

  // Workspace
  r = await api('POST', 'workspace', { body: { mode: 'create', name: id, password } })
  check('workspace create', r.status === 200 && r.data.id === id && !!r.data.token, `${r.status}`)
  token = r.data?.token ?? ''
  r = await api('POST', 'workspace', { body: { mode: 'create', name: id, password } })
  check('workspace create twice is refused', r.status === 409, `${r.status}`)
  r = await api('POST', 'workspace', { body: { mode: 'open', name: id, password: 'wrong-password' } })
  check('workspace open, wrong password', r.status === 401, `${r.status}`)
  r = await api('POST', 'workspace', { body: { mode: 'open', name: id, password } })
  check('workspace open', r.status === 200 && !!r.data.token, `${r.status}`)
  r = await api('GET', 'workspace', { token })
  const ingestKey = r.data?.ingestKey
  check('workspace session refresh gives a sensor key', r.status === 200 && typeof ingestKey === 'string', `${r.status}`)
  r = await api('GET', 'site', { token: `${token.slice(0, -4)}AAAA` })
  check('forged token refused', r.status === 401, `${r.status}`)

  // Site
  r = await api('GET', 'site', { token })
  check('site empty before save', r.status === 200 && r.data.site === null, brief(r))
  r = await api('PUT', 'site', { token, body: site })
  check('site save', r.status === 200, brief(r))
  r = await api('GET', 'site', { token })
  check('site read back', r.status === 200 && r.data.site?.rooms?.length === 2 && r.data.site.currency === 'INR', `${r.status}`)

  // Sensor ingest
  r = await api('POST', 'ingest', { headers: { 'x-api-key': 'not-a-key' }, body: { readings: [{ roomId: ROOM, source: 'test', occupancy: 0 }] } })
  check('ingest with wrong key refused', r.status === 401, `${r.status}`)
  r = await api('POST', 'ingest', {
    headers: { 'x-api-key': ingestKey },
    body: { readings: [{ roomId: ROOM, source: 'test', occupancy: 0, devices: [{ type: 'light', on: true }], powerW: 80, co2ppm: 1250, temperatureC: 22 }] },
  })
  check('ingest delivers a reading', r.status === 200 && r.data.delivered === 1, brief(r))

  // Events
  r = await api('POST', 'events', { token, body: { events: [{ id: crypto.randomUUID(), ts: Date.now(), roomId: ROOM, kind: 'command', text: 'Switch off lights (journey test)' }] } })
  check('events store', r.status === 200 && r.data.stored === 1, brief(r))
  r = await api('GET', 'events?days=1', { token })
  check('events summary has the action', r.status === 200 && r.data.actions?.some((a) => a.text.includes('journey test')), brief(r))

  // Phase 1 and BYOK routes (built by the Server session)
  r = await api('POST', 'reading', { token, body: { readings: [{ roomId: ROOM, cameraId: `${ROOM}/cam-1`, sourceKind: 'webcam', ts: Date.now(), headcount: 0, zones: { L1: true }, confidence: 0.9 }] } })
  if (!notBuilt('reading', r)) check('reading stores a camera reading', r.status === 200, brief(r))
  r = await api('GET', 'state', { token })
  if (!notBuilt('state', r)) check('state answers', r.status === 200, brief(r))
  r = await api('POST', 'tick', { body: {} })
  if (!notBuilt('tick', r)) {
    check('tick without CRON_SECRET refused', r.status === 401 || r.status === 403, `${r.status}`)
    if (env.CRON_SECRET) {
      r = await api('POST', 'tick', { body: {}, headers: { authorization: `Bearer ${env.CRON_SECRET}` } })
      check('tick with CRON_SECRET runs', r.status === 200, brief(r))
      r = await api('GET', 'state', { token })
      if (r.status !== 404) check('state after tick has the room', r.status === 200 && JSON.stringify(r.data).includes(ROOM), brief(r))
    }
  }
  r = await api('GET', `history?room=${ROOM}&from=${Date.now() - 86_400_000}&to=${Date.now()}`, { token })
  if (!notBuilt('history', r)) check('history answers', r.status === 200, brief(r))
  r = await api('GET', 'keys', { token })
  if (!notBuilt('keys', r)) {
    check('keys list never holds a value', r.status === 200 && !/sk-|gsk_|AIza/.test(JSON.stringify(r.data)), `${r.status}`)
    r = await api('PUT', 'keys', { token, body: { name: 'groq', value: 'gsk_journeytest_notreal_1234' } })
    check('keys store answers last four only', r.status === 200 && !JSON.stringify(r.data).includes('journeytest'), brief(r))
    r = await api('GET', 'keys', { token })
    check('keys list shows last four, not the value', r.status === 200 && !JSON.stringify(r.data).includes('journeytest'), `${r.status}`)
    r = await api('DELETE', 'keys?name=groq', { token })
    check('keys delete', r.status === 200 || r.status === 204, `${r.status}`)
  }
  r = await api('GET', 'doctor', { token })
  if (!notBuilt('doctor', r)) check('doctor lists checks', r.status === 200 && (Array.isArray(r.data) || Array.isArray(r.data?.checks)), brief(r))

  // AI
  r = await api('POST', 'ai/setup', { token, body: { text: 'Main block, Bengaluru. Ground floor: LH-1 lecture hall, 120 seats, 4 lights, 2 fans, 1 AC. CR-1 classroom, 60 seats, 6 lights. Open 9 to 17, Monday to Friday. Tariff 8.73 rupees per kWh.' } })
  const draftRooms = r.data?.draft?.rooms ?? []
  check('Set up with AI reads the rooms', r.status === 200 && draftRooms.length === 2, brief(r))
  r = await api('POST', 'ai/recommend', { token, body: { facts: facts({ alertType: 'co2_high', co2ppm: 1250, headcount: 40, devicesOn: [], wattsNow: 0, costPerHourNow: 0 }) } })
  const co2Text = `${r.data?.action ?? ''} ${r.data?.reason ?? ''}`
  // Code writes the ventilation action; the AI's reason must not turn a CO2 alert into AC advice.
  check('A1 CO2 reason never turns into AC advice', r.status === 200 && !r.data?.action && !/thermostat|\bACs?\b/.test(co2Text), `${r.status} ${co2Text.slice(0, 200)}`)
  r = await api('POST', 'ai/recommend', { token, body: { facts: facts({ alertType: 'ac_overcooling', indoorTempC: 21, acSavingPercent: 18, monthlySavingCost: 420 }) } })
  const acText = `${r.data?.action ?? ''} ${r.data?.reason ?? ''}`
  // Code writes the action (24 C, BEE); the route returns the AI's reason only, which must not set 21 C.
  check('A1 AC reason never targets the current 21 C', r.status === 200 && !r.data?.action && !/(set|to)\s+21/i.test(acText), `${r.status} ${acText.slice(0, 200)}`)
  r = await api('POST', 'ai/copilot', { token, body: { question: 'Which room uses the most power right now?', roomIds: [ROOM, 'CR-1'] } })
  check('A6 Copilot picks a live summary for "which room uses the most power"', r.status === 200 && r.data.tool === 'liveSummary', brief(r))
  r = await api('POST', 'ai/copilot', { token, body: { question: 'Write me a poem about cats', roomIds: [ROOM] } })
  check('Copilot declines an off-topic question', r.status === 200 && r.data.tool === 'none', brief(r))
  r = await api('POST', 'ai/report', {
    token,
    body: { facts: { currency: 'INR', buildingName: 'Test Block', weeklyKwh: 120, weeklyCost: 1047.6, monthlySavingKwh: 40, monthlySavingCost: 349.2, building: { name: 'Test Block', rooms: 2, roomsWithLiveInputs: [ROOM] }, indoorAir: [{ roomId: ROOM, peakPpm: 1250 }] } },
  })
  const reportText = JSON.stringify(r.data?.sections ?? []).replace(/\\"/g, '"')
  const sectionText = (r.data?.sections ?? []).flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])]).join(' ')
  check('report answers sections', r.status === 200 && (r.data?.sections?.length ?? 0) > 0, `${r.status} ${reportText.length} chars`)
  if (r.status === 200) {
    check('A3 report text has no raw JSON', !/"\]|\bbullets\b|\bparagraphs\b|[{}[\]]/.test(sectionText), sectionText.match(/.{0,40}("\]|\bbullets\b|\bparagraphs\b|[{}[\]]).{0,40}/)?.[0] ?? '')
    check('A4 report does not call the monthly saving weekly', !/weekly saving[^.]*349\.2|349\.2[^.]*(per|a|each) week/i.test(sectionText), '')
    check('A5 report mentions the measured CO2, no field names', /1,?250/.test(sectionText) && !/indoorAir|peakPpm|co2History|roomsWithLiveInputs|monthlySaving/.test(sectionText), sectionText.match(/.{0,60}(CO2|CO₂|indoor air).{0,80}/i)?.[0] ?? 'no CO2 sentence')
  }
} catch (e) {
  say('FAIL', 'journey stopped', String(e).slice(0, 200))
} finally {
  await cleanup()
}

async function cleanup() {
  if (!SB_URL || !SB_KEY) return
  const targets = [
    ['events', `payload->>site=eq.${id}`],
    ['sites', `id=in.("${id}","${id}/cameras")`],
    ['room_inputs', `workspace=eq.${id}`],
    ['twin_state', `workspace=eq.${id}`],
    ['room_hourly', `workspace=eq.${id}`],
    ['secrets', `workspace=eq.${id}`],
    ['settings_log', `workspace=eq.${id}`],
    ['workspaces', `id=eq.${id}`],
  ]
  const removed = []
  for (const [table, filter] of targets) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { ...sbHeaders, prefer: 'return=representation' } })
    if (res.status === 404) {
      removed.push(`${table}: not set up yet (SQL not run)`)
      continue
    }
    const rows = res.ok ? await res.json() : null
    removed.push(`${table}: ${rows ? rows.length : `error ${res.status}`}`)
    const left = await fetch(`${SB_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbHeaders }).then((x) => (x.ok ? x.json() : []))
    if (left.length) say('FAIL', `cleanup ${table}`, `${left.length} rows left`)
  }
  console.log(`\ncleanup ${id}: ${removed.join(', ')}`)
}

const count = (s) => results.filter((x) => x.state === s).length
console.log(`\n${count('PASS')} pass, ${count('FAIL')} fail, ${count('SKIP')} skip`)
process.exitCode = count('FAIL') ? 1 : 0
