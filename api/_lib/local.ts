// Local storage for a copy of Pratibimb running on someone's own computer without Supabase.
// It answers the same small part of Supabase's REST API the server uses (filters, ordering, limits, upserts),
// from a JSON file in .pratibimb-data/ (ignored by git). Workspaces, sites, keys, history and every page
// then work offline with no account anywhere. A deployment with Supabase keys never uses it.

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Row = Record<string, unknown>
interface Store {
  /** WORKSPACE_SECRET and CRON_SECRET for this computer, made on first run */
  secret: string
  tables: Record<string, Row[]>
}

const KEYS: Record<string, string[]> = {
  workspaces: ['id'],
  sites: ['id'],
  events: ['id'],
  room_inputs: ['workspace', 'key'],
  twin_state: ['workspace'],
  room_hourly: ['workspace', 'room_id', 'hour'],
  secrets: ['workspace', 'name'],
  settings_log: ['id'],
  sessions: ['id'],
}
/** Columns the database fills in when a row leaves them out */
const DEFAULTS: Record<string, () => Row> = {
  workspaces: () => ({ created_at: now() }),
  sites: () => ({ updated_at: now() }),
  events: () => ({ id: randomUUID(), ts: now(), payload: {} }),
  room_inputs: () => ({ ts: now() }),
  twin_state: () => ({ updated_at: now() }),
  room_hourly: () => ({ kwh: 0, cost: 0, waste_kwh: 0, waste_cost: 0, occupied_minutes: 0, observed_minutes: 0 }),
  secrets: () => ({ updated_at: now() }),
  settings_log: () => ({ id: randomUUID(), ts: now(), detail: {} }),
  sessions: () => ({ created_at: now(), revoked_at: null }),
}
/** Rows kept per table, so a store left running for months stays small */
const CAP: Record<string, number> = { events: 20000, settings_log: 2000, room_hourly: 50000 }

const now = () => new Date().toISOString()
const dir = () => process.env.PRATIBIMB_DATA_DIR || join(process.cwd(), '.pratibimb-data')
let store: Store | null = null

function load(): Store {
  if (store) return store
  const file = join(dir(), 'store.json')
  try {
    store = JSON.parse(readFileSync(file, 'utf8')) as Store
  } catch {
    store = { secret: randomBytes(32).toString('base64url'), tables: {} }
  }
  return store
}

function save() {
  if (!existsSync(dir())) mkdirSync(dir(), { recursive: true })
  // Write then rename, so a crash mid-write never leaves half a file.
  const file = join(dir(), 'store.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(store))
  renameSync(`${file}.tmp`, file)
}

/** The secret this computer uses in place of WORKSPACE_SECRET and CRON_SECRET */
export const localSecret = () => load().secret

/** `payload->>site` reads a field of a JSON column; anything else is a plain column */
function value(row: Row, col: string): unknown {
  const [base, field] = col.split('->>')
  const v = row[base]
  if (field === undefined) return v
  const inner = v && typeof v === 'object' ? (v as Row)[field] : undefined
  return inner === undefined || inner === null ? null : String(inner)
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1')
const like = (pattern: string) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)

/** One condition, PostgREST style: eq.x, neq.x, gt / gte / lt / lte.x, like.a*, is.null, not.is.null, in.(a,b) */
function test(v: unknown, cond: string): boolean {
  if (cond.startsWith('not.')) return !test(v, cond.slice(4))
  const dot = cond.indexOf('.')
  const op = cond.slice(0, dot)
  const arg = cond.slice(dot + 1)
  const s = v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
  switch (op) {
    case 'eq':
      return s === arg
    case 'neq':
      return s !== arg
    case 'is':
      return arg === 'null' ? s === null : String(v) === arg
    case 'in':
      return s !== null && arg.replace(/^\(|\)$/g, '').split(',').map(unquote).includes(s)
    case 'like':
      return s !== null && like(arg).test(s)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (s === null) return false
      const [a, b] = Number.isFinite(Number(s)) && Number.isFinite(Number(arg)) ? [Number(s), Number(arg)] : [s, arg]
      return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
    }
    default:
      return false
  }
}

/** or=(a.eq.1,b.like.x*): split on the top-level commas only */
function orParts(s: string) {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s.replace(/^\(|\)$/g, '')) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

interface Query {
  filters: ((r: Row) => boolean)[]
  select: string[] | null
  order: { col: string; desc: boolean } | null
  limit: number
  onConflict: string[] | null
}

function parse(search: string): Query {
  const q: Query = { filters: [], select: null, order: null, limit: Infinity, onConflict: null }
  for (const pair of search.split('&').filter(Boolean)) {
    const i = pair.indexOf('=')
    const key = decodeURIComponent(pair.slice(0, i))
    const val = decodeURIComponent(pair.slice(i + 1))
    if (key === 'select') q.select = val === '*' ? null : val.split(',')
    else if (key === 'order') {
      const [col, dir] = val.split('.')
      q.order = { col, desc: dir === 'desc' }
    } else if (key === 'limit') q.limit = Number(val)
    else if (key === 'on_conflict') q.onConflict = val.split(',')
    else if (key === 'or') {
      const parts = orParts(val).map((p) => {
        // col.op.arg, where col may hold a JSON arrow
        const m = /^([^.]+(?:->>[^.]+)?)\.(.*)$/.exec(p)
        return m ? (r: Row) => test(value(r, m[1]), m[2]) : () => false
      })
      q.filters.push((r) => parts.some((f) => f(r)))
    } else q.filters.push((r) => test(value(r, key), val))
  }
  return q
}

const respond = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Answers one Supabase REST call ("events?ts=gte.2026-10-01&order=ts.desc") from the local file */
export async function localRest(path: string, init: RequestInit = {}): Promise<Response> {
  const [name, search = ''] = path.split('?')
  // Functions (rate_hit) are not emulated: callers fall back to their in-memory behaviour on a 404.
  if (!KEYS[name]) return respond(404, { code: 'PGRST205', message: `Local storage has no table ${name}` })
  const s = load()
  const rows = (s.tables[name] ??= [])
  const q = parse(search)
  const method = (init.method ?? 'GET').toUpperCase()
  const prefer = new Headers(init.headers).get('prefer') ?? ''
  const match = (r: Row) => q.filters.every((f) => f(r))
  const pick = (r: Row) => (q.select ? Object.fromEntries(q.select.map((c) => [c, r[c] ?? null])) : r)

  if (method === 'GET' || method === 'HEAD') {
    let out = rows.filter(match)
    if (q.order) {
      const { col, desc } = q.order
      out = [...out].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : 1) * (desc ? -1 : 1))
    }
    return respond(200, out.slice(0, q.limit).map(pick))
  }

  const body = init.body ? JSON.parse(String(init.body)) : null
  if (method === 'POST') {
    const keys = q.onConflict ?? KEYS[name]
    const merge = prefer.includes('merge-duplicates')
    const added: Row[] = []
    for (const raw of Array.isArray(body) ? body : [body]) {
      const row = { ...DEFAULTS[name]?.(), ...(raw as Row) }
      const at = rows.findIndex((r) => keys.every((k) => r[k] === row[k]))
      if (at >= 0 && !merge) return respond(409, { code: '23505', message: 'duplicate key value violates unique constraint' })
      if (at >= 0) rows[at] = { ...rows[at], ...(raw as Row) }
      else rows.push(row)
      added.push(at >= 0 ? rows[at] : row)
    }
    const cap = CAP[name]
    if (cap && rows.length > cap) rows.splice(0, rows.length - cap)
    save()
    return prefer.includes('return=representation') ? respond(201, added.map(pick)) : respond(201)
  }
  if (method === 'PATCH') {
    const changed = rows.filter(match)
    for (const r of changed) Object.assign(r, body)
    save()
    return prefer.includes('return=representation') ? respond(200, changed.map(pick)) : respond(204)
  }
  if (method === 'DELETE') {
    const gone = rows.filter(match)
    s.tables[name] = rows.filter((r) => !match(r))
    save()
    return prefer.includes('return=representation') ? respond(200, gone.map(pick)) : respond(204)
  }
  return respond(405, { message: `${method} is not supported locally` })
}
