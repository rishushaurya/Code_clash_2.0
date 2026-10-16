// The Assistant's voice controls: the natural-voice download card, the live listening bar, and the speaking bar.

import { AudioLines, Check, Download, Loader2, Mic, Send, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { prepareVoice, retryVoice, stopSpeaking, useVoice, VOICES } from '../components/speech'

/** The voice pack card: what it is, its size, and the download, shown first while the voices are not on this device */
export function VoicePack({ onLater }: { onLater: () => void }) {
  const { state, progress, voices } = useVoice()
  if (state === 'ready') return null
  return (
    <section aria-labelledby="voice-pack-title" className="space-y-3 rounded-xl border border-ai/30 bg-ai/5 p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ai text-on-ai" aria-hidden>
          <AudioLines className="size-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 id="voice-pack-title" className="text-sm font-semibold">
            Natural voices
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state === 'failed'
              ? "The voices could not download here, so the device's own voice speaks for now."
              : 'Four human-sounding voices that run on this device. About 90 MB, downloaded once. Keep asking while it downloads.'}
          </p>
        </div>
      </div>
      {state === 'loading' && (
        <div className="space-y-2" role="status">
          <div className="flex items-center justify-between text-xs">
            <span>Downloading voices</span>
            <span className="num">{progress} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ai/15" role="progressbar" aria-label="Voice download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-ai transition-[width] duration-300" style={{ width: `${Math.max(3, progress)}%` }} />
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Voices">
            {VOICES.map((v) => {
              const done = voices.includes(v.id)
              return (
                <li key={v.id} className="flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs">
                  {done ? <Check className="size-3 text-occupied" aria-hidden /> : <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />}
                  {v.label.split(',')[0]}
                  <span className="sr-only">{done ? ', ready' : ', downloading'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {state !== 'loading' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-9 bg-ai text-on-ai hover:bg-ai/90" onClick={state === 'failed' ? retryVoice : prepareVoice}>
            <Download aria-hidden /> {state === 'failed' ? 'Try again' : 'Download voices'}
          </Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={onLater}>
            Not now
          </Button>
        </div>
      )}
    </section>
  )
}

const BARS = 28
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** While the microphone records: a live level meter, the time, Cancel, and Stop and ask */
export function ListeningBar({ level, handsFree, onCancel, onStop }: { level: () => number; handsFree: boolean; onCancel: () => void; onStop: () => void }) {
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0))
  const [start] = useState(Date.now)
  const [now, setNow] = useState(start)
  useEffect(() => {
    const t = setInterval(() => {
      const l = level()
      setBars((b) => [...b.slice(1), l])
      setNow(Date.now())
    }, 70)
    return () => clearInterval(t)
  }, [level])
  const loud = bars[BARS - 1]
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-ai/40 bg-ai/5 px-3 py-2"
      role="status"
      aria-label={handsFree ? 'Listening. I answer when you pause.' : 'Listening. Press Ask when you are done.'}
    >
      <span className="relative grid size-10 shrink-0 place-items-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-ai/30 motion-safe:animate-ping" />
        <span className="absolute inset-0 rounded-full bg-ai/20 transition-transform duration-75" style={{ transform: `scale(${1 + loud * 0.45})` }} />
        <span className="relative grid size-10 place-items-center rounded-full bg-ai text-on-ai">
          <Mic className="size-4" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex h-7 items-center gap-[2px]" aria-hidden>
          {bars.map((b, i) => (
            <span key={i} className="w-1 flex-1 rounded-full bg-ai/80" style={{ height: `${Math.max(8, b * 100)}%`, opacity: 0.35 + (i / BARS) * 0.65 }} />
          ))}
        </div>
        <p className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>{handsFree ? 'Listening, I answer when you pause' : 'Listening'}</span>
          <span className="num">{clock(now - start)}</span>
        </p>
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={onCancel} aria-label="Cancel, do not ask">
        <X aria-hidden />
      </Button>
      <Button type="button" className="h-10 shrink-0 bg-ai text-on-ai hover:bg-ai/90" onClick={onStop} aria-label="Stop and ask">
        <Send aria-hidden /> Ask
      </Button>
    </div>
  )
}

/** After recording: the words are being written down */
export function TranscribingBar() {
  return (
    <div className="flex h-14 items-center gap-3 rounded-xl border bg-card px-3 text-sm" role="status">
      <Loader2 className="size-4 animate-spin text-ai" aria-hidden /> Writing down what you said
    </div>
  )
}

/** While an answer is read aloud: a moving equaliser and Stop */
export function SpeakingBar() {
  const speaking = useVoice((s) => s.speaking)
  if (!speaking) return null
  return (
    <div className="flex items-center gap-2 rounded-lg bg-ai/5 px-3 py-1.5 text-xs" role="status">
      <span className="flex h-4 items-end gap-[3px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="eq-bar h-full w-[3px] rounded-full bg-ai" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      <span className="flex-1">Speaking</span>
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={stopSpeaking}>
        <Square className="size-3" aria-hidden /> Stop
      </Button>
    </div>
  )
}
