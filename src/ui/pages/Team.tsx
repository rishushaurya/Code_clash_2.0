// /settings/team  Who can open this workspace, with which role; invite links, signed-in devices, the password.
// The team API arrives with the server's security update; until then the page offers what works today.

import { Copy, KeyRound, Link2, LogOut, MonitorSmartphone, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { joinLink, online, SESSION, signOut } from '@/shared/workspace'
import { callApi, useApi } from '../api'
import { EmptyState, ErrorState, NotYet, PageHeader, PanelSkeleton } from '../components/states'

type Role = 'owner' | 'manager' | 'viewer'
interface TeamData {
  members: { id: string; name: string; role: Role; lastSeen?: number }[]
  invites: { id: string; role: Role; url: string; expiresAt: number }[]
  sessions: { id: string; device: string; lastSeen: number; current?: boolean }[]
}
const ROLES: Record<Role, string> = { owner: 'Owner: everything, including keys and team', manager: 'Manager: rooms, cameras, alerts', viewer: 'Viewer: sees the twin, changes nothing' }
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Link copied')).catch(() => toast.error('Clipboard is blocked'))
const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function Password() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    const r = await callApi('/api/workspace/password', { method: 'POST', json: { current, next } })
    setBusy(false)
    if (r.state === 'ok') {
      setCurrent('')
      setNext('')
      setError('')
      toast.success('Password changed', { description: 'Other devices stay signed in until you revoke them below.' })
    } else setError(r.state === 'error' ? r.message : 'The server cannot change passwords yet.')
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" aria-hidden /> Workspace password
        </CardTitle>
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
          <p id="pw-error" role="alert" className="text-sm text-waste sm:col-span-3">
            {error}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function TeamApi({ data, reload }: { data: TeamData; reload: () => void }) {
  const [role, setRole] = useState<Role>('viewer')
  async function act(path: string, init: RequestInit & { json?: unknown }, done: string) {
    const r = await callApi(path, init)
    if (r.state === 'ok') toast.success(done)
    else toast.error(r.state === 'error' ? r.message : 'The server cannot do that yet.')
    reload()
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersRound className="size-4" aria-hidden /> Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.members.length === 0 ? (
            <EmptyState icon={UsersRound} title="Only the workspace password so far">
              <p className="text-sm">Invite people below to give each one their own role.</p>
            </EmptyState>
          ) : (
            <ul className="divide-y text-sm">
              {data.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-medium">{m.name}</span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    {m.lastSeen && <span className="text-xs">Last seen {when(m.lastSeen)}</span>}
                    <Badge variant="secondary" className="capitalize">
                      {m.role}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4" aria-hidden /> Invite links
          </CardTitle>
          <CardDescription>A link signs one person in with the role you choose. Revoke it any time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-60 flex-1 space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger aria-label="Role for the new invite">
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
            <Button onClick={() => act('/api/team/invite', { method: 'POST', json: { role } }, 'Invite link created')}>
              <UserPlus aria-hidden /> Create link
            </Button>
          </div>
          {data.invites.length > 0 && (
            <ul className="divide-y text-sm">
              {data.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge variant="secondary" className="capitalize">
                    {i.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground">expires {when(i.expiresAt)}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => copy(i.url)}>
                      <Copy aria-hidden /> Copy
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Revoke the ${i.role} invite`} onClick={() => act(`/api/team/invite?id=${encodeURIComponent(i.id)}`, { method: 'DELETE' }, 'Invite revoked')}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="size-4" aria-hidden /> Signed-in devices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other device is signed in.</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {s.device} {s.current && <Badge variant="outline">This device</Badge>}
                    <span className="block text-xs text-muted-foreground">Last seen {when(s.lastSeen)}</span>
                  </span>
                  {!s.current && (
                    <Button size="sm" variant="ghost" className="text-waste" onClick={() => act(`/api/team/session?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' }, 'Device signed out')}>
                      <LogOut aria-hidden /> Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Password />
    </>
  )
}

export default function Team() {
  const [team, reload] = useApi<TeamData>('/api/team')
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Team and access" description={`Who can open ${SESSION?.name ?? 'this workspace'}, and from which devices.`} />
      {team.state === 'loading' ? (
        <PanelSkeleton rows={5} />
      ) : team.state === 'error' ? (
        <ErrorState message={team.message} onRetry={reload} />
      ) : team.state === 'ok' ? (
        <TeamApi data={{ members: team.data.members ?? [], invites: team.data.invites ?? [], sessions: team.data.sessions ?? [] }} reload={reload} />
      ) : (
        <>
          <Card>
            <CardContent>
              <NotYet what="Roles, invite links and device lists" reason={team.reason} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What works today</CardTitle>
              <CardDescription>Everyone with the workspace name and password has full access.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {online() && (
                <Button variant="outline" onClick={() => copy(joinLink('/'))}>
                  <Copy aria-hidden /> Copy a sign-in link for another device
                </Button>
              )}
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
