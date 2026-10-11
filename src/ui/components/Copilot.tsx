// "Talk to the building": ask by voice or text. The AI picks a tool, this browser runs the real
// simulation, the AI explains the numbers, and the answer is spoken back.

import { Bot, Mic, MicOff, Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { copilotAnswer, copilotPlan, transcribe, type CopilotTool } from '@/ai/client'
import { guessTool, runTool, templateAnswer } from '@/ai/tools'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getSite } from '@/shared/site'
import { toast } from 'sonner'
import { online } from '@/shared/workspace'
import { canRecord, micError, speak, startRecording } from './speech'

const TOOL_LABEL: Record<CopilotTool['tool'], string> = {
  runScenario: 'Ran the simulation',
  topWasters: 'Checked live room states',
  getRoom: 'Read one room',
  patterns: 'Looked at observed patterns',
  none: 'No tool needed',
}

export function Copilot() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null)
  const [turn, setTurn] = useState<{ q: string; tool: CopilotTool; answer: string; ai: boolean } | null>(null)

  async function ask(question: string) {
    if (!question.trim()) return
    setBusy(true)
    let tool: CopilotTool
    let ai = true
    try {
      tool = await copilotPlan(question, getSite().rooms.map((r) => r.id))
    } catch {
      tool = guessTool(question)
      ai = false
    }
    const result = runTool(tool)
    let answer = templateAnswer(tool, result)
    if (ai && tool.tool !== 'none') {
      try {
        answer = (await copilotAnswer(question, result)).answer
      } catch {
        ai = false
      }
    }
    setTurn({ q: question, tool, answer, ai })
    setBusy(false)
    speak(answer)
  }

  /** Tap to speak, tap again to ask; the question is written down on the server, then asked. */
  async function listen() {
    if (recRef.current) return void recRef.current.stop()
    try {
      const rec = await startRecording(30_000)
      recRef.current = rec
      setListening(true)
      const audio = await rec.done
      recRef.current = null
      setListening(false)
      setBusy(true)
      const text = await transcribe(audio, 'en')
      setBusy(false)
      setQ(text)
      if (text) void ask(text)
    } catch (e) {
      recRef.current = null
      setListening(false)
      setBusy(false)
      toast.error(e instanceof Error && e.message.startsWith('transcribe') ? 'The voice service is not available just now. Type the question instead.' : micError(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-5 text-highlight" aria-hidden /> Ask the building
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(q)
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What would auto-off save this semester?" aria-label="Question for the building" />
          {canRecord && online() && (
            <Button type="button" variant={listening ? 'default' : 'outline'} size="icon" onClick={listen} disabled={busy} aria-pressed={listening} aria-label={listening ? 'Stop and ask' : 'Ask by voice'} title={listening ? 'Listening: tap again to ask' : 'Ask by voice'}>
              {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
            </Button>
          )}
          <Button type="submit" size="icon" disabled={busy || !q.trim()} aria-label="Ask">
            <Send aria-hidden />
          </Button>
        </form>
        {busy && (
          <div className="space-y-1.5" aria-busy="true" aria-label="Thinking">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}
        {!busy && turn && (
          <div className="space-y-1 text-sm" role="status">
            <p className="text-xs text-muted-foreground">
              {TOOL_LABEL[turn.tool.tool]}
              {turn.tool.tool === 'runScenario' ? ` (${turn.tool.policy.replace('_', '-')})` : ''} · {turn.ai ? 'AI answer' : 'Offline answer'}
            </p>
            <p>{turn.answer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
