// Workspaces: many customers share one deployment without seeing each other.
// A workspace is a name and a password. The server keeps only a scrypt hash; sessions are HMAC-signed
// tokens, so no session table exists. Channel names, the public view key and the sensor key are all
// derived from WORKSPACE_SECRET, so nothing else needs storing and nobody can guess them.

import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { localMode } from './db.js'
import { localSecret } from './local.js'

const TOKEN_DAYS = 30
const ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

const secret = () => {
  // Trimmed: a value pasted into a dashboard often carries a line break.
  // Running locally without it, this computer's own secret stands in, so workspaces work out of the box.
  const s = process.env.WORKSPACE_SECRET?.trim() || (localMode() ? localSecret() : undefined)
  return s && s.length >= 32 ? s : null
}
export const authConfigured = () => secret() !== null
/** WORKSPACE_SECRET, trimmed; null when missing or shorter than 32 characters */
export const serverSecret = secret

const mac = (label: string, length: number) => createHmac('sha256', secret()!).update(label).digest('base64url').slice(0, length)

export function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** "City College, Main Block" -> "city-college-main-block"; null when it cannot make a valid id */
export function workspaceId(name: string) {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return ID.test(id) ? id : null
}

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize('NFKC'), salt, 32, (e, key) => (e ? reject(e) : resolve(key))))

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`
}

export async function checkPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const got = await derive(password, Buffer.from(salt, 'base64'))
  const want = Buffer.from(hash, 'base64')
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Owner: everything. Manager: site, cameras, devices and commands. Viewer: reads only. */
export type Role = 'owner' | 'manager' | 'viewer'
export const ROLES: Role[] = ['viewer', 'manager', 'owner']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface SessionClaims {
  id: string
  exp: number
  role: Role
  /** The session's row in the sessions table, so it can be listed and revoked; absent on tokens issued before roles */
  sid?: string
}

/**
 * A session token: `<id>.<exp>.<sid>.<role>.<mac>`. Tokens issued before roles (`<id>.<exp>.<mac>`) still
 * work as owner until they expire (30 days at most).
 */
export function signToken(id: string, now = Date.now(), session?: { sid: string; role: Role }) {
  const exp = now + TOKEN_DAYS * 86_400_000
  if (!session) return `${id}.${exp}.${mac(`session:${id}:${exp}`, 43)}`
  return `${id}.${exp}.${session.sid}.${session.role}.${mac(`session:${id}:${exp}:${session.sid}:${session.role}`, 43)}`
}

export const newSessionId = () => randomUUID()

/** What a token says, or null when it is forged, malformed or expired */
export function readClaims(token: string, now = Date.now()): SessionClaims | null {
  if (!secret()) return null
  const parts = token.split('.')
  const [id, exp] = parts
  if (!id || !ID.test(id) || !(Number(exp) > now)) return null
  if (parts.length === 3) return same(parts[2], mac(`session:${id}:${exp}`, 43)) ? { id, exp: Number(exp), role: 'owner' } : null
  const [, , sid, role, sig] = parts
  if (parts.length !== 5 || !UUID.test(sid) || !ROLES.includes(role as Role)) return null
  return same(sig, mac(`session:${id}:${exp}:${sid}:${role}`, 43)) ? { id, exp: Number(exp), role: role as Role, sid } : null
}

/** The workspace id a token belongs to, or null when it is forged, malformed or expired */
export const readToken = (token: string, now = Date.now()) => readClaims(token, now)?.id ?? null

/** An invite link's key: anyone holding it can join the workspace with this role until it expires */
export function signInvite(id: string, role: Role, days: number, now = Date.now()) {
  const exp = now + days * 86_400_000
  const nonce = randomBytes(6).toString('base64url')
  return `${id}.${role}.${exp}.${nonce}.${mac(`invite:${id}:${role}:${exp}:${nonce}`, 32)}`
}

export function readInvite(invite: string, now = Date.now()): { id: string; role: Role } | null {
  if (!secret()) return null
  const [id, role, exp, nonce, sig, extra] = invite.split('.')
  if (extra !== undefined || !id || !ID.test(id) || !ROLES.includes(role as Role) || !(Number(exp) > now) || !nonce || !sig) return null
  return same(sig, mac(`invite:${id}:${role}:${exp}:${nonce}`, 32)) ? { id, role: role as Role } : null
}

/** A secret only this deployment can compute, for one purpose of one workspace (Telegram webhook, IP hashes) */
export const derived = (label: string, length = 32) => mac(`derived:${label}`, length)

/** The live channels: private for cameras, sensors and commands; public for the read-only view */
export function channels(id: string) {
  const publicKey = mac(`public:${id}`, 22)
  return { channel: `twin:${id}:${mac(`channel:${id}`, 22)}`, publicChannel: `pub:${id}:${publicKey}`, publicKey }
}

/** Key for the sensor API; it names its workspace, so one header is enough */
export const ingestKey = (id: string) => `${id}.${mac(`ingest:${id}`, 32)}`

export function readIngestKey(key: string): string | null {
  const id = key.split('.')[0]
  return secret() && ID.test(id) && same(key, ingestKey(id)) ? id : null
}
