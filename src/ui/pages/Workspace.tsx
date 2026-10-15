// The first page: open or create a workspace with a name and a password. Everything inside a workspace
// (building, cameras, live data, reports) belongs to it alone, so many teams can use one deployment.
// /join#s=...  The page behind a camera QR code: signs this device in to the workspace and opens the camera.
// /join#i=...  An invite link for a role (Team and access).

import { Building2, Camera, KeyRound, Lock, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { acceptInvite, localWorkspace, readInviteLink, readJoinLink, signIn, takeSignedOutReason, workspaceIdOf, type Session } from '@/shared/workspace'

export function WorkspaceGate() {
  const [mode, setMode] = useState<'open' | 'create'>('open')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason] = useState(takeSignedOutReason)
  const id = workspaceIdOf(name)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, name, password }) }).catch(() => null)
      const body = res ? ((await res.json().catch(() => ({}))) as Partial<Session> & { error?: string; local?: boolean }) : { local: true }
      if (res?.ok) return signIn({ ...(body as Session), mode: 'server' })
      // No server storage (a laptop on localhost): keep the workspace in this browser.
      if (body.local || !res) {
        const local = await localWorkspace(mode, name, password)
        if (typeof local === 'string') return setError(local)
        return signIn(local)
      }
      setError(body.error ?? 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="grid w-full max-w-4xl items-center gap-8 md:grid-cols-[1.1fr_1fr]">
        <section className="space-y-5">
          <p className="font-heading text-4xl font-semibold text-highlight">Pratibimb</p>
          <h1 className="font-heading text-2xl leading-snug">A live digital twin of your building. Cameras find empty rooms wasting power, and AI tells you what to fix.</h1>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <Building2 className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden /> One workspace per building or campus: its rooms, cameras, live data and reports.
            </li>
            <li className="flex gap-3">
              <Lock className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden /> Private to the people who know its name and password. Other workspaces never see it.
            </li>
            <li className="flex gap-3">
              <Camera className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden /> Video never leaves the camera device; only counts and light states are sent.
            </li>
          </ul>
        </section>
        <Card>
          <CardHeader>
            <div role="tablist" aria-label="Open or create" className="mb-2 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
              {(['open', 'create'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m)
                    setError('')
                  }}
                  className={`rounded-md py-1.5 ${mode === m ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground'}`}
                >
                  {m === 'open' ? 'Open a workspace' : 'Create a workspace'}
                </button>
              ))}
            </div>
            <CardTitle className="text-lg">{mode === 'open' ? 'Welcome back' : 'Start a new workspace'}</CardTitle>
            <CardDescription>{mode === 'open' ? 'Enter the name and password your team uses.' : 'Pick a name for your building or team, and a password to share with your team.'}</CardDescription>
          </CardHeader>
          <CardContent>
            {reason && (
              <p role="status" className="mb-4 rounded-md border border-warn/50 bg-warn/10 p-2 text-sm text-warn">
                {reason}
              </p>
            )}
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1">
                <Label htmlFor="ws-name">Workspace name</Label>
                <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, City College Main Block" autoComplete="username" required minLength={3} maxLength={40} />
                {mode === 'create' && name.length >= 3 && <p className="num text-xs text-muted-foreground">{id ? `Address: ${id}` : 'Use letters or digits'}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ws-pass">Password</Label>
                <Input id="ws-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required minLength={8} maxLength={200} />
                {mode === 'create' && <p className="text-xs text-muted-foreground">At least 8 characters. Anyone with it can see and run this workspace.</p>}
              </div>
              {error && (
                <p role="alert" className="rounded-md border border-waste/50 bg-waste/10 p-2 text-sm text-waste">
                  {error}
                </p>
              )}
              <Button type="submit" className="h-10 w-full" disabled={busy || !id || password.length < 8}>
                {mode === 'open' ? <KeyRound aria-hidden /> : <Sparkles aria-hidden />} {busy ? 'One moment' : mode === 'open' ? 'Open' : 'Create'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export function JoinPage() {
  // Two kinds of link: #s= carries a session (camera QR codes), #i= an invite for a role that the server turns
  // into this device's own session.
  const [join] = useState(() => readJoinLink(location.hash))
  const [invite] = useState(() => readInviteLink(location.hash))
  const [error, setError] = useState(join || invite ? '' : 'This link is not valid.')
  useEffect(() => {
    // The key must not stay in the address bar or the history.
    history.replaceState(null, '', '/join')
    if (join) return signIn(join.session, join.next)
    if (invite)
      void acceptInvite(invite.invite).then((r) => (typeof r === 'string' ? setError(r) : signIn(r, invite.next)))
  }, [join, invite])
  return (
    <main className="flex min-h-dvh items-center justify-center p-4 text-center">
      {error ? (
        <div className="max-w-md space-y-3">
          <p role="alert">{error} Ask for a new link, scan the QR code on the operator's screen again, or sign in with the workspace name and password.</p>
          <Button onClick={() => location.assign('/')}>Sign in</Button>
        </div>
      ) : (
        <p className="text-muted-foreground" role="status">
          Joining the workspace
        </p>
      )}
    </main>
  )
}
