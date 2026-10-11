// Everything the twin did and saw this session, filterable and downloadable as CSV: the evidence an
// auditor asks for. With server storage, the 30-day stored summary sits on top.

import { Download, ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { auditTrail, type AuditTrail } from '@/ai/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TwinEvent } from '@/shared/types'
import { useTwin } from '@/twin/store'
import { EmptyState } from './states'

const KINDS: { id: TwinEvent['kind'] | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'alert', label: 'Alerts' },
  { id: 'command', label: 'Commands' },
  { id: 'ack', label: 'Confirmations' },
  { id: 'status', label: 'Status' },
  { id: 'recommendation', label: 'AI cards' },
]

/** RFC 4180 CSV: quote every field, double inner quotes, and defuse values a spreadsheet would run as a formula. */
const defuse = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)
export const toCsv = (rows: string[][]) => rows.map((r) => r.map((v) => `"${defuse(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')

export function ActivityLog() {
  const events = useTwin((s) => s.events)
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('all')
  const [stored, setStored] = useState<AuditTrail | null>(null)
  useEffect(() => {
    void auditTrail(30).then(setStored)
  }, [])
  const shown = events.filter((e) => kind === 'all' || e.kind === kind)

  function download() {
    const csv = toCsv([['time', 'room', 'kind', 'what happened'], ...shown.map((e) => [new Date(e.ts).toISOString(), e.roomId ?? '', e.kind, e.text])])
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'pratibimb-activity.csv' })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Card className="no-print">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="size-4" aria-hidden /> Activity log
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${kind === k.id ? 'bg-highlight/10 font-medium text-highlight' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={download} disabled={!shown.length} title="Download these rows as a CSV file for your auditor">
            <Download aria-hidden /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {stored && (
          <p className="rounded-lg bg-muted p-3 text-sm">
            Stored on the server, last {stored.days} days: <span className="num">{stored.counts.alert ?? 0}</span> alerts, <span className="num">{stored.counts.command ?? 0}</span> switch-off
            commands, <span className="num">{stored.counts.ack ?? 0}</span> confirmations.
          </p>
        )}
        {shown.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nothing logged yet">
            <p className="text-sm">Alerts, commands and confirmations appear here as the twin works.</p>
          </EmptyState>
        ) : (
          <ol className="max-h-80 divide-y overflow-auto text-sm">
            {shown.map((e) => (
              <li key={e.id} className="flex gap-3 py-1.5">
                <span className="num shrink-0 text-xs text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
