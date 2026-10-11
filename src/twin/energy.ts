// Energy, money and emissions. Pure functions: the only place these sums are done.
// Tariff, grid factor and currency come from the customer's site settings.

import { getSite } from '@/shared/site'
import type { Room } from '@/shared/types'

export const roomWatts = (room: Room, deviceOn: Record<string, boolean>) =>
  room.devices.reduce((sum, d) => sum + (deviceOn[d.id] ? d.ratedW : 0), 0)

/** kWh = watts x seconds / 3,600,000 */
export const kwhFrom = (watts: number, seconds: number) => (watts * seconds) / 3_600_000
export const costFrom = (kwh: number) => kwh * getSite().tariffPerKwh
export const co2KgFrom = (kwh: number) => kwh * getSite().gridKgPerKwh
export const costPerHour = (watts: number) => costFrom(kwhFrom(watts, 3600))

/** A room wasting `watts` for `hoursPerDay` over `days` */
export function wasteOverPeriod(watts: number, hoursPerDay: number, days: number) {
  const kwh = kwhFrom(watts, hoursPerDay * 3600 * days)
  return { kwh, cost: costFrom(kwh), co2Kg: co2KgFrom(kwh) }
}

/** Money in the site's currency, e.g. "₹1,240", "$12.50", "€3" */
export function formatMoney(v: number, digits = 0, currency = getSite().currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)
  } catch {
    return `${currency} ${v.toFixed(digits)}`
  }
}

export const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits
