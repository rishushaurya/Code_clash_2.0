// Alerts from the rules engine, each with an AI recommendation card and a one-click fix.

import { BellOff, Bot, FileCog, Power } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/twin/energy'
import { ALERT_LABELS } from '@/twin/rules'
import { useTwin } from '@/twin/store'
import { EmptyState } from './states'

const ORDER = { empty_with_load: 0, camera_offline: 1, reported: 1, co2_high: 2, ac_mild_weather: 3, ac_overcooling: 3, over_capacity: 4, underused: 5, daylight_available: 6 }

export function AlertFeed() {
  const alerts = useTwin((s) => s.alerts)
  const recs = useTwin((s) => s.recs)
  const switchOff = useTwin((s) => s.switchOff)
  const sorted = [...alerts].sort((a, b) => ORDER[a.type] - ORDER[b.type] || b.since - a.since)

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Alerts and actions
          <Badge variant="secondary" className="num">
            {alerts.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-3">
        {sorted.length === 0 ? (
          <EmptyState icon={BellOff} title="No alerts right now">
            <p className="text-sm">Empty rooms with power on will appear here with a fix.</p>
          </EmptyState>
        ) : (
          <ScrollArea className="h-[min(70vh,640px)] pr-2">
            <ul className="space-y-3">
              {sorted.map((a) => {
                const rec = recs[a.id]
                return (
                  <li key={a.id} className={`rounded-lg border p-3 ${a.type === 'empty_with_load' ? 'border-waste/60' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-sm font-semibold">{a.roomId}</span>
                      <Badge variant={a.type === 'empty_with_load' ? 'destructive' : 'secondary'}>{ALERT_LABELS[a.type]}</Badge>
                    </div>
                    {a.type === 'empty_with_load' && (
                      <p className="num mt-1 text-sm text-waste">
                        {a.facts.wattsNow} W · {formatMoney(a.facts.costPerHourNow, 2)}/hr
                      </p>
                    )}
                    <div className="mt-2">
                      {!rec || rec === 'loading' ? (
                        <div className="space-y-1.5" aria-busy="true" aria-label="Writing recommendation">
                          <Skeleton className="h-4 w-2/3" />
                          <Skeleton className="h-3 w-full" />
                          <Skeleton className="h-3 w-5/6" />
                        </div>
                      ) : (
                        <div className="space-y-1.5 text-sm">
                          <p className="font-medium">{rec.title}</p>
                          <p>{rec.action}</p>
                          <p className="text-muted-foreground">{rec.reason}</p>
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground" title={rec.source === 'ai' ? 'Written by the AI from twin numbers' : 'Written by code because the AI is offline'}>
                              {rec.source === 'ai' ? <Bot className="size-3.5" aria-hidden /> : <FileCog className="size-3.5" aria-hidden />}
                              {rec.source === 'ai' ? 'AI' : 'Offline template'}
                              {rec.monthlySavingCost ? <span className="num text-occupied"> · saves {formatMoney(rec.monthlySavingCost)}/month</span> : null}
                            </span>
                            {rec.command && (
                              <Button size="sm" onClick={() => switchOff(rec.command!.roomId, rec.command!.target)}>
                                <Power aria-hidden /> Apply
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
