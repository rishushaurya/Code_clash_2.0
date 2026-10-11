// App shell for the twin screens: navigation, connection, relay, workspace menu, theme.
// Mounting it starts the twin in this tab.

import { Cable, Camera, Copy, FileText, FlaskConical, LayoutDashboard, LogOut, Moon, QrCode, Radio, Settings2, Smartphone, Sun, Users, Wifi, WifiOff } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { connectRelay, useRelay } from '@/relay/webSerial'
import { useSite } from '@/shared/site'
import { joinLink, online, publicLink, SESSION, signOut } from '@/shared/workspace'
import { toast } from 'sonner'
import { useRealtime } from '@/twin/realtime'
import { useTwin } from '@/twin/store'
import { ErrorBoundary } from './components/states'

const NAV = [
  { to: '/', label: 'Live twin', icon: LayoutDashboard },
  { to: '/lab', label: 'Scenario Lab', icon: FlaskConical },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/camera', label: 'Cameras', icon: Camera },
  { to: '/live', label: 'Public view', icon: Smartphone },
  { to: '/setup', label: 'Setup', icon: Settings2 },
]

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light')
    } catch {
      // Theme just will not persist.
    }
  }, [dark])
  return [dark, setDark] as const
}

function IconTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function WorkspaceMenu() {
  const live = publicLink()
  const invite = joinLink('/')
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Link copied')).catch(() => toast.error('Clipboard is blocked'))
  return (
    <Dialog>
      <IconTip label={`Workspace ${SESSION?.name}: invite a device, public view, sign out`}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-40 gap-1.5" aria-label="Workspace menu">
            <Users aria-hidden /> <span className="hidden truncate lg:inline">{SESSION?.name}</span>
          </Button>
        </DialogTrigger>
      </IconTip>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{SESSION?.name}</DialogTitle>
          <DialogDescription>
            {online()
              ? 'An online workspace: every device signed in to it shares its rooms, cameras, live data and reports.'
              : 'Kept in this browser only, because this server has no workspace storage. Tabs of this browser share it.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col items-center gap-2 rounded-lg border p-3 text-center">
            <p className="text-sm font-medium">Public view</p>
            <div className="rounded-md bg-white p-2">
              <QRCodeSVG value={live} size={150} level="L" aria-label="QR code for the public view" />
            </div>
            <p className="text-xs text-muted-foreground">Read-only, for notice boards and visitors.</p>
            <Button size="sm" variant="outline" onClick={() => copy(live)}>
              <Copy aria-hidden /> Copy link
            </Button>
          </div>
          {online() && (
            <div className="flex flex-col items-center gap-2 rounded-lg border p-3 text-center">
              <p className="text-sm font-medium">Sign in another device</p>
              <div className="rounded-md bg-white p-2">
                <QRCodeSVG value={invite} size={150} level="L" aria-label="QR code that signs another device in to this workspace" />
              </div>
              <p className="text-xs text-muted-foreground">Full access, like the password. Only for your team.</p>
              <Button size="sm" variant="outline" onClick={() => copy(invite)}>
                <Copy aria-hidden /> Copy link
              </Button>
            </div>
          )}
        </div>
        <Button variant="ghost" className="text-waste" onClick={signOut}>
          <LogOut aria-hidden /> Sign out of this workspace
        </Button>
      </DialogContent>
    </Dialog>
  )
}

export function Layout() {
  const start = useTwin((s) => s.start)
  const site = useSite((s) => s.site)
  const realtime = useRealtime((s) => s.status)
  const relay = useRelay((s) => s.status)
  const [dark, setDark] = useTheme()

  useEffect(start, [start])

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur no-print">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="font-heading text-xl font-semibold text-highlight">Pratibimb</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">{site.buildingName || 'New site'}</span>
          </NavLink>
          <nav aria-label="Main" className="order-last flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn('flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm hover:bg-accent', isActive && 'bg-accent font-medium text-highlight')
                }
              >
                <Icon className="size-4" aria-hidden /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {site.autoOff.enabled && (
              <IconTip label={`Rooms left empty with power on are switched off automatically after ${site.autoOff.minutes} minutes. Change it in Setup.`}>
                <Badge variant="outline" className="border-occupied text-occupied">
                  Auto-off
                </Badge>
              </IconTip>
            )}
            {site.emptyDelayS < 60 && (
              <IconTip label={`Rooms count as empty after ${site.emptyDelayS} seconds. Change it in Setup.`}>
                <Badge variant="outline" className="border-warn text-warn">
                  Fast empty delay
                </Badge>
              </IconTip>
            )}
            <IconTip label={realtime === 'online' ? 'Connected to phones and cameras over the internet' : realtime === 'local' ? 'This browser only: cameras in tabs of this browser' : `Realtime ${realtime}`}>
              <span className={cn('flex size-9 items-center justify-center', realtime === 'offline' ? 'text-waste' : realtime === 'online' ? 'text-occupied' : 'text-muted-foreground')}>
                {realtime === 'offline' ? <WifiOff className="size-4" aria-label="Realtime offline" /> : realtime === 'local' ? <Radio className="size-4" aria-label="Local realtime" /> : <Wifi className="size-4" aria-label="Realtime online" />}
              </span>
            </IconTip>
            <IconTip label={relay === 'connected' ? 'Relay board connected' : relay === 'unsupported' ? 'This browser has no Web Serial; use Chrome or Edge for a USB relay' : 'Connect the relay board over USB'}>
              <Button variant="ghost" size="icon" aria-label="Connect relay" disabled={relay !== 'disconnected'} onClick={() => connectRelay().catch(() => undefined)} className={relay === 'connected' ? 'text-occupied' : undefined}>
                <Cable aria-hidden />
              </Button>
            </IconTip>
            <WorkspaceMenu />
            <IconTip label="Public view and its QR code">
              <Button variant="ghost" size="icon" asChild aria-label="Open public view">
                <NavLink to="/live">
                  <QrCode aria-hidden />
                </NavLink>
              </Button>
            </IconTip>
            <IconTip label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
              <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">
                {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
              </Button>
            </IconTip>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1600px] p-4">
        <ErrorBoundary label="this page">
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="no-print mx-auto max-w-[1600px] px-4 pb-6 text-xs text-muted-foreground">
        Pratibimb by Team Barfi · Weather and air quality by Open-Meteo (CC BY 4.0) · Video never leaves the device
      </footer>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
    </div>
  )
}
