// /trends  Energy and waste over the last day, week or month, from the hourly roll-ups the server stores.

import { LineChart as LineChartIcon } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSite } from '@/shared/site'
import { formatMoney } from '@/twin/energy'
import { useApi } from '../api'
import { Patterns } from '../components/Patterns'
import { EmptyState, ErrorBoundary, ErrorState, NotYet, PageHeader, PanelSkeleton } from '../components/states'
import { bucket, parseHistory, RANGE_MS, type Range } from '../history'

const RANGES: { id: Range; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

export default function Trends() {
  const rooms = useSite((s) => s.site.rooms)
  const [range, setRange] = useState<Range>('week')
  const [room, setRoom] = useState('all')
  const [now] = useState(Date.now)
  const from = now - RANGE_MS[range]
  const [res, reload] = useApi<unknown>(`/api/history?from=${from}&to=${now}${room === 'all' ? '' : `&room=${encodeURIComponent(room)}`}`)
  const data = res.state === 'ok' ? bucket(parseHistory(res.data), range) : null
  const label = (ts: number) => (range === 'day' ? new Date(ts).toLocaleTimeString([], { hour: '2-digit' }) : new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' }))
  const rows = data?.buckets.map((b) => ({ ...b, label: label(b.ts), usedKwh: +b.usedKwh.toFixed(3), wasteKwh: +b.wasteKwh.toFixed(3) })) ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Trends" description="Measured energy per hour, stored by the server every minute even when no screen is open.">
        <div role="group" aria-label="Period" className="inline-flex rounded-lg bg-muted p-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
              className={`rounded-md px-3 py-1 text-sm ${range === r.id ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Select value={room} onValueChange={setRoom}>
          <SelectTrigger aria-label="Room" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Whole building</SelectItem>
            {rooms.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.id} · {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Energy used and wasted</CardTitle>
          <CardDescription>kWh per {range === 'day' ? 'hour' : 'day'}. Wasted means drawn while the room was empty.</CardDescription>
        </CardHeader>
        <CardContent>
          {res.state === 'loading' ? (
            <PanelSkeleton rows={5} />
          ) : res.state === 'missing' ? (
            <NotYet what="History" reason={res.reason} />
          ) : res.state === 'error' ? (
            <ErrorState message={res.message} onRetry={reload} />
          ) : !rows.length ? (
            <EmptyState icon={LineChartIcon} title="No history for this period yet">
              <p className="max-w-md text-sm">The server stores one roll-up per room every hour once a camera or sensor reports. Come back after the first hour of live data.</p>
            </EmptyState>
          ) : (
            <div className="space-y-4">
              <div className="h-72" role="img" aria-label={`Bar chart of energy per ${range === 'day' ? 'hour' : 'day'}; the same numbers are in the table below`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--border-c)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis width={36} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-c)', borderRadius: 8 }} />
                    <Legend />
                    <Bar dataKey="usedKwh" name="Used, kWh" stackId="e" fill="var(--highlight)" />
                    <Bar dataKey="wasteKwh" name="Wasted, kWh" stackId="e" fill="var(--status-waste)" fillOpacity={0.55} stroke="var(--status-waste)" strokeDasharray="3 2" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {data && (
                <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ['Energy', `${data.totals.kwh.toFixed(1)} kWh`],
                    ['Cost', formatMoney(data.totals.cost)],
                    ['Wasted', `${formatMoney(data.totals.wasteCost)}, ${data.totals.wasteKwh.toFixed(1)} kWh`],
                    ['Occupied', `${data.totals.occupiedHours.toFixed(1)} of ${data.totals.observedHours.toFixed(1)} watched hours`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-muted p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="num text-sm font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show the numbers as a table</summary>
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{range === 'day' ? 'Hour' : 'Day'}</TableHead>
                      <TableHead className="text-right">Used kWh</TableHead>
                      <TableHead className="text-right">Wasted kWh</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.ts}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="num text-right">{r.usedKwh}</TableCell>
                        <TableCell className="num text-right">{r.wasteKwh}</TableCell>
                        <TableCell className="num text-right">{formatMoney(r.cost, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            </div>
          )}
        </CardContent>
      </Card>
      <ErrorBoundary label="patterns">
        <Patterns />
      </ErrorBoundary>
    </div>
  )
}
