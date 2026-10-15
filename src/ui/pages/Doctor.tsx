// /connections/doctor  Runs every connection's check on the server and says exactly what to fix.
// Until the server has /api/doctor, it falls back to the deployment's status flags and this browser's own checks.

import { RotateCcw, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRelay } from '@/relay/webSerial'
import { useRealtime } from '@/twin/realtime'
import { useApi, type ServerStatus } from '../api'
import { EmptyState, ErrorState, PageHeader, PanelSkeleton } from '../components/states'
import { StatusLight } from '../components/status'

interface Check {
  name: string
  ok: boolean
  detail?: string
  fix?: string
}

const FALLBACK: { key: keyof ServerStatus; name: string; fix: string }[] = [
  { key: 'workspaces', name: 'Online workspaces', fix: 'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and WORKSPACE_SECRET on the server.' },
  { key: 'realtime', name: 'Live channel for phones and cameras', fix: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.' },
  { key: 'ingest', name: 'Sensor API', fix: 'Needs online workspaces (above).' },
  { key: 'ai', name: 'AI wording and the Assistant', fix: 'Add a key in Settings, Keys and AI.' },
  { key: 'aiVision', name: 'AI photo reading', fix: 'Add a Google Gemini key in Settings, Keys and AI.' },
  { key: 'telegram', name: 'Telegram alerts', fix: 'Add a bot token in Settings, Keys and AI, then press Connect.' },
  { key: 'commandWebhook', name: 'Command webhook', fix: 'Add the URL and secret in Settings, Keys and AI.' },
]

function Row({ c }: { c: Check }) {
  return (
    <li className="grid gap-1 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
      <div className="flex items-start gap-2">
        <StatusLight light={c.ok ? 'ok' : 'warn'} label={c.ok ? 'OK' : 'Needs a fix'} className="w-24 shrink-0" />
        <span className="font-medium">{c.name}</span>
      </div>
      <div className="space-y-0.5 text-sm">
        {c.detail && <p className="text-muted-foreground">{c.detail}</p>}
        {!c.ok && c.fix && (
          <p>
            <span className="font-medium">Fix: </span>
            {c.fix}
          </p>
        )}
      </div>
    </li>
  )
}

export default function Doctor() {
  const [doctor, rerun] = useApi<Check[] | { checks: Check[] }>('/api/doctor')
  const [status, restatus] = useApi<ServerStatus>('/api/status')
  const realtime = useRealtime((s) => s.status)
  const relay = useRelay((s) => s.status)

  const browser: Check[] = [
    {
      name: 'Live channel in this browser',
      ok: realtime === 'online' || realtime === 'local',
      detail: realtime === 'online' ? 'Connected over the internet.' : realtime === 'local' ? 'Local only: tabs of this browser share readings.' : `State: ${realtime}.`,
      fix: 'Check the internet connection; the channel reconnects by itself.',
    },
    {
      name: 'USB relay support',
      ok: relay !== 'unsupported',
      detail: relay === 'unsupported' ? 'This browser has no Web Serial.' : 'Web Serial is available.',
      fix: 'Use Chrome or Edge on a computer to drive a USB relay.',
    },
  ]
  const server: Check[] | null =
    doctor.state === 'ok'
      ? Array.isArray(doctor.data)
        ? doctor.data
        : (doctor.data.checks ?? [])
      : doctor.state === 'missing' && status.state === 'ok'
        ? FALLBACK.filter((f) => f.key in status.data).map((f) => ({ name: f.name, ok: Boolean(status.data[f.key]), fix: f.fix }))
        : null
  const failing = server?.filter((c) => !c.ok).length ?? 0

  return (
    <div className="space-y-4">
      <PageHeader title="Connection doctor" description="Tests every link from the server to your keys, storage, live channel and devices, and says what to fix.">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            rerun()
            restatus()
          }}
        >
          <RotateCcw aria-hidden /> Run again
        </Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server checks</CardTitle>
          <CardDescription>
            {doctor.state === 'missing' ? 'The full doctor comes with the server update; these are the deployment settings it reports today.' : 'Run on the server with this workspace\'s keys.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {server ? (
            server.length ? (
              <>
                <p role="status" className="mb-1 text-sm font-medium">
                  {failing ? `${failing} of ${server.length} checks need a fix` : `All ${server.length} checks pass`}
                </p>
                <ul className="divide-y">
                  {server.map((c) => (
                    <Row key={c.name} c={c} />
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState icon={Stethoscope} title="The server reported no checks" />
            )
          ) : doctor.state === 'error' ? (
            <ErrorState message={doctor.message} onRetry={rerun} />
          ) : status.state === 'error' ? (
            <ErrorState message={status.message} onRetry={restatus} />
          ) : (
            <PanelSkeleton rows={5} />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">This browser</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {browser.map((c) => (
              <Row key={c.name} c={c} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
