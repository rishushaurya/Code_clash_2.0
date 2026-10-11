// Rooftop solar what-if, from the sunshine actually measured at the site over the last three months
// (Open-Meteo daily shortwave radiation). Generation is modelled; the sunshine is real.

import { Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { measuredSunshine } from '@/shared/openMeteo'
import { useSite } from '@/shared/site'
import { PV_PERFORMANCE_RATIO, solarEstimate } from '@/sim/engine'
import { formatMoney } from '@/twin/energy'
import { EmptyState, ErrorState, PanelSkeleton } from './states'
import { SimulatedBadge } from './status'

export function Solar({ weekKwh }: { weekKwh?: number }) {
  const site = useSite((s) => s.site)
  /** Result per location key, so a changed location shows loading without a reset inside the effect */
  const [sun, setSun] = useState<{ key: string; value: { kwhPerM2Day: number; days: number } | 'error' } | null>(null)
  const [kWp, setKWp] = useState(10)
  const [costPerKwp, setCost] = useState(0)
  const loc = site.location

  const key = loc ? `${loc.lat},${loc.lon}` : ''
  useEffect(() => {
    if (!loc) return
    measuredSunshine(loc.lat, loc.lon)
      .then((m) => setSun({ key, value: m ?? 'error' }))
      .catch(() => setSun({ key, value: 'error' }))
  }, [loc, key])

  const current = sun?.key === key ? sun.value : null
  const measured = current && current !== 'error' ? current : null
  const est = measured ? solarEstimate(measured.kwhPerM2Day, kWp, site.tariffPerKwh, site.gridKgPerKwh, costPerKwp) : null
  const share = est && weekKwh ? Math.min(1, est.yearKwh / (weekKwh * 52)) : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sun className="size-4 text-warn" aria-hidden /> Rooftop solar
        </CardTitle>
        <SimulatedBadge />
      </CardHeader>
      <CardContent>
        {!loc ? (
          <EmptyState icon={Sun} title="Set your location in Setup">
            <p className="text-sm">The estimate uses the sunshine measured at your site over the last three months.</p>
          </EmptyState>
        ) : current === null ? (
          <PanelSkeleton rows={2} />
        ) : !measured || !est ? (
          <ErrorState message="Sunshine data is not reachable right now." />
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="kwp">System size (kWp)</Label>
                <Input id="kwp" className="num" type="number" min={0} step={1} value={kWp} onChange={(e) => setKWp(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kwpcost">Installed cost per kWp ({site.currency})</Label>
                <Input id="kwpcost" className="num" type="number" min={0} step={1000} value={costPerKwp || ''} placeholder="From an installer quote" onChange={(e) => setCost(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <p className="num text-xs text-muted-foreground">
                Measured sunshine: {measured.kwhPerM2Day.toFixed(2)} kWh/m² per day over {measured.days} days at {loc.name}. Performance ratio {PV_PERFORMANCE_RATIO}.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-muted p-3">
                <dt className="text-xs text-muted-foreground">Generation per year</dt>
                <dd className="num text-lg font-semibold">{Math.round(est.yearKwh).toLocaleString()} kWh</dd>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <dt className="text-xs text-muted-foreground">Bill saved per year</dt>
                <dd className="num text-lg font-semibold text-occupied">{formatMoney(est.yearCost)}</dd>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <dt className="text-xs text-muted-foreground">CO2 avoided per year</dt>
                <dd className="num text-lg font-semibold">{(est.yearCo2Kg / 1000).toFixed(1)} t</dd>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <dt className="text-xs text-muted-foreground">{est.paybackYears !== null ? 'Payback' : 'Share of modelled use'}</dt>
                <dd className="num text-lg font-semibold">
                  {est.paybackYears !== null ? `${est.paybackYears.toFixed(1)} years` : share !== null ? `${Math.round(share * 100)}%` : 'Run a scenario'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
