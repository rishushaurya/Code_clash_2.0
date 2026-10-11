// Resource utilization from what cameras and sensors actually saw: how full each room is, hour by hour.
// Big rooms that sit mostly empty are the consolidation candidates. No observations, no numbers.

import { Grid3x3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSite } from '@/shared/site'
import { readUsage, type RoomUsage } from '@/twin/usage'
import { EmptyState } from './states'

const pct = (v: number) => `${Math.round(v * 100)}%`

export function Utilization() {
  const site = useSite((s) => s.site)
  // Re-render every 30 s so the recorded summary (cheap: rooms x 168 cells) is read fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const rows: RoomUsage[] = readUsage(site.rooms)

  const observed = rows.flatMap((r) => r.hourly.flatMap((v, h) => (v === null ? [] : [h])))
  const first = Math.min(...observed)
  const hours = observed.length ? Array.from({ length: Math.max(...observed) - first + 1 }, (_, i) => first + i) : []
  const capacity = (id: string) => site.rooms.find((r) => r.id === id)?.capacity ?? 0
  const underused = rows.filter((r) => capacity(r.roomId) >= 40 && r.inUse > 0.05 && r.fillWhenUsed < 0.4 && r.hoursObserved >= 1)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Grid3x3 className="size-4" aria-hidden /> Room utilization, as observed
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState icon={Grid3x3} title="No occupancy recorded yet">
            <p className="max-w-md text-sm">Connect a camera or an occupancy sensor to a room. This grid fills in hour by hour from what it sees.</p>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0.5 text-xs">
                <caption className="sr-only">Average share of seats filled per room and hour of the day</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left font-medium text-muted-foreground">
                      Room
                    </th>
                    {hours.map((h) => (
                      <th key={h} scope="col" className="num font-normal text-muted-foreground">
                        {h}
                      </th>
                    ))}
                    <th scope="col" className="pl-2 text-right font-medium text-muted-foreground">
                      Used
                    </th>
                    <th scope="col" className="pl-2 text-right font-medium text-muted-foreground">
                      Full when used
                    </th>
                    <th scope="col" className="pl-2 text-right font-medium text-muted-foreground">
                      Observed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.roomId}>
                      <th scope="row" className="num pr-2 text-left font-medium">
                        {r.roomId}
                      </th>
                      {hours.map((h) => {
                        const v = r.hourly[h]
                        return (
                          <td
                            key={h}
                            className="num h-7 min-w-7 rounded-sm text-center"
                            style={
                              v === null
                                ? { outline: '1px dashed var(--border)', outlineOffset: '-1px' }
                                : { background: `color-mix(in srgb, var(--highlight) ${Math.round(v * 85)}%, var(--surface-2))`, color: v > 0.45 ? 'var(--on-highlight)' : 'var(--text)' }
                            }
                            title={v === null ? `${r.roomId} at ${h}:00, not observed` : `${r.roomId} at ${h}:00, ${pct(v)} of seats filled on average`}
                          >
                            {v !== null && v >= 0.05 ? Math.round(v * 100) : ''}
                          </td>
                        )
                      })}
                      <td className="num pl-2 text-right">{pct(r.inUse)}</td>
                      <td className={`num pl-2 text-right ${underused.includes(r) ? 'text-warn' : ''}`}>{pct(r.fillWhenUsed)}</td>
                      <td className="num pl-2 text-right text-muted-foreground">{r.hoursObserved < 1 ? `${Math.round(r.hoursObserved * 60)} min` : `${r.hoursObserved.toFixed(1)} h`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Cells show the average percentage of seats filled. Dashed cells were not observed.</p>
            {underused.length > 0 && (
              <div className="rounded-md border border-warn/50 p-3 text-sm">
                <p className="font-medium text-warn">Underused large rooms</p>
                <ul className="mt-1 list-disc pl-5">
                  {underused.map((r) => (
                    <li key={r.roomId}>
                      {r.roomId} seats {capacity(r.roomId)} but is only {pct(r.fillWhenUsed)} full when used.
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
