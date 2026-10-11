// Speech to text with the browser's own recognizer (Chrome, Edge, Safari): no library and no key.
// The browser's speech service turns the voice into text; Pratibimb only ever receives the text.

export interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void
  onend: () => void
  onerror: () => void
  start(): void
  stop(): void
}

const Ctor =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as Record<string, (new () => Recognition) | undefined>).SpeechRecognition ??
      (window as unknown as Record<string, (new () => Recognition) | undefined>).webkitSpeechRecognition)

export const canListen = Boolean(Ctor)

export function recognition(lang: string, continuous = false): Recognition | null {
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = lang
  rec.continuous = continuous
  rec.interimResults = continuous
  return rec
}

/** Read text aloud, if the device can; the text is on screen either way */
export function speak(text: string, lang = 'en-IN') {
  try {
    speechSynthesis.cancel()
    speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text.replaceAll('₹', 'rupees ')), { lang }))
  } catch {
    // No speech output on this device.
  }
}
