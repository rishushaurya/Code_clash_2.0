// The building Assistant: ask by text or voice about this building and this app. Answers come from the real
// twin, simulation and site (code computes, the AI words it); setup changes come back as a diff to approve.
// Panel content only: the app shell places it in its side sheet, and the Live Twin page in a card.

import { Bot, Check, FileCog, Mic, MicOff, RotateCcw, Send, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { transcribe } from '@/ai/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSite } from '@/shared/site'
import { online } from '@/shared/workspace'
import { canRecord, speak, startRecording, voiceError } from '../components/speech'
import { AiKeyHint } from './AiKeyHint'
import { approve, ask, clearConversation, dismiss, useConversation, type Message } from './conversation'

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
  teach: 'Explained a term',
  none: 'Outside what I can help with',
}

const LANGS = [
  { code: 'en', label: 'English', voice: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', voice: 'hi-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', voice: 'kn-IN' },
] as const

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
  const [listening, setListening] = useState(false)
  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, busy])

  const suggestions = [
    'Which room uses the most power right now?',
    firstRoom ? `How do I connect ${firstRoom}?` : 'How do I connect a room?',
    'What would auto-off save in a month?',
    'Where does the power figure come from?',
    'What is EPI?',
    'Turn on auto-off after 10 minutes',
  ]

  async function send(question: string) {
    setQ('')
    const m = await ask(question)
    if (m && voiceOut) speak(m.a, LANGS.find((l) => l.code === lang)!.voice)
  }

  /** Tap to speak, tap again to ask; the question is written down on the server with the workspace's speech key */
  async function listen() {
    if (recRef.current) return void recRef.current.stop()
    try {
      const rec = await startRecording(30_000)
      recRef.current = rec
      setListening(true)
      const audio = await rec.done
      recRef.current = null
      setListening(false)
      const text = await transcribe(audio, lang)
      if (text) await send(text)
    } catch (e) {
      recRef.current = null
      setListening(false)
      toast.error(voiceError(e))
    }
  }

  function toggleVoice() {
    const next = !voiceOut
    setVoiceOut(next)
    if (!next) speechSynthesis?.cancel()
    try {
      localStorage.setItem(SPEAK_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the choice lasts for this page.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Ask about this building: live rooms and power, alerts, savings, where a number comes from, connecting a room, or a change to the setup.</p>
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
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this building" aria-label="Question for the Assistant" className="h-10 min-w-0" maxLength={500} />
          {canRecord && online() && (
            <Button
              type="button"
              variant={listening ? 'default' : 'outline'}
              className="size-10 shrink-0"
              onClick={listen}
              disabled={busy}
              aria-pressed={listening}
              aria-label={listening ? 'Stop and ask' : 'Ask by voice'}
              title={listening ? 'Listening: tap again to ask' : 'Ask by voice'}
            >
              {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
            </Button>
          )}
          <Button type="submit" className="size-10 shrink-0" disabled={busy || !q.trim()} aria-label="Ask">
            <Send aria-hidden />
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <label htmlFor="assistant-lang">Voice</label>
            <select id="assistant-lang" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} className="h-8 rounded-md border bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={toggleVoice} aria-pressed={voiceOut}>
              {voiceOut ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />} Read answers aloud
            </Button>
          </div>
          {messages.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearConversation} disabled={busy}>
              <RotateCcw aria-hidden /> New conversation
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
