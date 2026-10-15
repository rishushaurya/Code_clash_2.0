// /settings/keys  Bring your own keys: AI providers, Telegram, Google Maps, smart plugs, Home Assistant and the
// command webhook. Keys go to the server, which stores them encrypted; the browser only ever sees the last four
// characters and the last test. Each card has an id (#telegram, #groq) so the place a key is used can link here.

import { ArrowDown, ArrowUp, Bot, ExternalLink, Home, KeyRound, Map as MapIcon, MessageCircle, Plug, Save, Send, ServerCog, Trash2, Webhook, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { AiProvider, AiSettings, AiTask, KeyName, KeyStatus } from '@/shared/types'
import { AI_PROVIDERS, callApi, useApi, type KeysResponse } from '../api'
import { ErrorState, PageHeader, PanelSkeleton } from '../components/states'
import { StatusLight, type Light } from '../components/status'
import { useScrollToHash } from '../nav'

interface KeyInfo {
  title: string
  icon: LucideIcon
  description: string
  getKey: { url: string; label: string }
  valueLabel: string
  /** Server address for keys that need one */
  baseUrl?: { label: string; placeholder: string; optional?: boolean }
}

const INFO: Record<KeyName, KeyInfo> = {
  groq: { title: 'Groq', icon: Bot, description: 'Free tier and very fast. Chat, reports and Whisper voice.', getKey: { url: 'https://console.groq.com/keys', label: 'Get a Groq key' }, valueLabel: 'API key' },
  gemini: { title: 'Google Gemini', icon: Bot, description: 'Free tier. Reads photos: the AI Surveyor and floor plan photos.', getKey: { url: 'https://aistudio.google.com/apikey', label: 'Get a Gemini key' }, valueLabel: 'API key' },
  openai: { title: 'OpenAI', icon: Bot, description: 'Chat, reports, photos and voice.', getKey: { url: 'https://platform.openai.com/api-keys', label: 'Get an OpenAI key' }, valueLabel: 'API key' },
  anthropic: { title: 'Anthropic', icon: Bot, description: 'Claude models for chat, reports and photos.', getKey: { url: 'https://console.anthropic.com/settings/keys', label: 'Get an Anthropic key' }, valueLabel: 'API key' },
  openrouter: { title: 'OpenRouter', icon: Bot, description: 'One key for hundreds of models from many providers.', getKey: { url: 'https://openrouter.ai/settings/keys', label: 'Get an OpenRouter key' }, valueLabel: 'API key' },
  custom: {
    title: 'Custom, OpenAI-compatible',
    icon: Bot,
    description: 'Any server that speaks the OpenAI API: Ollama, LM Studio, vLLM, Together, Mistral and others.',
    getKey: { url: 'https://platform.openai.com/docs/api-reference/chat', label: 'About the OpenAI API format' },
    valueLabel: 'API key',
    baseUrl: { label: 'Base URL', placeholder: 'https://api.example.com/v1' },
  },
  telegram: {
    title: 'Telegram bot',
    icon: MessageCircle,
    description: 'Create a bot with BotFather, paste its token, press Connect, then write to the bot in your staff group. Alerts arrive there with a Switch off button.',
    getKey: { url: 'https://t.me/BotFather', label: 'Open BotFather' },
    valueLabel: 'Bot token',
  },
  google_maps: {
    title: 'Google Maps',
    icon: MapIcon,
    description: 'Optional: the city around your building in 3D. This key runs in the browser by design, so restrict it to your domain in Google Cloud.',
    getKey: { url: 'https://console.cloud.google.com/google/maps-apis/credentials', label: 'Create a Maps key' },
    valueLabel: 'Browser API key',
  },
  shelly_cloud: {
    title: 'Shelly Cloud smart plugs',
    icon: Plug,
    description: 'In the Shelly app: User settings, Authorization cloud key. The same page shows the server address. The key changes when your Shelly password changes.',
    getKey: { url: 'https://control.shelly.cloud', label: 'Open Shelly Cloud' },
    valueLabel: 'Authorization cloud key',
    baseUrl: { label: 'Server address', placeholder: 'https://shelly-XX-eu.shelly.cloud' },
  },
  home_assistant: {
    title: 'Home Assistant',
    icon: Home,
    description: 'In Home Assistant: your profile, Security, Long-lived access tokens. The twin sends switch-off commands through it.',
    getKey: { url: 'https://www.home-assistant.io/docs/authentication/#your-account-profile', label: 'How to make a token' },
    valueLabel: 'Long-lived access token',
    baseUrl: { label: 'Home Assistant address', placeholder: 'https://homeassistant.example.com' },
  },
  command_webhook: {
    title: 'Command webhook',
    icon: Webhook,
    description: 'Any control system: the twin posts each switch-off to this URL, signed with the secret (HMAC-SHA256 in the x-signature header).',
    getKey: { url: '#command_webhook', label: 'docs/INTEGRATIONS.md has the format' },
    valueLabel: 'Signing secret',
    baseUrl: { label: 'Webhook URL', placeholder: 'https://bms.example.com/pratibimb' },
  },
}

const TASKS: { id: AiTask; label: string; hint: string }[] = [
  { id: 'chat', label: 'Chat and alerts', hint: 'Assistant answers and alert wording' },
  { id: 'report', label: 'Reports', hint: 'The audit report' },
  { id: 'vision', label: 'Photos', hint: 'Surveyor and floor plan photos' },
  { id: 'speech', label: 'Voice', hint: 'Speech to text' },
]

const DEFAULT_AI: AiSettings = {
  tasks: { chat: { provider: 'groq', model: '' }, report: { provider: 'groq', model: '' }, vision: { provider: 'gemini', model: '' }, speech: { provider: 'groq', model: '' } },
  fallback: AI_PROVIDERS,
  useDeploymentKeys: true,
}

const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function lightOf(k: KeyStatus | undefined, deployment: boolean): [Light, string] {
  if (k?.set) return k.ok === false ? ['warn', 'Last test failed'] : k.ok ? ['ok', `Working, ends ${k.last4 ?? ''}`] : ['ok', `Saved, ends ${k.last4 ?? ''}`]
  if (deployment) return ['ok', "Deployment's key"]
  return ['off', 'Not set']
}

function KeyCard({ name, status, deployment, disabled, onSaved, onModels, children }: { name: KeyName; status?: KeyStatus; deployment?: boolean; disabled: boolean; onSaved: (k: KeyStatus | null) => void; onModels?: (m: string[]) => void; children?: React.ReactNode }) {
  const info = INFO[name]
  const [value, setValue] = useState('')
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? '')
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'remove'>('')
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [light, label] = lightOf(status, Boolean(deployment))
  const external = info.getKey.url.startsWith('http')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    setBusy('save')
    const r = await callApi<KeyStatus>('/api/keys', { method: 'PUT', json: { name, value: value.trim(), ...(info.baseUrl && { baseUrl: baseUrl.trim() }) } })
    setBusy('')
    if (r.state !== 'ok') return toast.error(r.state === 'error' ? r.message : 'This server cannot store keys yet.')
    setValue('')
    setTest(null)
    onSaved(r.data)
    toast.success(`${info.title} saved`, { description: 'Stored encrypted on the server. It is never shown again.' })
  }

  async function runTest() {
    setBusy('test')
    const r = await callApi<{ ok: boolean; error?: string; models?: string[] }>('/api/keys/test', { method: 'POST', json: { name } })
    setBusy('')
    if (r.state !== 'ok') return setTest({ ok: false, text: r.state === 'error' ? r.message : 'This server cannot test keys yet.' })
    const models = r.data.models ?? []
    if (models.length) onModels?.(models)
    setTest(r.data.ok ? { ok: true, text: models.length ? `Works. ${models.length} models available.` : 'Works.' } : { ok: false, text: r.data.error ?? 'The provider refused the key.' })
    if (status) onSaved({ ...status, ok: r.data.ok, error: r.data.error, testedAt: Date.now() })
  }

  async function remove() {
    if (!confirm(`Remove the ${info.title} key from this workspace?`)) return
    setBusy('remove')
    const r = await callApi(`/api/keys?name=${name}`, { method: 'DELETE' })
    setBusy('')
    if (r.state !== 'ok') return toast.error(r.state === 'error' ? r.message : 'This server cannot remove keys yet.')
    setTest(null)
    onSaved(null)
    toast.success(`${info.title} key removed`)
  }

  return (
    <Card id={name} tabIndex={-1} className="scroll-mt-20 gap-4 outline-none focus:ring-2 focus:ring-highlight/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <info.icon className="size-4 text-highlight" aria-hidden /> {info.title}
        </CardTitle>
        <CardDescription>{info.description}</CardDescription>
        <CardAction>
          <StatusLight light={light} label={label} />
        </CardAction>
      </CardHeader>
      <form onSubmit={save}>
        <CardContent className="space-y-3">
          {info.baseUrl && (
            <div className="space-y-1.5">
              <Label htmlFor={`${name}-url`}>{info.baseUrl.label}</Label>
              <Input id={`${name}-url`} type="url" inputMode="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={info.baseUrl.placeholder} disabled={disabled} autoComplete="off" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${name}-value`}>{info.valueLabel}</Label>
            <Input
              id={`${name}-value`}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={status?.set ? `Saved, ends ${status.last4 ?? ''}. Paste a new one to replace it.` : 'Paste it here'}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              aria-describedby={`${name}-help`}
            />
            <p id={`${name}-help`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {external ? (
                <a href={info.getKey.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-highlight underline-offset-2 hover:underline">
                  {info.getKey.label} <ExternalLink className="size-3" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <span>{info.getKey.label}</span>
              )}
              {status?.testedAt && <span>Last tested {when(status.testedAt)}</span>}
            </p>
          </div>
          {test && (
            <p role="status" className={`text-sm ${test.ok ? 'text-occupied' : 'text-waste'}`}>
              {test.ok ? 'Test passed. ' : 'Test failed. '}
              {test.text}
            </p>
          )}
          {!test && status?.ok === false && status.error && (
            <p className="text-sm text-waste" role="status">
              Last test failed: {status.error}
            </p>
          )}
          {children}
        </CardContent>
        <CardFooter className="mt-4 flex-wrap justify-end gap-2">
          {status?.set && (
            <Button type="button" variant="ghost" size="sm" className="mr-auto text-waste" onClick={remove} disabled={disabled || busy !== ''}>
              <Trash2 aria-hidden /> Remove
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={runTest} disabled={disabled || busy !== '' || !status?.set}>
            {busy === 'test' ? 'Testing' : 'Test'}
          </Button>
          <Button type="submit" size="sm" disabled={disabled || busy !== '' || !value.trim() || (info.baseUrl && !info.baseUrl.optional && !baseUrl.trim())}>
            <Save aria-hidden /> {busy === 'save' ? 'Saving' : 'Save'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function TelegramConnect({ disabled, ready }: { disabled: boolean; ready: boolean }) {
  const [state, setState] = useState<{ busy: boolean; bot?: string; chat?: string; error?: string }>({ busy: false })
  async function connect() {
    setState({ busy: true })
    const r = await callApi<{ ok?: boolean; bot?: string; chat?: string; error?: string }>('/api/telegram/connect', { method: 'POST' })
    if (r.state !== 'ok') return setState({ busy: false, error: r.state === 'error' ? r.message : 'This server cannot connect a bot yet.' })
    setState({ busy: false, ...r.data })
  }
  return (
    <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{ready ? 'Then connect the bot to this workspace.' : 'Save the bot token first.'}</span>
        <Button type="button" size="sm" onClick={connect} disabled={disabled || !ready || state.busy}>
          <Send aria-hidden /> {state.busy ? 'Connecting' : 'Connect'}
        </Button>
      </div>
      {(state.bot || state.chat || state.error) && (
        <p role="status" className={state.error ? 'text-waste' : ''}>
          {state.error ??
            [state.bot && `Bot ${state.bot.startsWith('@') ? state.bot : `@${state.bot}`} is connected.`, state.chat ? `Alerts go to ${state.chat}.` : 'Now write any message to the bot in your staff group to link that chat.'].filter(Boolean).join(' ')}
        </p>
      )}
    </div>
  )
}

function AiRouting({ settings, keys, deployment, models, disabled, onSaved }: { settings: AiSettings; keys: KeyStatus[]; deployment: Partial<Record<AiProvider, boolean>>; models: Partial<Record<AiProvider, string[]>>; disabled: boolean; onSaved: (s: AiSettings) => void }) {
  const [draft, setDraft] = useState(settings)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const usable = (p: AiProvider) => Boolean(keys.find((k) => k.name === p)?.set || (draft.useDeploymentKeys && deployment[p]))
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const f = [...d.fallback]
      ;[f[i], f[i + by]] = [f[i + by], f[i]]
      return { ...d, fallback: f }
    })

  async function save() {
    setBusy(true)
    const r = await callApi('/api/keys/ai', { method: 'PUT', json: draft })
    setBusy(false)
    if (r.state !== 'ok') return toast.error(r.state === 'error' ? r.message : 'This server cannot store AI settings yet.')
    onSaved(draft)
    toast.success('AI settings saved')
  }

  return (
    <Card id="ai" tabIndex={-1} className="scroll-mt-20 outline-none focus:ring-2 focus:ring-highlight/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-highlight" aria-hidden /> Which AI does what
        </CardTitle>
        <CardDescription>Pick a provider and model for each job. The AI only writes words; every number comes from the twin.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {TASKS.map((t) => {
            const choice = draft.tasks[t.id]
            const list = models[choice.provider] ?? []
            return (
              <div key={t.id} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                <div>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.hint}</p>
                </div>
                <Select value={choice.provider} onValueChange={(v) => setDraft((d) => ({ ...d, tasks: { ...d.tasks, [t.id]: { provider: v as AiProvider, model: '' } } }))} disabled={disabled}>
                  <SelectTrigger aria-label={`Provider for ${t.label}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {INFO[p].title}
                        {usable(p) ? '' : ', no key yet'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Model for ${t.label}`}
                  list={`models-${t.id}`}
                  value={choice.model}
                  onChange={(e) => setDraft((d) => ({ ...d, tasks: { ...d.tasks, [t.id]: { ...choice, model: e.target.value } } }))}
                  placeholder={list.length ? 'Choose or type a model' : "Provider's default model"}
                  disabled={disabled}
                  autoComplete="off"
                />
                <datalist id={`models-${t.id}`}>
                  {list.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">Press Test on a provider's card to list its models here.</p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium" id="fallback-label">
            When a provider fails, try the next one in this order
          </p>
          <ol aria-labelledby="fallback-label" className="divide-y rounded-lg border">
            {draft.fallback.map((p, i) => (
              <li key={p} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="num w-5 text-muted-foreground">{i + 1}</span>
                <span className="flex-1">{INFO[p].title}</span>
                <StatusLight light={usable(p) ? 'ok' : 'off'} label={usable(p) ? 'Has a key' : 'No key, skipped'} className="hidden sm:inline-flex" />
                <Button type="button" size="icon" variant="ghost" aria-label={`Move ${INFO[p].title} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Move ${INFO[p].title} down`} disabled={disabled || i === draft.fallback.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <Switch checked={draft.useDeploymentKeys} onCheckedChange={(v) => setDraft((d) => ({ ...d, useDeploymentKeys: v }))} disabled={disabled} aria-describedby="deploy-help" className="mt-0.5" />
          <span>
            Use the deployment's keys when mine fail
            <span id="deploy-help" className="block text-xs text-muted-foreground">
              {Object.values(deployment).some(Boolean)
                ? `This deployment has keys for ${AI_PROVIDERS.filter((p) => deployment[p]).map((p) => INFO[p].title).join(', ')}. Its operator may switch this off.`
                : Object.keys(deployment).length
                  ? 'This deployment has no AI keys of its own.'
                  : 'Which keys the deployment has shows here once key storage is on.'}
            </span>
          </span>
        </label>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={save} disabled={disabled || busy || !dirty}>
          <Save aria-hidden /> {busy ? 'Saving' : dirty ? 'Save AI settings' : 'Saved'}
        </Button>
      </CardFooter>
    </Card>
  )
}

export default function KeysSettings() {
  const [res, reload] = useApi<KeysResponse>('/api/keys')
  const [local, setLocal] = useState<{ keys: KeyStatus[]; ai: AiSettings } | null>(null)
  const [models, setModels] = useState<Partial<Record<AiProvider, string[]>>>({})
  useScrollToHash(res.state !== 'loading')

  if (res.state === 'loading') return <PanelSkeleton rows={8} />
  if (res.state === 'error') return <ErrorState message={res.message} onRetry={reload} />

  const disabled = res.state === 'missing'
  const keys = local?.keys ?? (res.state === 'ok' ? res.data.keys : [])
  const ai = local?.ai ?? (res.state === 'ok' ? { ...DEFAULT_AI, ...res.data.ai } : DEFAULT_AI)
  const deployment = res.state === 'ok' ? res.data.deployment : {}
  const statusOf = (n: KeyName) => keys.find((k) => k.name === n)
  const setKey = (n: KeyName) => (k: KeyStatus | null) => setLocal({ ai, keys: [...keys.filter((x) => x.name !== n), ...(k ? [k] : [])] })
  const card = (n: KeyName, children?: React.ReactNode) => (
    <KeyCard key={n} name={n} status={statusOf(n)} deployment={(deployment as Partial<Record<KeyName, boolean>>)[n]} disabled={disabled} onSaved={setKey(n)} onModels={(m) => setModels((x) => ({ ...x, [n]: m }))}>
      {children}
    </KeyCard>
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Keys and AI" description="Bring your own keys. They are stored encrypted on the server, used only for this workspace, and never shown again after saving." />
      {disabled && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <ServerCog className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          {res.reason === 'local'
            ? 'Keys need an online workspace: this one lives in this browser only. The forms below show what you can add.'
            : "Key storage comes with the server update. Until then the deployment's own keys are used, and the forms below show what you can add."}
        </p>
      )}
      <section aria-labelledby="ai-heading" className="space-y-3">
        <h2 id="ai-heading" className="font-heading text-xl font-semibold">
          AI providers
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">{AI_PROVIDERS.map((p) => card(p))}</div>
        <AiRouting key={JSON.stringify(ai)} settings={ai} keys={keys} deployment={deployment} models={models} disabled={disabled} onSaved={(s) => setLocal({ keys, ai: s })} />
      </section>
      <section aria-labelledby="alerts-heading" className="space-y-3">
        <h2 id="alerts-heading" className="font-heading text-xl font-semibold">
          Alerts and maps
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {card('telegram', <TelegramConnect disabled={disabled} ready={Boolean(statusOf('telegram')?.set)} />)}
          {card('google_maps')}
        </div>
      </section>
      <section aria-labelledby="control-heading" className="space-y-3">
        <h2 id="control-heading" className="font-heading text-xl font-semibold">
          Devices and control systems
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {card('shelly_cloud')}
          {card('home_assistant')}
          {card('command_webhook')}
        </div>
      </section>
    </div>
  )
}
