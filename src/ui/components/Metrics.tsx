// Building totals across the top of the twin, with the live waste and savings tickers.

import { IndianRupee, Leaf, PiggyBank, Zap, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getSite } from '@/shared/site'
import type { RoomState } from '@/shared/types'
import { formatMoney } from '@/twin/energy'

function totalsOf(rooms: RoomState[]) {
  const watts = rooms.reduce((a, r) => a + r.watts, 0)
  return {
    watts,
    costPerHour: (watts / 1000) * getSite().tariffPerKwh,
    kwh: rooms.reduce((a, r) => a + r.kwh, 0),
    co2Kg: rooms.reduce((a, r) => a + r.co2Kg, 0),
    wasteCost: rooms.reduce((a, r) => a + r.wasteCost, 0),
    wasteWatts: rooms.filter((r) => r.status === 'waste').reduce((a, r) => a + r.watts, 0),
  }
}

function Metric({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="space-y-1 px-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-4" aria-hidden /> {label}
        </p>
        <p className={cn('num text-2xl font-semibold leading-tight md:text-3xl', tone)}>{value}</p>
        {sub && <p className={cn('num text-xs', tone ?? 'text-muted-foreground')}>{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function MetricStrip({ rooms, savedCost }: { rooms: RoomState[]; savedCost: number }) {
  const t = totalsOf(rooms)
  return (
    <section aria-label="Building totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric icon={Zap} label="Power now" value={`${(t.watts / 1000).toFixed(2)} kW`} sub={`${(t.wasteWatts / 1000).toFixed(2)} kW in empty rooms`} />
      <Metric icon={IndianRupee} label="Cost now" value={`${formatMoney(t.costPerHour, 2)}/hr`} sub={`${formatMoney(t.wasteCost, 2)} wasted this session`} tone={t.wasteWatts > 0 ? 'text-waste' : undefined} />
      <Metric icon={Leaf} label="This session" value={`${t.kwh.toFixed(3)} kWh`} sub={`${t.co2Kg.toFixed(3)} kg CO2`} />
      <Metric icon={PiggyBank} label="Saved by Pratibimb" value={formatMoney(savedCost, 2)} sub="by switch-offs this session" tone="text-occupied" />
      <p className="sr-only" role="status">
        {`Building draws ${(t.watts / 1000).toFixed(1)} kilowatts; ${(t.wasteWatts / 1000).toFixed(1)} kilowatts are in empty rooms.`}
      </p>
    </section>
  )
}
