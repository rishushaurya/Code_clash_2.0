import { describe, expect, it } from 'vitest'
import { ALWAYS_ALLOWED, ungroundedFigures } from './grounding.js'

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

  it('allows the 1000 ppm guideline and the BEE 6 % per degree figure', () => {
    expect(ungroundedFigures('CO2 is above 1000 ppm.', facts, ALWAYS_ALLOWED)).toEqual([])
    expect(ungroundedFigures('Each degree saves about 6%.', facts, ALWAYS_ALLOWED)).toEqual([])
  })
})
