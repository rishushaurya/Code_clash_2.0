import { describe, expect, it } from 'vitest'
import { forSpeech, sentences } from './speech'

describe('assistant voice text', () => {
  it('spells out units, symbols and room ids so the voice reads them like a person', () => {
    expect(forSpeech('LH-1 draws 920 W, ₹8.03/hr, CO2 at 1180 ppm.')).toBe('L H 1 draws 920 watts, rupees 8.03 an hour, C O 2 at 1180 parts per million.')
    expect(forSpeech('Saves 12.4 kWh, 30% less, 24 °C')).toBe('Saves 12.4 kilowatt hours, 30 percent less, 24 degrees')
  })

  it('splits into sentences and joins very short ones to the next', () => {
    expect(sentences('Sure. LH-1 uses the most power right now. Want me to switch it off?')).toEqual(['Sure. LH-1 uses the most power right now.', 'Want me to switch it off?'])
    expect(sentences('No ending punctuation')).toEqual(['No ending punctuation'])
  })
})
