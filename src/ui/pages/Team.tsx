// /settings/team  Who can open this workspace: invite links per role, signed-in devices, the password, and the
// workspace's data. Owners only on the server; the page explains when the server or the role does not allow it.

import { Copy, Download, KeyRound, Link2, LogOut, MonitorSmartphone, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiFetch, can, joinLink, online, SESSION, signOut } from '@/shared/workspace'
import { callApi, useApi, type ApiState } from '../api'
import { ErrorState, NotYet, PageHeader, PanelSkeleton } from '../components/states'

type Role = 'owner' | 'manager' | 'viewer'
interface SessionRow {
  id: string
  role: Role
  device: string | null
  createdAt: number
  current?: boolean
}
const ROLES: Record<Role, string> = { owner: 'Owner: everything, including keys and team', manager: 'Manager: site, cameras, devices, commands', viewer: 'Viewer: sees the twin, changes nothing' }
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Link copied')).catch(() => toast.error('Clipboard is blocked'))
const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const fail = (r: { state: string; message?: string }) => toast.error(r.state === 'error' ? (r.message ?? 'That did not work.') : 'This server cannot do that yet.')

function Invite() {
  const [role, setRole] = useState<Role>('viewer')
  const [days, setDays] = useState('7')
  const [made, setMade] = useState<{ link: string; role: Role; expiresAt: number } | null>(null)
  async function create() {
    const r = await callApi<{ invite: string; expiresAt: number }>('/api/workspace/invite', { method: 'POST', json: { role, days: Number(days) } })
    if (r.state !== 'ok') return fail(r)
    setMade({ link: `${location.origin}/join#i=${encodeURIComponent(r.data.invite)}&next=%2F`, role, expiresAt: r.data.expiresAt })
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" aria-hidden /> Invite someone
        </CardTitle>
        <CardDescription>The link signs one device in with the role you choose, until it expires. Sign the device out below at any time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1 space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLES) as Role[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLES[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="invite-days">Valid for</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger id="invite-days" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['1', '7', '30'].map((d) => (
                  <SelectItem key={d} value={d}>
                    {d === '1' ? '1 day' : `${d} days`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={create}>
            <UserPlus aria-hidden /> Create link
          </Button>
        </div>
        {made && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm" role="status">
            <Badge variant="secondary" className="capitalize">
              {made.role}
            </Badge>
            <span className="text-muted-foreground">Link ready, valid until {when(made.expiresAt)}. Send it privately.</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => copy(made.link)}>
              <Copy aria-hidden /> Copy link
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

type SessionsState = ApiState<{ sessions: SessionRow[]; setup?: boolean }>

function Devices({ state, reload }: { state: SessionsState; reload: () => void }) {
  const list = state.state === 'ok' ? (state.data.sessions ?? []) : []
  async function revoke(s: SessionRow) {
    const r = await callApi(`/api/sessions?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    if (r.state !== 'ok') return fail(r)
    toast.success('Signed out', { description: 'That device is signed out within 30 seconds.' })
    if (s.current) return signOut()
    reload()
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="size-4" aria-hidden /> Signed-in devices
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state.state === 'loading' ? (
          <PanelSkeleton rows={2} />
        ) : state.state === 'error' ? (
          <ErrorState message={state.message} onRetry={reload} />
        ) : state.state === 'ok' && state.data.setup ? (
          <p className="text-sm text-muted-foreground" role="status">
            The device list needs one database step: run <code className="font-mono text-xs">supabase/schema.sql</code> once in the Supabase SQL editor. Invites, the password and your data work now.
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No device is signed in.</p>
        ) : (
          <ul className="divide-y text-sm">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.device || 'Unnamed device'}</span> {s.current && <Badge variant="outline">This device</Badge>}
                  <span className="block text-xs text-muted-foreground">Signed in {when(s.createdAt)}</span>
                </span>
                <Badge variant="secondary" className="capitalize">
                  {s.role}
                </Badge>
                <Button size="sm" variant="ghost" className="text-waste" onClick={() => revoke(s)}>
                  <LogOut aria-hidden /> Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Password() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    const r = await callApi('/api/workspace/password', { method: 'PUT', json: { current, next } })
    setBusy(false)
    if (r.state !== 'ok') return setError(r.state === 'error' ? r.message : 'This server cannot change the password yet.')
    setCurrent('')
    setNext('')
    setError('')
    toast.success('Password changed', { description: 'Every other device is signed out.' })
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden /> Workspace password
        </CardTitle>
        <CardDescription>Changing it signs every other device out.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-next">New password</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required aria-describedby="pw-error" />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Changing' : 'Change password'}
          </Button>
          <p id="pw-error" role="alert" className="text-sm text-waste empty:hidden sm:col-span-3">
            {error}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function YourData() {
  const [password, setPassword] = useState('')
  async function exportAll() {
    try {
      const res = await apiFetch('/api/workspace/export')
      if (!res.ok) return toast.error(res.status === 404 ? 'This server cannot export yet.' : 'Export failed. Try again.')
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: `${SESSION?.id ?? 'workspace'}-export.json` })
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('The server is not reachable.')
    }
  }
  async function remove(e: React.FormEvent) {
    e.preventDefault()
    if (!confirm(`Delete ${SESSION?.name} and everything it holds, for every device? This cannot be undone.`)) return
    const r = await callApi('/api/workspace', { method: 'DELETE', json: { password } })
    if (r.state !== 'ok') return fail(r)
    signOut()
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="size-4" aria-hidden /> Your data
        </CardTitle>
        <CardDescription>Download everything this workspace stores, or delete it for good.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" onClick={exportAll}>
          <Download aria-hidden /> Download a copy
        </Button>
        <form onSubmit={remove} className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="min-w-60 flex-1 space-y-1.5">
            <Label htmlFor="delete-pw">Workspace password, to delete it</Label>
            <Input id="delete-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" variant="outline" className="border-waste/50 text-waste">
            <Trash2 aria-hidden /> Delete the workspace
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function Team() {
  const owner = can('owner')
  const [sessions, reload] = useApi<{ sessions: SessionRow[]; setup?: boolean }>(online() && owner ? '/api/sessions' : null)
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Team and access" description={`Who can open ${SESSION?.name ?? 'this workspace'}, and from which devices.`} />
      {!online() ? (
        <Card>
          <CardContent>
            <NotYet what="Team and access" reason="local" />
          </CardContent>
        </Card>
      ) : !owner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Only the workspace owner manages the team</CardTitle>
            <CardDescription>You are signed in as a {SESSION?.role ?? 'member'}. Ask the owner for another role or a new invite.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" className="text-waste" onClick={signOut}>
              <LogOut aria-hidden /> Sign out of this device
            </Button>
          </CardContent>
        </Card>
      ) : sessions.state !== 'missing' ? (
        <>
          <Invite />
          <Devices state={sessions} reload={reload} />
          <Password />
          <YourData />
        </>
      ) : (
        <>
          <Card>
            <CardContent>
              <NotYet what="Roles, invite links and device lists" reason={sessions.reason} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What works today</CardTitle>
              <CardDescription>Everyone with the workspace name and password has full access.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => copy(joinLink('/'))}>
                <Copy aria-hidden /> Copy a sign-in link for another device
              </Button>
              <Button variant="ghost" className="text-waste" onClick={signOut}>
                <LogOut aria-hidden /> Sign out of this device
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
