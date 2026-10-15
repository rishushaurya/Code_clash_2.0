// /connections/doctor  Runs every connection's check on the server (GET /api/doctor) and says exactly what to fix,
// plus the two checks only this browser can make.

import { RotateCcw, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useRelay } from '@/relay/webSerial'
import { can } from '@/shared/workspace'
import { useRealtime } from '@/twin/realtime'
import { useApi } from '../api'
import { EmptyState, ErrorState, NotYet, PageHeader, PanelSkeleton } from '../components/states'
import { StatusLight } from '../components/status'

interface Check {
  name: string
  ok: boolean
  detail?: string
  fix?: string
}

function Row({ c }: { c: Check }) {
  return (
    <li className="grid gap-1 py-3 sm:grid-cols-[minmax(0,20rem)_1fr] sm:gap-4">
      <div className="flex items-start gap-2">
        <StatusLight light={c.ok ? 'ok' : 'warn'} label={c.ok ? 'OK' : 'Needs a fix'} className="w-28 shrink-0" />
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
  const allowed = can('manager')
  const [doctor, rerun] = useApi<{ checks: Check[]; ok: boolean }>(allowed ? '/api/doctor' : null)
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
  const checks = doctor.state === 'ok' ? (doctor.data.checks ?? []) : []
  const failing = checks.filter((c) => !c.ok).length

  return (
    <div className="space-y-4">
      <PageHeader title="Connection doctor" description="Tests every link from the server to your keys, storage, live channel and devices, and says what to fix.">
        {allowed && (
          <Button variant="outline" size="sm" onClick={rerun} disabled={doctor.state === 'loading'}>
            <RotateCcw aria-hidden /> Run again
          </Button>
        )}
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server checks</CardTitle>
          <CardDescription>Run on the server with this workspace's keys. Keys are never shown.</CardDescription>
        </CardHeader>
        <CardContent>
          {!allowed ? (
            <EmptyState icon={Stethoscope} title="Managers and owners run the doctor">
              <p className="text-sm">Your role can see the twin but not test its connections.</p>
            </EmptyState>
          ) : doctor.state === 'loading' ? (
            <PanelSkeleton rows={5} />
          ) : doctor.state === 'missing' ? (
            <NotYet what="The connection doctor" reason={doctor.reason} />
          ) : doctor.state === 'error' ? (
            <ErrorState message={doctor.message} onRetry={rerun} />
          ) : checks.length ? (
            <>
              <p role="status" className="mb-1 text-sm font-medium">
                {failing ? `${failing} of ${checks.length} checks need a fix` : `All ${checks.length} checks pass`}
              </p>
              <ul className="divide-y">
                {checks.map((c) => (
                  <Row key={c.name} c={c} />
                ))}
              </ul>
            </>
          ) : (
            <EmptyState icon={Stethoscope} title="The server reported no checks" />
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
