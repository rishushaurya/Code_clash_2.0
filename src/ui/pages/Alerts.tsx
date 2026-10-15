// /alerts  What needs attention: open alerts, the ones someone acknowledged, and the ones that cleared.
// Each shows its evidence (the measured facts the rule fired on) and the fix, with one click to apply it.

import { Bot, Check, CheckCircle2, Eye, FileCog, Power, RotateCcw, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Alert, DeviceType, Recommendation } from '@/shared/types'
import { formatMoney } from '@/twin/energy'
import { ALERT_LABELS } from '@/twin/rules'
import { useTwin } from '@/twin/store'
import { acknowledge, reopen, useAlertLog } from '../alerts'
import { EmptyState, PageHeader } from '../components/states'
import { SimulatedBadge, SourceBadges } from '../components/status'

const DEVICE: Record<DeviceType, string> = { light: 'lights', fan: 'fans', ac: 'ACs', projector: 'projectors', pc: 'PCs' }
const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The measured facts the rule fired on, in words */
function evidence(a: Alert) {
  const f = a.facts
  const lines: string[] = []
  if (f.minutesEmpty !== undefined) lines.push(`Nobody seen for ${f.minutesEmpty} min`)
  if (f.devicesOn.length) lines.push(`On: ${f.devicesOn.map((d) => `${d.count} ${DEVICE[d.type]}`).join(', ')}, ${f.wattsNow} W`)
  if (f.costPerHourNow > 0) lines.push(`Costing ${formatMoney(f.costPerHourNow, 2)} per hour`)
  if (f.headcount !== undefined) lines.push(`${f.headcount} people in ${f.capacity} seats`)
  if (f.co2ppm !== undefined) lines.push(`Indoor CO2 ${f.co2ppm} ppm (guideline 1000)`)
  if (f.indoorTempC !== undefined) lines.push(`Room at ${f.indoorTempC} °C`)
  if (f.outdoorTempC !== undefined) lines.push(`Outside ${f.outdoorTempC} °C`)
  if (f.outdoorAqi !== undefined) lines.push(`Outdoor air quality index ${f.outdoorAqi}`)
  if (f.minutesSinceCamera !== undefined) lines.push(`Last camera reading ${f.minutesSinceCamera} min ago`)
  return lines
}

function AlertCard({ alert, rec, state, resolvedAt }: { alert: Alert; rec?: Recommendation | 'loading'; state: 'open' | 'acked' | 'resolved'; resolvedAt?: number }) {
  const switchOff = useTwin((s) => s.switchOff)
  const sources = useTwin((s) => s.rooms[alert.roomId]?.sources)
  const ready = rec && rec !== 'loading' ? rec : null
  const waste = alert.type === 'empty_with_load'
  return (
    <Card className={`gap-3 py-4 ${waste && state === 'open' ? 'border-waste/50' : ''}`}>
      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/room/${alert.roomId}`} className="num font-semibold hover:underline">
            {alert.roomId}
          </Link>
          <span className="truncate text-sm text-muted-foreground">{alert.facts.roomName}</span>
          <Badge variant={waste && state === 'open' ? 'destructive' : 'secondary'}>{ALERT_LABELS[alert.type]}</Badge>
          <span className="num ml-auto text-xs text-muted-foreground">
            {state === 'resolved' && resolvedAt ? `${time(alert.since)} to ${time(resolvedAt)}` : `since ${time(alert.since)}`}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Eye className="size-3.5" aria-hidden /> Evidence
            </p>
            <ul className="num list-disc space-y-0.5 pl-5 text-sm">
              {evidence(alert).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {sources?.length ? <SourceBadges sources={sources} /> : null}
          </div>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden /> Fix
            </p>
            {!rec || rec === 'loading' ? (
              state === 'resolved' ? (
                <p className="text-sm text-muted-foreground">Cleared before a fix was written.</p>
              ) : (
                <div className="space-y-1.5" aria-busy="true" aria-label="Writing the fix">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              )
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{rec.action}</p>
                <p className="text-muted-foreground">{rec.reason}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1" title={rec.source === 'ai' ? 'Worded by the AI from measured numbers' : 'Worded by code because the AI is offline'}>
                    {rec.source === 'ai' ? <Bot className="size-3.5" aria-hidden /> : <FileCog className="size-3.5" aria-hidden />}
                    {rec.source === 'ai' ? 'AI wording' : 'Offline template'}
                  </span>
                  {rec.monthlySavingCost ? (
                    <>
                      <span className="num text-occupied">saves about {formatMoney(rec.monthlySavingCost)}/month</span>
                      <SimulatedBadge />
                    </>
                  ) : null}
                </p>
              </div>
            )}
          </div>
        </div>
        {state !== 'resolved' && (
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            {state === 'open' ? (
              <Button size="sm" variant="outline" onClick={() => acknowledge(alert.id)}>
                <Check aria-hidden /> Acknowledge
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => reopen(alert.id)}>
                <RotateCcw aria-hidden /> Move back to open
              </Button>
            )}
            {ready?.command && (
              <Button size="sm" onClick={() => switchOff(ready.command!.roomId, ready.command!.target)}>
                <Power aria-hidden /> Apply the fix
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function List({ children, empty, icon, hint }: { children: React.ReactNode[]; empty: string; icon: LucideIcon; hint: string }) {
  if (!children.length)
    return (
      <Card>
        <CardContent>
          <EmptyState icon={icon} title={empty}>
            <p className="text-sm">{hint}</p>
          </EmptyState>
        </CardContent>
      </Card>
    )
  return <div className="space-y-3">{children}</div>
}

export default function Alerts() {
  const alerts = useTwin((s) => s.alerts)
  const recs = useTwin((s) => s.recs)
  const { acked, resolved } = useAlertLog()
  const sorted = [...alerts].sort((a, b) => b.facts.costPerHourNow - a.facts.costPerHourNow || b.since - a.since)
  const open = sorted.filter((a) => !acked[a.id])
  const ack = sorted.filter((a) => acked[a.id])

  return (
    <div className="space-y-4">
      <PageHeader title="Alerts" description="Raised by rules on measured data. The AI only words the fix; every number comes from the twin." />
      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">
            Open <span className="num ml-1">{open.length}</span>
          </TabsTrigger>
          <TabsTrigger value="acked">
            Acknowledged <span className="num ml-1">{ack.length}</span>
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved <span className="num ml-1">{resolved.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="mt-3">
          <List empty="No open alerts" icon={CheckCircle2} hint="Empty rooms with power on, high CO2 and silent cameras appear here with the fix.">
            {open.map((a) => (
              <AlertCard key={a.id} alert={a} rec={recs[a.id]} state="open" />
            ))}
          </List>
        </TabsContent>
        <TabsContent value="acked" className="mt-3">
          <List empty="Nothing acknowledged" icon={Check} hint="Acknowledge an open alert when someone is on it. It stays here until the room is back to normal.">
            {ack.map((a) => (
              <AlertCard key={a.id} alert={a} rec={recs[a.id]} state="acked" />
            ))}
          </List>
        </TabsContent>
        <TabsContent value="resolved" className="mt-3">
          <List empty="Nothing resolved yet" icon={RotateCcw} hint="Alerts that cleared since this tab opened. The full history is in Reports, Activity log.">
            {resolved.map((r) => (
              <AlertCard key={r.alert.id} alert={r.alert} rec={r.rec} state="resolved" resolvedAt={r.resolvedAt} />
            ))}
          </List>
        </TabsContent>
      </Tabs>
    </div>
  )
}
