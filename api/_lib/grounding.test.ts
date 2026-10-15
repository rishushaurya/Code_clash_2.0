import { describe, expect, it } from 'vitest'
import { ungroundedFigures } from './grounding.js'

const facts = { roomId: 'LH-1', wattsNow: 650, costPerHourNow: 5.67, costToday: 374.52, kwhToday: 42.9, monthlySavingCost: 1240 }

describe('grounding check', () => {
  it('rejects a rupee figure the facts do not contain', () => {
    expect(ungroundedFigures('This wastes ₹500 a month.', facts)).toEqual(['₹500'])
  })

  it('accepts exact and rounded fact figures', () => {
    expect(ungroundedFigures('LH-1 draws 650 W, ₹374.52 today (about ₹375), 42.9 kWh; save ₹1,240.', facts)).toEqual([])
  })

  it('rejects invented percentages and energy', () => {
    expect(ungroundedFigures('Cuts waste by 63% and 120 kWh.', facts)).toEqual(['63%', '120 kWh'])
  })

  it('allows the guidelines only in their own unit', () => {
    expect(ungroundedFigures('CO2 is above 1000 ppm.', facts)).toEqual([])
    expect(ungroundedFigures('Each degree saves about 6%.', facts)).toEqual([])
    expect(ungroundedFigures('Set the AC to 24 °C, the BEE default.', facts)).toEqual([])
    expect(ungroundedFigures('Seat 24 people instead.', facts)).toEqual(['24 people'])
  })

  // A1: temperatures, CO2 and people are checked like money and energy.
  it('rejects an invented temperature, CO2 level or head-count', () => {
    const ac = { roomId: 'LH-1', indoorTempC: 21, co2ppm: 1250, headcount: 42 }
    expect(ungroundedFigures('The room is 21 °C with 42 people at 1250 ppm.', ac)).toEqual([])
    expect(ungroundedFigures('Set the thermostat to 22 degrees.', ac)).toEqual(['22 degrees'])
    expect(ungroundedFigures('CO2 reached 1400 ppm with 50 students.', ac)).toEqual(['1400 ppm', '50 students'])
  })

  // A4: the report called a monthly saving "weekly".
  it('rejects a figure quoted with the wrong period', () => {
    expect(ungroundedFigures('Auto-off saves ₹1,240 a month.', facts)).toEqual([])
    expect(ungroundedFigures('Auto-off saves ₹1,240 per week.', facts)).toEqual(['₹1,240 per week (the facts give it per month)'])
    expect(ungroundedFigures('A weekly saving of ₹1,240.', facts)).toHaveLength(1)
    expect(ungroundedFigures('LH-1 costs ₹5.67 per hour and used 42.9 kWh today.', facts)).toEqual([])
    expect(ungroundedFigures('LH-1 used 42.9 kWh this month.', facts)).toHaveLength(1)
    // Report facts carry the period in a parent key.
    const report = { modelledWeekBaseline: { kwh: { p50: 812 } }, policies: [{ monthlySavingKwh: { p50: 96 } }] }
    expect(ungroundedFigures('A modelled week uses 812 kWh; auto-off saves 96 kWh a month.', report)).toEqual([])
    expect(ungroundedFigures('Auto-off saves 96 kWh a week.', report)).toHaveLength(1)
  })
})
