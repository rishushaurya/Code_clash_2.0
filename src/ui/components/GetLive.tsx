// "Get your building live": the five steps from an empty workspace to a live twin, each linking to where it is done.
// Every tick is read from real state: the site, the twin's inputs, the stored keys and the server's status.

import { ArrowRight, CheckCircle2, Circle, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useSite } from '@/shared/site'
import { ns } from '@/shared/workspace'
import { useTwin } from '@/twin/store'
import { AI_PROVIDERS, useApi, type KeysResponse, type ServerStatus } from '../api'

const HIDE_KEY = ns('pratibimb:get-live-hidden')

export function GetLive({ always = false }: { always?: boolean }) {
  const site = useSite((s) => s.site)
  const hasInput = useTwin((s) => Object.values(s.rooms).some((r) => r.sources.length > 0) || Object.keys(s.readings).length > 0)
  const [keys] = useApi<KeysResponse>('/api/keys')
  const [status] = useApi<ServerStatus>('/api/status')
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })

  const k = keys.state === 'ok' ? keys.data : null
  const s = status.state === 'ok' ? status.data : null
  const keySet = (name: string) => Boolean(k?.keys.find((x) => x.name === name)?.set)
  const steps = [
    { done: Boolean(site.buildingName && site.location), label: 'Name the building and find its location', hint: 'Sets currency, tariff, weather and daylight advice', to: '/settings/site' },
    { done: site.rooms.length > 0, label: 'Add the rooms and their devices', hint: 'Templates, a photo or Set up with AI', to: '/settings/site#rooms' },
    { done: hasInput, label: 'Connect a first camera or sensor', hint: 'A phone works; smart plugs and meters too', to: '/connections' },
    { done: keySet('telegram') || Boolean(site.telegramChatId && s?.telegram), label: 'Choose where alerts go', hint: 'A Telegram group gets alerts with a switch-off button', to: '/settings/keys#telegram' },
    {
      done: AI_PROVIDERS.some(keySet) || Boolean(s?.ai && (k?.ai.useDeploymentKeys ?? true)),
      label: 'Add an AI key',
      hint: 'Free keys from Groq or Google work; the AI only writes words',
      to: '/settings/keys',
    },
  ]
  const done = steps.filter((x) => x.done).length
  if (!always && (hidden || done === steps.length)) return null

  return (
    <Card className="border-highlight/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-lg">Get your building live</CardTitle>
          <CardDescription>
            {done} of {steps.length} done. Each step opens the page where it is done.
          </CardDescription>
        </div>
        {!always && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hide this checklist"
            onClick={() => {
              setHidden(true)
              try {
                localStorage.setItem(HIDE_KEY, '1')
              } catch {
                // Hidden for this visit only.
              }
            }}
          >
            <X aria-hidden />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={(done / steps.length) * 100} aria-label={`${done} of ${steps.length} steps done`} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-highlight" />
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {steps.map((step, i) => (
            <li key={step.label}>
              <Link
                to={step.to}
                className="group flex h-full items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors hover:border-highlight/50 hover:bg-accent"
              >
                {step.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-occupied" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 space-y-0.5">
                  <span className={`block font-medium ${step.done ? 'text-muted-foreground line-through decoration-1' : ''}`}>
                    <span className="sr-only">{step.done ? 'Done: ' : `Step ${i + 1}, to do: `}</span>
                    {step.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{step.hint}</span>
                </span>
                {!step.done && <ArrowRight className="ml-auto mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />}
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
