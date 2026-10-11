// Workspaces: many customers share one deployment without seeing each other.
// A workspace is a name and a password. The server keeps only a scrypt hash; sessions are HMAC-signed
// tokens, so no session table exists. Channel names, the public view key and the sensor key are all
// derived from WORKSPACE_SECRET, so nothing else needs storing and nobody can guess them.

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const TOKEN_DAYS = 30
const ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

const secret = () => {
  const s = process.env.WORKSPACE_SECRET
  return s && s.length >= 32 ? s : null
}
export const authConfigured = () => secret() !== null

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

export function signToken(id: string, now = Date.now()) {
  const exp = now + TOKEN_DAYS * 86_400_000
  return `${id}.${exp}.${mac(`session:${id}:${exp}`, 43)}`
}

/** The workspace id a token belongs to, or null when it is forged, malformed or expired */
export function readToken(token: string, now = Date.now()): string | null {
  if (!secret()) return null
  const [id, exp, sig, extra] = token.split('.')
  if (extra !== undefined || !id || !ID.test(id) || !sig || !(Number(exp) > now)) return null
  return same(sig, mac(`session:${id}:${exp}`, 43)) ? id : null
}

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
