// The workspace this browser is signed in to. Everything a customer owns (site, cameras, live channel,
// events, recorded usage) belongs to one workspace, so many customers can share one deployment.
// Read once at load: signing in or out reloads the page, so every module sees one fixed workspace.
//
// Online, the server issues the session (api/_lib/auth.ts). Without server storage (a laptop on localhost),
// a local workspace is kept in this browser, its password hashed with PBKDF2.

export interface Session {
  id: string
  name: string
  /** Signed by the server; empty for a local workspace */
  token: string
  /** Private live channel: cameras, sensors, commands */
  channel: string
  /** Public channel: snapshots for the read-only view */
  publicChannel: string
  /** Lets the public view send a visitor's tip through the server */
  publicKey: string
  mode: 'server' | 'local'
  /** What this session may do (server workspaces); sessions from before roles are the owner's */
  role?: 'owner' | 'manager' | 'viewer'
}

const SESSION_KEY = 'pratibimb:session'
const LOCAL_KEY = 'pratibimb:local-workspaces'

const isSession = (s: unknown): s is Session => {
  const v = s as Session
  return Boolean(v) && typeof v.id === 'string' && /^[a-z0-9-]{3,32}$/.test(v.id) && typeof v.channel === 'string' && (v.mode === 'server' || v.mode === 'local')
}

function read(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')
    return isSession(s) ? s : null
  } catch {
    return null
  }
}

export const SESSION: Session | null = typeof localStorage === 'undefined' ? null : read()

/** The public view of another device's workspace: /live#w=<id>&k=<key> */
function publicFromLink() {
  if (typeof location === 'undefined') return null
  const p = new URLSearchParams(location.hash.slice(1))
  const w = p.get('w') ?? ''
  const k = p.get('k') ?? ''
  return /^[a-z0-9-]{3,32}$/.test(w) && /^[A-Za-z0-9_-]{10,40}$/.test(k) ? { id: w, publicKey: k, publicChannel: `pub:${w}:${k}` } : null
}
export const PUBLIC_LINK = publicFromLink()

export const CHANNEL = SESSION?.channel ?? null
export const PUBLIC_CHANNEL = PUBLIC_LINK?.publicChannel ?? SESSION?.publicChannel ?? null
export const online = () => SESSION?.mode === 'server'
/** Owner: everything. Manager: site, cameras, devices, commands. Viewer: reads only. A local workspace is its owner's. */
export const role = () => SESSION?.role ?? 'owner'
export const can = (min: 'manager' | 'owner') => (min === 'owner' ? role() === 'owner' : role() !== 'viewer')

/** A storage key of this workspace, so two workspaces on one device never mix */
export const ns = (key: string) => `${key}:${SESSION?.id ?? 'none'}`

export const authHeaders = (): Record<string, string> => (online() ? { authorization: `Bearer ${SESSION!.token}` } : {})

const SIGNED_OUT_KEY = 'pratibimb:signed-out'

/**
 * Every call to the workspace's own API goes through here: it adds the session, and when the server no longer
 * accepts it (expired after 30 days, or WORKSPACE_SECRET changed) it signs this device out with the reason,
 * instead of leaving each screen to fail on its own. Unsaved setup drafts stay on the device.
 */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...authHeaders() } })
  if (res.status === 401 && online()) {
    try {
      sessionStorage.setItem(SIGNED_OUT_KEY, 'Your session has ended. Open the workspace again with its name and password; nothing you saved is lost.')
    } catch {
      // The sign-in page then shows no reason.
    }
    localStorage.removeItem(SESSION_KEY)
    location.assign('/')
  }
  return res
}

/** The reason this device was signed out, shown once on the sign-in page */
export function takeSignedOutReason() {
  try {
    const reason = sessionStorage.getItem(SIGNED_OUT_KEY)
    sessionStorage.removeItem(SIGNED_OUT_KEY)
    return reason
  } catch {
    return null
  }
}

