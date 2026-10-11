// Voice in and out with what every browser has. In: record with MediaRecorder, then the server writes it
// down (api/_routes/ai/transcribe.ts), so it works in Chrome, Edge, Safari, Firefox and Brave alike.
// Out: the browser's own speech synthesis reads answers aloud.

export const canRecord = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'

/**
 * Starts recording from the microphone. `stop()` ends it and returns the audio; it also ends by itself
 * after `maxMs`, and `done` resolves either way.
 */
export async function startRecording(maxMs = 180_000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
  // 32 kbit/s keeps speech clear and a long description under the server's upload limit.
  const rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      resolve(new Blob(chunks, { type: rec.mimeType.split(';')[0] || 'audio/webm' }))
    }
  })
  rec.start(1000)
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs)
  return {
    done,
    stop() {
      clearTimeout(timer)
      if (rec.state !== 'inactive') rec.stop()
      return done
    },
  }
}

/** Why the microphone could not start, in words a person can act on */
export function micError(e: unknown) {
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError') return 'Microphone permission is off. Allow it in the address bar, then press Speak again.'
  if (name === 'NotFoundError') return 'No microphone was found on this device.'
  return 'The microphone could not start. You can type instead.'
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
