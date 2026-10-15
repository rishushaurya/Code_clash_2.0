// Indoor CO2, single-zone mass balance driven by the live head-count:
//   dC/dt = N * G * 1e6 / V  -  (Q / V) * (C - C_out)
// G = CO2 per seated person (m3/s), V = room volume (m3), Q = ventilation (m3/s).

import { CO2_OUTDOOR_PPM, CO2_PER_PERSON_M3S, VENTILATION_ACH } from '../shared/config.js'

export function stepCo2(ppm: number, people: number, volumeM3: number, dtS: number, ach = VENTILATION_ACH) {
  const q = (ach * volumeM3) / 3600
  const dC = (people * CO2_PER_PERSON_M3S * 1e6) / volumeM3 - (q / volumeM3) * (ppm - CO2_OUTDOOR_PPM)
  return Math.max(CO2_OUTDOOR_PPM, ppm + dC * dtS)
}

/** Where CO2 settles if the same number of people stay long enough */
export const steadyCo2 = (people: number, volumeM3: number, ach = VENTILATION_ACH) =>
  CO2_OUTDOOR_PPM + (people * CO2_PER_PERSON_M3S * 1e6) / ((ach * volumeM3) / 3600)
