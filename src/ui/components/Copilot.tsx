// "Talk to the building": ask by voice or text. The AI picks a tool, this browser runs the real
// simulation, the AI explains the numbers, and the answer is spoken back.

import { Bot, Mic, MicOff, Send } from 'lucide-react'
import { useState } from 'react'
import { copilotAnswer, copilotPlan, type CopilotTool } from '@/ai/client'
import { guessTool, runTool, templateAnswer } from '@/ai/tools'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getSite } from '@/shared/site'

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start(): void; stop(): void }
const SpeechRecognitionCtor = (window as unknown as Record<string, (new () => Recognition) | undefined>).SpeechRecognition ??
  (window as unknown as Record<string, (new () => Recognition) | undefined>).webkitSpeechRecognition

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
    try {
      speechSynthesis.cancel()
      speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(answer.replaceAll('₹', 'rupees ')), { lang: 'en-IN' }))
    } catch {
      // No speech output on this device; the answer is on screen.
    }
  }

  function listen() {
    if (!SpeechRecognitionCtor) return
    const rec = new SpeechRecognitionCtor()
    rec.lang = 'en-IN'
    rec.interimResults = false
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript
      setQ(text)
      void ask(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
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
          {SpeechRecognitionCtor && (
            <Button type="button" variant="outline" size="icon" onClick={listen} disabled={listening || busy} aria-label={listening ? 'Listening' : 'Ask by voice'} title="Ask by voice">
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
