// /connections  Every way data comes in and commands go out, each with its state and the place it is set up.

import { ArrowRight, Cable, Camera, Copy, Gauge, Home, MessageCircle, Plug, Server, Stethoscope, Webhook, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { syncCameras, useCameras } from '@/cv/cameras'
import { connectRelay, useRelay } from '@/relay/webSerial'
import { useSite } from '@/shared/site'
import type { KeyName } from '@/shared/types'
import { apiFetch, online, SESSION } from '@/shared/workspace'
import { useTwin } from '@/twin/store'
import { useApi, type KeysResponse, type ServerStatus } from '../api'
import { DeviceMapping } from '../components/DeviceMapping'
import { PageHeader } from '../components/states'
import { StatusLight, type Light } from '../components/status'

const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`)).catch(() => toast.error('Clipboard is blocked'))

function Secret({ id, label, value, what }: { id: string; label: string; value: string; what: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} className="num text-xs" value={value} readOnly type="password" />
        <Button size="icon" variant="outline" aria-label={`Copy the ${what.toLowerCase()}`} onClick={() => copy(value, what)}>
          <Copy aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function Connection({ icon: Icon, title, description, light, state, children, action }: { icon: LucideIcon; title: string; description: string; light: Light; state: string; children?: React.ReactNode; action: React.ReactNode }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-8 place-items-center rounded-lg bg-highlight/10 text-highlight">
            <Icon className="size-4" aria-hidden />
          </span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <StatusLight light={light} label={state} />
        </CardAction>
      </CardHeader>
      {children && <CardContent className="space-y-3 text-sm">{children}</CardContent>}
      {action && <CardFooter className="mt-auto justify-end gap-2">{action}</CardFooter>}
    </Card>
  )
}

function SetUp({ to, label = 'Set up' }: { to: string; label?: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={to}>
        {label} <ArrowRight aria-hidden />
      </Link>
    </Button>
  )
}

export default function Connections() {
  const [status] = useApi<ServerStatus>('/api/status')
  const [keys] = useApi<KeysResponse>('/api/keys')
  const cameras = useCameras((c) => Object.keys(c.cameras).length)
  const readings = Object.values(useTwin((s) => s.readings))
  const sensorRooms = useTwin((s) => Object.keys(s.sensors).length)
  const relay = useRelay((s) => s.status)
  const relayRooms = useSite((s) => s.site.rooms.filter((r) => r.hasRealRelay).length)
  const chatId = useSite((s) => s.site.telegramChatId)
  const [sensorKey, setSensorKey] = useState('')
  const [now] = useState(Date.now)

  useEffect(() => {
    void syncCameras()
    if (!online()) return
    apiFetch('/api/workspace')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((w: { ingestKey: string }) => setSensorKey(w.ingestKey))
      .catch(() => undefined)
  }, [])

  const s = status.state === 'ok' ? status.data : null
  const keyList = keys.state === 'ok' ? keys.data.keys : null
  /** From the stored key's last test; falls back to the deployment's own setting where there is one */
  const keyLight = (name: KeyName, deployment?: boolean): [Light, string] => {
    const k = keyList?.find((x) => x.name === name)
    if (k?.set) return k.ok === false ? ['warn', 'Last test failed'] : k.ok ? ['ok', 'Working'] : ['ok', 'Saved, not tested']
    if (deployment) return ['ok', "Using the deployment's"]
    if (keys.state === 'loading' || status.state === 'loading') return ['unknown', 'Checking']
    return ['off', 'Not set up']
  }
  const liveCams = readings.filter((r) => now - r.ts < 60_000)
  const edge = readings.some((r) => r.sourceKind === 'python_edge')

  // The deployment's bot only reaches this workspace once its chat id is in site settings.
  const telegram: [Light, string] =
    keyList?.find((x) => x.name === 'telegram')?.set || !s?.telegram ? keyLight('telegram') : chatId ? ['ok', "Deployment's bot, chat linked"] : ['off', 'No chat linked yet']
  const shelly = keyLight('shelly_cloud')
  const ha = keyLight('home_assistant')
  const webhook = keyLight('command_webhook', s?.commandWebhook)

  return (
    <div className="space-y-4">
      <PageHeader title="Connections" description="How readings reach the twin and how its commands reach your building. Keys are stored encrypted on the server and never shown again.">
        <Button asChild variant="outline" size="sm">
          <Link to="/connections/doctor">
            <Stethoscope aria-hidden /> Run the connection doctor
          </Link>
        </Button>
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <Connection
          icon={Camera}
          title="Cameras"
          description="Phones, webcams and CCTV count people and see lights and fans. Only numbers leave the camera."
          light={liveCams.length ? 'ok' : cameras ? 'warn' : 'off'}
          state={liveCams.length ? `${liveCams.length} live` : cameras ? `${cameras} saved, none live` : 'None yet'}
          action={<SetUp to="/camera" label={cameras ? 'Open cameras' : 'Add a camera'} />}
        />
        <Connection
          icon={Gauge}
          title="Sensor API"
          description="Smart meters, motion and CO2 sensors or your building system post readings to /api/ingest."
          light={sensorRooms ? 'ok' : s?.ingest ? 'off' : s ? 'warn' : 'unknown'}
          state={sensorRooms ? `${sensorRooms} rooms reporting` : s?.ingest ? 'Ready, nothing received' : s ? 'Needs an online workspace' : 'Checking'}
          action={null}
        >
          {sensorKey ? (
            <>
              <Secret id="sensor-key" label="Sensor key (send as the x-api-key header)" value={sensorKey} what="Sensor key" />
              <p className="text-xs text-muted-foreground">Examples for Home Assistant, Node-RED and curl are in docs/INTEGRATIONS.md. Keep the key private.</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">The sensor key appears here in an online workspace.</p>
          )}
        </Connection>
        <Connection
          icon={MessageCircle}
          title="Telegram"
          description="Alerts in your staff group with a Switch off button, and a weekly digest."
          light={telegram[0]}
          state={telegram[1]}
          action={<SetUp to="/settings/keys#telegram" />}
        />
        <Connection
          icon={Plug}
          title="Smart plugs"
          description="Shelly Cloud: read each plug's watts and switch it off from the twin."
          light={shelly[0]}
          state={shelly[1]}
          action={<SetUp to="/settings/keys#shelly_cloud" />}
        />
        <Connection icon={Home} title="Home Assistant" description="Your Home Assistant sends readings in and receives switch-off commands." light={ha[0]} state={ha[1]} action={<SetUp to="/settings/keys#home_assistant" />} />
        <Connection
          icon={Cable}
          title="USB relay"
          description="A relay board on this computer's USB port switches a room's lights (Chrome or Edge)."
          light={relay === 'connected' ? 'ok' : relay === 'unsupported' ? 'warn' : 'off'}
          state={relay === 'connected' ? 'Connected' : relay === 'unsupported' ? 'Browser has no Web Serial' : 'Not connected'}
          action={
            <Button size="sm" variant="outline" disabled={relay !== 'disconnected'} onClick={() => connectRelay().catch(() => toast.error('No relay selected'))}>
              Connect the relay
            </Button>
          }
        >
          <p className="text-xs text-muted-foreground">
            {relayRooms ? `${relayRooms} ${relayRooms === 1 ? 'room is' : 'rooms are'} marked as switched by the relay.` : 'Mark the room it switches in site settings, Rooms, "USB relay".'}
          </p>
        </Connection>
        <Connection
          icon={Webhook}
          title="Command webhook"
          description="Any control system: the twin posts signed switch-off commands to your URL."
          light={webhook[0]}
          state={webhook[1]}
          action={<SetUp to="/settings/keys#command_webhook" />}
        />
        <Connection
          icon={Server}
          title="CCTV edge worker"
          description="A small Python worker beside your recorder counts people on CCTV streams and sends only numbers."
          light={edge ? 'ok' : 'off'}
          state={edge ? 'Reporting' : 'Not running'}
          action={null}
        >
          {SESSION?.channel ? <Secret id="edge-channel" label="Live channel (PRATIBIMB_CHANNEL for edge/edge.py)" value={SESSION.channel} what="Channel" /> : null}
        </Connection>
      </div>
      <DeviceMapping />
    </div>
  )
}
