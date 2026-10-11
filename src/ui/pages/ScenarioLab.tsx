// What-if lab: run a policy over a simulated week, 20 times, and compare it with today's manual switching.

import { FlaskConical, Play, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { scenarioFacts } from '@/ai/tools'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_DAYS, DEFAULT_RUNS } from '@/shared/config'
import { useSite } from '@/shared/site'
import type { PolicyId, ScenarioComparison } from '@/shared/types'
import { compareScenario, epi, POLICY_LABELS } from '@/sim/engine'
import { formatMoney } from '@/twin/energy'
import { EmptyState, ErrorState, PanelSkeleton } from '../components/states'
import { SimulatedBadge } from '../components/status'
import { Solar } from '../components/Solar'
import { Utilization } from '../components/Utilization'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const POLICIES = ['auto_off', 'daylight', 'consolidate', 'combined'] as const
const HELP: Record<(typeof POLICIES)[number], string> = {
  auto_off: 'Switch everything off once a room has been empty for a few minutes.',
  daylight: 'Switch off half the lights in window-side rooms between 10:00 and 15:00.',
  consolidate: 'Move classes that fill less than 40% of a big room into the smallest classroom that fits.',
  combined: 'Auto-off, daylight harvesting and consolidation together.',
}

export default function ScenarioLab() {
  const site = useSite((s) => s.site)
  const building = site
  const [policy, setPolicy] = useState<Exclude<PolicyId, 'baseline'>>('auto_off')
  const [minutes, setMinutes] = useState(5)
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<ScenarioComparison | null>(null)
  /** Research plan estimate: a relay kit of about 2,000 rupees per room */
  const [kitCost, setKitCost] = useState(2000)

  function run() {
    setState('running')
    // Let the skeleton paint before the engine takes the main thread for a moment.
    setTimeout(() => {
      try {
        setResult(compareScenario({ policy, params: { emptyMinutes: minutes }, days: DEFAULT_DAYS, runs: DEFAULT_RUNS, seed: 42 }, building.rooms))
        setState('done')
      } catch {
        setState('error')
      }
    }, 30)
  }

  const chart = result?.baseline.daily.map((b, i) => {
    const p = result.policy.daily[i]
    return { day: DAYS[i], base: Math.round(b.p50), baseBand: [Math.round(b.p10), Math.round(b.p90)], pol: Math.round(p.p50), polBand: [Math.round(p.p10), Math.round(p.p90)] }
  })
  const facts = result && scenarioFacts(result)
  const investment = kitCost * building.rooms.length
  const months = (cost: number) => (cost > 0 ? investment / cost : Infinity)
  const fmtMonths = (m: number) => (Number.isFinite(m) ? m.toFixed(1) : 'never')

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Scenario Lab</h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="size-5 text-highlight" aria-hidden /> Scenario Lab
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <RadioGroup value={policy} onValueChange={(v) => setPolicy(v as typeof policy)} aria-label="Policy">
              {POLICIES.map((p) => (
                <Label key={p} htmlFor={p} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-highlight">
                  <RadioGroupItem id={p} value={p} className="mt-0.5" />
                  <span className="space-y-1">
                    <span className="block font-medium">{POLICY_LABELS[p]}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{HELP[p]}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {(policy === 'auto_off' || policy === 'combined') && (
              <div className="space-y-2">
                <Label htmlFor="minutes">
                  Switch off after <span className="num">{minutes}</span> empty minutes
                </Label>
                <Slider id="minutes" aria-label="Empty minutes before switching off" min={1} max={30} step={1} value={[minutes]} onValueChange={([v]) => setMinutes(v)} />
              </div>
            )}
            <Button className="w-full" onClick={run} disabled={state === 'running'}>
              <Play aria-hidden /> Run {DEFAULT_RUNS} simulated weeks
            </Button>
            <p className="text-xs text-muted-foreground">
              Modelled from your rooms with the same random classes for both sides, {building.rooms.length} rooms, one-minute steps, tariff {formatMoney(site.tariffPerKwh, 2)} per kWh.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {state === 'idle' && (
            <Card>
              <CardContent>
                <EmptyState icon={FlaskConical} title="Pick a policy and run it">
                  <p className="text-sm">Results show a range across {DEFAULT_RUNS} runs, not one suspiciously exact number.</p>
                </EmptyState>
              </CardContent>
            </Card>
          )}
          {state === 'running' && <PanelSkeleton rows={6} />}
          {state === 'error' && <ErrorState message="The simulation failed." onRetry={run} />}
          {state === 'done' && result && facts && chart && (
            <>
              <section className="grid gap-3 sm:grid-cols-3" aria-label="Monthly savings">
                {[
                  ['Saved per month', `${formatMoney(facts.monthlySavingCost.p10)} to ${formatMoney(facts.monthlySavingCost.p90)}`, `most likely ${formatMoney(facts.monthlySavingCost.p50)}`],
                  ['Energy per month', `${facts.monthlySavingKwh.p10} to ${facts.monthlySavingKwh.p90} kWh`, `most likely ${facts.monthlySavingKwh.p50} kWh`],
                  ['CO2 per month', `${facts.monthlySavingCo2Kg.p10} to ${facts.monthlySavingCo2Kg.p90} kg`, `most likely ${facts.monthlySavingCo2Kg.p50} kg`],
                ].map(([k, v, sub]) => (
                  <Card key={k} className="py-4">
                    <CardContent className="space-y-1 px-4">
                      <p className="text-xs text-muted-foreground">{k}</p>
                      <p className="num text-lg font-semibold text-occupied">{v}</p>
                      <p className="num text-xs text-muted-foreground">{sub}</p>
                    </CardContent>
                  </Card>
                ))}
              </section>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wallet className="size-4" aria-hidden /> Business case
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="kit">Relay kit per room (₹)</Label>
                    <Input id="kit" type="number" min={0} step={100} value={kitCost} onChange={(e) => setKitCost(Math.max(0, Number(e.target.value) || 0))} className="num" />
                    <p className="num text-xs text-muted-foreground">
                      {building.rooms.length} rooms, {formatMoney(investment)} in total
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pays for itself in</p>
                    <p className="num text-lg font-semibold">
                      {fmtMonths(months(facts.monthlySavingCost.p90))} to {fmtMonths(months(facts.monthlySavingCost.p10))} months
                    </p>
                    <p className="num text-xs text-muted-foreground">most likely {fmtMonths(months(facts.monthlySavingCost.p50))} months</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground" title="Energy Performance Index of the modelled rooms: kWh per square metre per year">
                      Energy intensity (EPI)
                    </p>
                    <p className="num text-lg font-semibold">
                      {epi(result.baseline.kwh.p50, building.rooms).toFixed(1)} → <span className="text-occupied">{epi(result.policy.kwh.p50, building.rooms).toFixed(1)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">kWh per m² per year, modelled rooms only</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">kWh per day: today vs {POLICY_LABELS[result.policy.policy].toLowerCase()}</CardTitle>
                  <SimulatedBadge />
                </CardHeader>
                <CardContent>
                  <div className="h-72" role="img" aria-label="Daily energy, baseline against policy, with p10 to p90 bands; exact values in the table below">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
                        <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} unit=" kWh" width={70} />
                        <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
                        <Legend />
                        <Area dataKey="baseBand" name="Today, p10-p90" fill="var(--text-muted)" fillOpacity={0.2} stroke="none" isAnimationActive={false} />
                        <Area dataKey="polBand" name="Policy, p10-p90" fill="var(--highlight)" fillOpacity={0.25} stroke="none" isAnimationActive={false} />
                        <Line dataKey="base" name="Today (median)" stroke="var(--text-muted)" strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line dataKey="pol" name="Policy (median)" stroke="var(--highlight)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By room, per simulated week</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Room</TableHead>
                        <TableHead className="text-right">Today kWh</TableHead>
                        <TableHead className="text-right">Policy kWh</TableHead>
                        <TableHead className="text-right">Saved</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.baseline.perRoom
                        .map((b, i) => ({ id: b.roomId, base: b.kwhP50, pol: result.policy.perRoom[i].kwhP50 }))
                        .sort((a, b) => b.base - b.pol - (a.base - a.pol))
                        .map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="num">{r.id}</TableCell>
                            <TableCell className="num text-right">{r.base.toFixed(1)}</TableCell>
                            <TableCell className="num text-right">{r.pol.toFixed(1)}</TableCell>
                            <TableCell className="num text-right text-occupied">{formatMoney((r.base - r.pol) * site.tariffPerKwh)}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
      <Solar weekKwh={result?.baseline.kwh.p50} />
      <Utilization />
    </div>
  )
}
