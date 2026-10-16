// The building Assistant: ask by text or voice about this building and this app. Answers come from the real
// twin, simulation and site (code computes, the AI words it); setup changes come back as a diff to approve.
// Panel content only: the app shell places it in its side sheet, and the Live Twin page in a card.

import { AudioLines, Bot, Check, FileCog, Mic, Play, RotateCcw, Send, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { transcribe } from '@/ai/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSite } from '@/shared/site'
import { online } from '@/shared/workspace'
import { canRecord, chooseVoice, prepareVoice, speak, startRecording, stopSpeaking, useVoice, voiceError, voicePackSaved, VOICES, type VoiceId } from '../components/speech'
import { AiKeyHint } from './AiKeyHint'
import { approve, ask, clearConversation, dismiss, useConversation, type Message } from './conversation'
import { ListeningBar, SpeakingBar, TranscribingBar, VoicePack } from './voice-ui'

const TOOL_LABEL: Record<Message['tool'], string> = {
  liveSummary: 'Read every watched room',
  runScenario: 'Ran the simulation (modelled)',
  topWasters: 'Checked live room states',
  getRoom: 'Read one room',
  patterns: 'Looked at observed patterns',
  coverage: 'Checked camera coverage',
  explainMetric: 'Traced where the number comes from',
  connectionGuide: 'Connection guide',
  proposeSiteChange: 'Proposed a setup change',
  knowledge: 'Read this workspace and the app guide',
  teach: 'Explained a term',
  none: 'Outside what I can help with',
}

const LANGS = [
  { code: 'en', label: 'English', voice: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', voice: 'hi-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', voice: 'kn-IN' },
] as const

const LATER_KEY = 'pratibimb:voice-pack-later'
const readLater = () => {
  try {
    return sessionStorage.getItem(LATER_KEY) === '1'
  } catch {
    return false
  }
}

const SPEAK_KEY = 'pratibimb:assistant-speak'
const readSpeak = () => {
  try {
    return localStorage.getItem(SPEAK_KEY) === '1'
  } catch {
    return false
  }
}

function Proposal({ m }: { m: Message }) {
  const p = m.proposal!
  return (
    <div className="mt-2 rounded-lg border bg-card p-3">
      <table className="w-full text-xs">
        <caption className="sr-only">Proposed change</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="pb-1 text-left font-medium">
              Setting
            </th>
            <th scope="col" className="pb-1 text-left font-medium">
              Now
            </th>
            <th scope="col" className="pb-1 text-left font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.label} className="align-top">
              <th scope="row" className="py-1 pr-2 text-left font-medium">
                {r.label}
              </th>
              <td className="py-1 pr-2 text-muted-foreground line-through decoration-muted-foreground/50">{r.before}</td>
              <td className="py-1 font-medium">{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.state === 'open' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="h-10"
            onClick={async () => {
              const out = await approve(m.id)
              if (out.ok) toast.success(out.text)
              else toast.error(out.text)
            }}
          >
            <Check aria-hidden /> Approve and save
          </Button>
          <Button variant="outline" className="h-10" onClick={() => dismiss(m.id)}>
            <X aria-hidden /> Dismiss
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {p.state === 'approved' ? 'Approved and saved.' : 'Dismissed; nothing changed.'}
        </p>
      )}
    </div>
  )
}

function Answer({ m }: { m: Message }) {
  return (
    <li className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-muted px-3 py-2 text-sm">
        <span className="sr-only">You asked: </span>
        {m.q}
      </p>
      <div className="max-w-[95%] space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {m.source === 'ai' ? <Bot className="size-3.5 text-ai" aria-hidden /> : <FileCog className="size-3.5" aria-hidden />}
          {TOOL_LABEL[m.tool]} · {m.source === 'ai' ? 'AI answer' : 'Written by code'}
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-line">{m.a}</p>
        {m.steps && (
          <div className="space-y-2">
            {m.steps.map((s) => (
              <details key={s.name} className="rounded-lg border bg-card px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">{s.name}</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                  {s.steps.map((x) => (
                    <li key={x} className="break-words">
                      {x}
                    </li>
                  ))}
                </ol>
                <Link to={s.link} className="mt-2 inline-block text-xs font-medium text-highlight underline underline-offset-2">
                  Open {s.link === '/camera' ? 'Cameras' : 'Connections'}
                </Link>
              </details>
            ))}
          </div>
        )}
        {m.proposal && <Proposal m={m} />}
        {m.aiProblem && <AiKeyHint problem={m.aiProblem} />}
      </div>
    </li>
  )
}

export function AssistantPanel() {
  const messages = useConversation((s) => s.messages)
  const busy = useConversation((s) => s.busy)
  const firstRoom = useSite((s) => s.site.rooms[0]?.id)
  const [q, setQ] = useState('')
  const [lang, setLang] = useState<(typeof LANGS)[number]['code']>('en')
  const [voiceOut, setVoiceOut] = useState(readSpeak)
  // listening: the microphone records; transcribing: the server writes the words down
  const [phase, setPhase] = useState<'idle' | 'listening' | 'transcribing'>('idle')
  const listening = phase === 'listening'
  const cancelRef = useRef(false)
  const [meter, setMeter] = useState<(() => number) | null>(null)
  const [later, setLater] = useState(readLater)
  // Conversation mode: after each spoken answer the microphone opens again, and stops when the person goes quiet.
  const [talking, setTalking] = useState(false)
  const talkingRef = useRef(false)
  const voice = useVoice()
  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Voices already downloaded on this device load quietly from the cache; stop talking and listening on close.
  useEffect(() => {
    if (voiceOut || voicePackSaved()) prepareVoice()
  }, [voiceOut])
  useEffect(
    () => () => {
      talkingRef.current = false
      stopSpeaking()
      void recRef.current?.stop()
    },
    [],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, busy])

  const suggestions = [
    'Which room uses the most power right now?',
    firstRoom ? `How do I connect ${firstRoom}?` : 'How do I connect a room?',
    'What would auto-off save in a month?',
    'Where does the power figure come from?',
    'What is EPI?',
    'How do I invite a teammate?',
    'Turn on auto-off after 10 minutes',
  ]

  async function send(question: string) {
    setQ('')
    const m = await ask(question)
    if (!m) return
    if (voiceOut || talkingRef.current) await speak(m.a, LANGS.find((l) => l.code === lang)!.voice)
    // Listen again, unless the person already cut in with the microphone.
    if (talkingRef.current && !recRef.current) void listen()
  }

  /** Tap to speak, tap again to ask; the question is written down on the server with the workspace's speech key */
  async function listen() {
    if (recRef.current) return void recRef.current.stop()
    // Speaking over the Assistant interrupts it, like in a real conversation.
    stopSpeaking()
    try {
      cancelRef.current = false
      const rec = await startRecording(30_000, { untilSilence: talkingRef.current })
      recRef.current = rec
      setMeter(() => rec.level)
      setPhase('listening')
      const audio = await rec.done
      recRef.current = null
      if (cancelRef.current || (!talkingRef.current && audio.size === 0)) return setPhase('idle')
      setPhase('transcribing')
      const text = await transcribe(audio, lang)
      setPhase('idle')
      if (text) await send(text)
      else if (talkingRef.current) setTalking((talkingRef.current = false))
    } catch (e) {
      recRef.current = null
      setPhase('idle')
      setTalking((talkingRef.current = false))
      toast.error(voiceError(e))
    }
  }

  /** Stop recording and throw the audio away; also ends a hands-free conversation */
  function cancelListening() {
    cancelRef.current = true
    setTalking((talkingRef.current = false))
    void recRef.current?.stop()
  }

  function toggleTalking() {
    const next = !talkingRef.current
    setTalking((talkingRef.current = next))
    if (next) {
      prepareVoice()
      void listen()
    } else {
      stopSpeaking()
      void recRef.current?.stop()
    }
  }

  function toggleVoice() {
    const next = !voiceOut
    setVoiceOut(next)
    if (!next) stopSpeaking()
    try {
      localStorage.setItem(SPEAK_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the choice lasts for this page.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {lang === 'en' && !later && voice.state !== 'ready' && (
          <div className="mb-3">
            <VoicePack
              onLater={() => {
                setLater(true)
                try {
                  sessionStorage.setItem(LATER_KEY, '1')
                } catch {
                  // Storage blocked: the card stays hidden for this page.
                }
              }}
            />
          </div>
        )}
        {messages.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Ask about this building: live rooms and power, alerts, savings, where a number comes from, how to do anything in the app, or a change to the setup.</p>
            <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(s)}
                    className="min-h-10 rounded-full border bg-card px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol role="log" aria-live="polite" aria-label="Conversation with the Assistant" className="space-y-5 py-1">
            {messages.map((m) => (
              <Answer key={m.id} m={m} />
            ))}
          </ol>
        )}
        {busy && (
          <div className="mt-4 space-y-1.5" aria-busy="true" aria-label="The Assistant is answering">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="space-y-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send(q)
        }}
      >
        <SpeakingBar />
        {phase === 'listening' && meter ? (
          <ListeningBar level={meter} handsFree={talking} onCancel={cancelListening} onStop={() => void recRef.current?.stop()} />
        ) : phase === 'transcribing' ? (
          <TranscribingBar />
        ) : (
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this building" aria-label="Question for the Assistant" className="h-10 min-w-0" maxLength={500} />
            {canRecord && online() && (
              <Button type="button" variant="outline" className="size-10 shrink-0 border-ai/40 text-ai hover:bg-ai/10 hover:text-ai" onClick={listen} disabled={busy} aria-label="Ask by voice" title="Ask by voice">
                <Mic aria-hidden />
              </Button>
            )}
            <Button type="submit" className="size-10 shrink-0" disabled={busy || !q.trim()} aria-label="Ask">
              <Send aria-hidden />
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label htmlFor="assistant-lang">Language</label>
          <select id="assistant-lang" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} className="h-8 rounded-md border bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          {lang === 'en' && (
            <>
              <label htmlFor="assistant-voice">Voice</label>
              <select
                id="assistant-voice"
                value={voice.voice}
                onChange={(e) => chooseVoice(e.target.value as VoiceId)}
                className="h-8 rounded-md border bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              {voice.state === 'ready' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  disabled={voice.speaking}
                  onClick={() => void speak(`Hello, I'm ${VOICES.find((v) => v.id === voice.voice)!.label.split(',')[0]}. I'll read the Assistant's answers aloud.`)}
                >
                  <Play aria-hidden /> Preview
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={toggleVoice} aria-pressed={voiceOut}>
              {voiceOut ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />} Read answers aloud
            </Button>
            {canRecord && online() && (
              <Button
                type="button"
                variant={talking ? 'default' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={toggleTalking}
                aria-pressed={talking}
                title="Talk back and forth: the microphone opens after each answer and stops when you go quiet"
              >
                <AudioLines aria-hidden /> {talking ? 'End conversation' : 'Talk hands-free'}
              </Button>
            )}
          </div>
          {messages.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearConversation} disabled={busy}>
              <RotateCcw aria-hidden /> New conversation
            </Button>
          )}
        </div>
        {talking && !listening && (
          <p className="text-xs font-medium text-ai" role="status">
            {voice.speaking ? 'Hands-free is on. Tap the microphone to cut in.' : busy ? 'Thinking.' : 'Hands-free is on.'}
          </p>
        )}
      </form>
    </div>
  )
}
