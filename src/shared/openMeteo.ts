// Measured sunshine at the site from Open-Meteo (free, no key, CC BY 4.0), shared by the solar card and the report.

/** Average daily global horizontal radiation over the past 92 days, in kWh per m2 per day */
export async function measuredSunshine(lat: number, lon: number): Promise<{ kwhPerM2Day: number; days: number } | null> {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=shortwave_radiation_sum&past_days=92&forecast_days=0&timezone=auto`)
  if (!res.ok) return null
  const d = (await res.json()) as { daily?: { shortwave_radiation_sum?: (number | null)[] } }
  const days = (d.daily?.shortwave_radiation_sum ?? []).filter((v): v is number => v !== null)
  // MJ per m2 per day -> kWh per m2 per day
  return days.length ? { kwhPerM2Day: days.reduce((a, b) => a + b, 0) / days.length / 3.6, days: days.length } : null
}