export function signIn(session: Session, next = '/') {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  location.assign(next)
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY)
  location.assign('/')
}

/** A link that signs another device in to this workspace and opens `next` there. Keep it private: it is a key. */
export function joinLink(next: string) {
  const data = btoa(encodeURIComponent(JSON.stringify(SESSION)))
  return `${location.origin}/join#s=${data}&next=${encodeURIComponent(next)}`
}

export function readJoinLink(hash: string): { session: Session; next: string } | null {
  try {
    const p = new URLSearchParams(hash.slice(1))
    const session = JSON.parse(decodeURIComponent(atob(p.get('s') ?? '')))
    const next = p.get('next') ?? '/'
    // Only paths inside this app: a crafted link cannot send the device elsewhere.
    return isSession(session) && /^\/[a-zA-Z0-9/_-]*$/.test(next) ? { session, next } : null
  } catch {
    return null
  }
}

/**
 * An invite link for a role (owner only): whoever opens it before it expires signs in with that role, with a
 * session of their own the owner can sign out in Team and access. Returns the link, or the error to show.
 */
export async function createInviteLink(role: 'owner' | 'manager' | 'viewer', days = 7, next = '/'): Promise<{ link: string; expiresAt: number } | string> {
  const res = await apiFetch('/api/workspace/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role, days }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return body.error ?? 'Could not create the invite'
  return { link: `${location.origin}/join#i=${encodeURIComponent(body.invite)}&next=${encodeURIComponent(next)}`, expiresAt: body.expiresAt }
}

export function readInviteLink(hash: string): { invite: string; next: string } | null {
  const p = new URLSearchParams(hash.slice(1))
  const invite = p.get('i') ?? ''
  const next = p.get('next') ?? '/'
  return /^[a-z0-9-]{3,32}\.(owner|manager|viewer)\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(invite) && /^\/[a-zA-Z0-9/_-]*$/.test(next) ? { invite, next } : null
}

/** Turns an invite into this device's session; returns the session or the error to show */
export async function acceptInvite(invite: string): Promise<Session | string> {
  try {
    const res = await fetch('/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', invite }) })
    const body = await res.json()
    return res.ok ? { ...body, mode: 'server' } : (body.error ?? 'This invite link does not work')
  } catch {
    return 'The server is not reachable. Try again.'
  }
}

export const publicLink = (roomId?: string) =>
  SESSION?.mode === 'server' ? `${location.origin}/live${roomId ? `?room=${roomId}` : ''}#w=${SESSION.id}&k=${SESSION.publicKey}` : `${location.origin}/live${roomId ? `?room=${roomId}` : ''}`

export function workspaceIdOf(name: string) {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(id) ? id : null
}

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

async function pbkdf2(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits'])
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 210_000 }, key, 256))
}

/** Create or open a workspace kept in this browser only. Returns the session or an error message. */
export async function localWorkspace(mode: 'create' | 'open', name: string, password: string): Promise<Session | string> {
  const id = workspaceIdOf(name)
  if (!id) return 'Use letters or digits in the name.'
  const all = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, { name: string; salt: string; hash: string }>
  const session: Session = { id, name: all[id]?.name ?? name.trim(), token: '', channel: `twin:${id}`, publicChannel: `pub:${id}`, publicKey: '', mode: 'local' }
  if (mode === 'create') {
    if (all[id]) return 'That name is taken on this device. Open it with its password, or choose another name.'
    const salt = crypto.getRandomValues(new Uint8Array(16))
    all[id] = { name: name.trim(), salt: b64(salt), hash: await pbkdf2(password, salt) }
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all))
    return session
  }
  const row = all[id]
  if (!row) return 'Name or password is wrong.'
  const salt = Uint8Array.from(atob(row.salt), (c) => c.charCodeAt(0))
  return (await pbkdf2(password, salt)) === row.hash ? session : 'Name or password is wrong.'
}
