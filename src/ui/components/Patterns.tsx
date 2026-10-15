// When are empty rooms left on? Patterns from observed data, explained in plain words by the AI
// (or by code offline). This is the "analyze the data" half of the problem statement.

import { Sparkles, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AiFailed, AiNeedsKey, copilotAnswer } from '@/ai/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DAY, patternFacts, templatePatterns } from '@/ai/patterns'
import { wastePatterns } from '@/twin/usage'
import { AiKeyHint } from '../assistant/AiKeyHint'

export function Patterns() {
  const [list, setList] = useState(() => wastePatterns())
  const [summary, setSummary] = useState<{ text: string; ai: boolean; problem?: string } | 'loading' | null>(null)
  useEffect(() => {
    const t = setInterval(() => setList(wastePatterns()), 60_000)
    return () => clearInterval(t)
  }, [])

  async function explain() {
    setSummary('loading')
    try {
      const { answer } = await copilotAnswer('In two sentences, explain when and where empty rooms are left on, and the single most useful action.', { patterns: patternFacts(list) })
      setSummary({ text: answer, ai: true })
    } catch (e) {
      setSummary({ text: templatePatterns(list), ai: false, problem: e instanceof AiNeedsKey ? 'no-key' : e instanceof AiFailed ? e.message : undefined })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-highlight" aria-hidden /> Patterns
        </CardTitle>
        {list.length > 0 && (
          <Button size="sm" variant="ghost" onClick={explain} disabled={summary === 'loading'} title="Have the AI explain these patterns">
            <Sparkles aria-hidden /> Explain
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {list.length === 0 ? (
          <p className="text-muted-foreground">Patterns appear after cameras or sensors have watched empty rooms for a while: which room, which day, which hour things get left on.</p>
        ) : (
          <ol className="space-y-1.5">
            {list.map((p) => (
              <li key={`${p.roomId}-${p.weekday}-${p.hour}`} className="flex items-center justify-between gap-2">
                <span>
                  <span className="num font-medium">{p.roomId}</span> · {DAY[p.weekday]} {p.hour}:00
                </span>
                <span className="num text-waste" title={`Observed empty for ${p.emptyHours.toFixed(1)} h in that hour`}>
                  left on {Math.round(p.share * 100)}%
                </span>
              </li>
            ))}
          </ol>
        )}
        {summary === 'loading' && <Skeleton className="h-12 w-full" aria-label="Explaining the patterns" />}
        {summary && summary !== 'loading' && (
          <p role="status" className="rounded-lg bg-muted p-3">
            {summary.text}
            <span className="mt-1 block text-xs text-muted-foreground">{summary.ai ? 'Written by AI from observed data' : 'Written offline from observed data'}</span>
          </p>
        )}
        {summary && summary !== 'loading' && summary.problem && <AiKeyHint problem={summary.problem} />}
      </CardContent>
    </Card>
  )
}
