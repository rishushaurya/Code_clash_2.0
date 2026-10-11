// Offline report: the same audit structure the AI writes, filled in by code from the same facts.

import { formatMoney } from '@/twin/energy'
import type { Report } from './client'
import type { reportFacts } from './tools'

export function templateReport(f: ReturnType<typeof reportFacts>): Report {
  const money = (v: number) => formatMoney(v, 0, f.currency)
  const best = [...f.policies].sort((a, b) => b.monthlySavingCost.p50 - a.monthlySavingCost.p50)[0]
  const name = f.building.name || 'The building'
  return {
    title: `${f.building.name || 'Building'} energy and sustainability report`,
    source: 'template',
    sections: [
      {
        heading: 'Summary',
        paragraphs: [
          `${name}${f.building.organization ? ` (${f.building.organization})` : ''} has ${f.building.rooms} configured rooms and ${f.building.seats} seats. Modelled, a week with manual switching uses ${f.modelledWeekBaseline.kwh.p50} kWh (range ${f.modelledWeekBaseline.kwh.p10} to ${f.modelledWeekBaseline.kwh.p90}).`,
          `The strongest measure is "${best.policy}", saving ${money(best.monthlySavingCost.p10)} to ${money(best.monthlySavingCost.p90)} a month (modelled).`,
        ],
        bullets: [],
      },
      {
        heading: 'Building profile',
        paragraphs: [
          `Connected load ${f.building.connectedLoadKw} kW${f.building.location ? `, located in ${f.building.location}` : ''}. Rooms with live inputs: ${f.building.roomsWithLiveInputs.join(', ') || 'none yet'}.`,
        ],
        bullets: [`${f.building.devices.lights} lights, ${f.building.devices.fans} fans, ${f.building.devices.acs} ACs, ${f.building.devices.projectors} projectors, ${f.building.devices.pcs} PCs`],
      },
      {
        heading: 'Baseline consumption',
        paragraphs: [
          `Energy intensity of the configured rooms is ${f.energyIntensityKwhPerM2Year.today} kWh per m² per year today and ${f.energyIntensityKwhPerM2Year.withAllMeasures} with all three measures (modelled).`,
          `Modelled week: ${f.modelledWeekBaseline.kwh.p50} kWh, ${money(f.modelledWeekBaseline.cost.p50)}, ${f.modelledWeekBaseline.co2Kg.p50} kg CO2 at ${formatMoney(f.tariffPerKwh, 2, f.currency)} per kWh and ${f.gridEmissionKgPerKwh} kg CO2 per kWh.`,
          `Measured this session: ${f.liveSession.kwh} kWh over ${f.liveSession.minutes} minutes, of which ${money(f.liveSession.wasteCost)} was spent in empty rooms.`,
        ],
        bullets: [],
      },
      {
        heading: 'Waste hotspots',
        paragraphs: ['Rooms with the most avoidable energy per modelled week:'],
        bullets: f.topWasteRoomsModelledWeek.map((x) => `${x.roomId}: ${x.avoidableKwhPerWeek} kWh per week`),
      },
      {
        heading: 'When waste happens',
        paragraphs: [f.wastePatternsObserved.length ? 'Room-hours when empty rooms were most often left on, from observed data:' : 'Not enough observation of empty rooms yet to show patterns.'],
        bullets: f.wastePatternsObserved.map((p) => `${p.roomId}, ${p.day} at ${p.hour}: left on ${p.leftOnPercent}% of the empty time (${p.emptyHoursObserved} h observed)`),
      },
      {
        heading: 'Space utilization',
        paragraphs: [f.spaceUtilizationObserved.length ? 'Least-filled rooms, from observed occupancy:' : 'No occupancy has been observed yet; connect cameras or occupancy sensors.'],
        bullets: f.spaceUtilizationObserved.map(
          (x) => `${x.roomId} (${x.seats} seats): used ${x.usedPercent}% of the observed time, ${x.fullWhenUsedPercent}% full when used, over ${x.hoursObserved} hours`,
        ),
      },
      {
        heading: 'Indoor air quality',
        paragraphs: [f.indoorAir.length ? 'Peak indoor CO2 this session, estimated from live head-counts:' : 'No head-counts this session, so no indoor CO2 estimate.'],
        bullets: f.indoorAir.map((x) => `${x.roomId}: ${x.peakPpm} ppm${x.peakPpm > 1000 ? ', above the 1000 ppm guideline' : ''}`),
      },
      {
        heading: 'Recommendations with cost-benefit',
        paragraphs: [],
        bullets: f.policies.map((p) => `${p.policy}: ${money(p.monthlySavingCost.p10)} to ${money(p.monthlySavingCost.p90)} per month, ${p.monthlySavingCo2Kg.p50} kg CO2 per month (modelled)`),
      },
      {
        heading: 'Actions taken',
        paragraphs: [
          f.actionsTaken.length ? `Confirmed switch-offs saved ${money(f.liveSession.savedCost)} this session.` : 'No actions were taken in this session.',
          ...(f.storedActionLog
            ? [`Stored log, last ${f.storedActionLog.days} days: ${f.storedActionLog.counts.command ?? 0} switch-off commands, ${f.storedActionLog.counts.ack ?? 0} confirmations, ${f.storedActionLog.counts.alert ?? 0} alerts.`]
            : []),
        ],
        bullets: f.actionsTaken,
      },
      ...(f.rooftopSolarModelled
        ? [
            {
              heading: 'Rooftop solar (modelled)',
              paragraphs: [
                `With ${f.rooftopSolarModelled.kWp} kWp on the roof and the sunshine measured at the site (${f.rooftopSolarModelled.sunKwhPerM2Day} kWh per m² per day), generation would be about ${f.rooftopSolarModelled.yearKwh.toLocaleString()} kWh a year, saving ${money(f.rooftopSolarModelled.yearCost)} and ${f.rooftopSolarModelled.yearCo2Tonnes} tonnes of CO2.`,
              ],
              bullets: [],
            },
          ]
        : []),
      { heading: 'Method and assumptions', paragraphs: [], bullets: f.method.notes },
    ],
  }
}
