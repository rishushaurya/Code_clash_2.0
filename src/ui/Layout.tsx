// App shell for the twin screens: sidebar (icons only when collapsed), a top bar with the live status, alerts,
// search and the Assistant, a tab bar on phones, and the command palette. Mounting it starts the twin in this tab.

import { Bell, Bot, ChevronsUpDown, CircleDashed, Copy, LogOut, Menu, Moon, QrCode, Radio, Search, Smartphone, Sun, UsersRound, Wifi, WifiOff } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Fragment, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSite } from '@/shared/site'
import { joinLink, online, publicLink, SESSION, signOut } from '@/shared/workspace'
import { useRealtime } from '@/twin/realtime'
import { useTwin } from '@/twin/store'
import { AssistantPanel } from '@/ui/assistant'
import './alerts'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/states'
import { ago, freshness, lastInputAt } from './live'
import { NAV, pageOf } from './nav'

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

/** Re-render every few seconds so "12 s ago" stays true */
function useNow(everyMs = 5000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

function IconTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Time of the newest camera or sensor reading, and whether the live channel is up. Text and icon, never colour alone. */
function LiveStatus() {
  const now = useNow()
  const readings = useTwin((s) => s.readings)
  const sensors = useTwin((s) => s.sensors)
  const realtime = useRealtime((s) => s.status)
  const autoOff = useSite((s) => s.site.autoOff)
  const f = freshness(lastInputAt(Object.values(readings), Object.values(sensors)), now)
  const channel = realtime === 'online' ? 'Connected to phones, cameras and sensors over the internet.' : realtime === 'local' ? 'Local only: cameras in tabs of this browser.' : `Live channel ${realtime}.`
  const Icon = realtime === 'offline' ? WifiOff : f.kind === 'none' ? CircleDashed : realtime === 'local' ? Radio : Wifi
  const text = f.kind === 'none' ? 'No live input' : f.kind === 'live' ? `Live, ${ago(f.ageS)}` : f.kind === 'recent' ? `Last reading ${ago(f.ageS)}` : `Stale, ${ago(f.ageS)}`
  const tone = realtime === 'offline' || f.kind === 'stale' ? 'text-waste' : f.kind === 'live' ? 'text-occupied' : f.kind === 'recent' ? 'text-warn' : 'text-muted-foreground'
  return (
    <IconTip label={`${channel}${autoOff.enabled ? ` Automatic switch-off after ${autoOff.minutes} min is on.` : ''}`}>
      <span role="status" tabIndex={0} className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', tone)}>
        <Icon className="size-3.5" aria-hidden />
        <span className="num hidden sm:inline">{text}</span>
        <span className="sr-only sm:hidden">{text}</span>
      </span>
    </IconTip>
  )
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const live = publicLink()
  const invite = joinLink('/')
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Link copied')).catch(() => toast.error('Clipboard is blocked'))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceMenu({ onInvite }: { onInvite: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-44 gap-1.5" aria-label={`Workspace ${SESSION?.name ?? ''}`}>
          <UsersRound aria-hidden /> <span className="hidden truncate xl:inline">{SESSION?.name}</span>
          <ChevronsUpDown className="hidden opacity-60 xl:inline" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate">{SESSION?.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{online() ? 'Online workspace' : 'This browser only'}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onInvite}>
          <QrCode aria-hidden /> Invite a device, public view code
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/live">
            <Smartphone aria-hidden /> Open the public view
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings/team">
            <UsersRound aria-hidden /> Team and access
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={signOut}>
          <LogOut aria-hidden /> Sign out of this workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AppSidebar() {
  const { pathname } = useLocation()
  const site = useSite((s) => s.site)
  const alerts = useTwin((s) => s.alerts.length)
  const { setOpenMobile } = useSidebar()
  const current = pageOf(pathname)
  return (
    <Sidebar collapsible="icon" className="no-print">
      <SidebarHeader>
        <Link to="/" className="flex h-10 items-center gap-2 overflow-hidden rounded-md px-1.5" onClick={() => setOpenMobile(false)}>
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-highlight font-heading text-sm font-semibold text-[var(--on-highlight)]" aria-hidden>
            P
          </span>
          <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-heading text-lg font-semibold text-highlight">Pratibimb</span>
            <span className="truncate text-xs text-muted-foreground">{site.buildingName || 'New site'}</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.pages.map((p) => {
                  const active = current?.to === p.to
                  return (
                    <SidebarMenuItem key={p.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={p.label} className="data-active:text-highlight">
                        <NavLink to={p.to} end onClick={() => setOpenMobile(false)} aria-current={active ? 'page' : undefined}>
                          <p.icon aria-hidden />
                          <span>{p.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {p.to === '/alerts' && alerts > 0 && (
                        <SidebarMenuBadge className="num bg-waste/15 text-waste" aria-label={`${alerts} open alerts`}>
                          {alerts}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Public view">
              <Link to="/live">
                <Smartphone aria-hidden />
                <span>Public view</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Building > page > detail; only the last part on phones */
function Crumbs() {
  const { pathname } = useLocation()
  const building = useSite((s) => s.site.buildingName) || 'New site'
  const page = pageOf(pathname)
  const roomId = pathname.startsWith('/room/') ? decodeURIComponent(pathname.slice(6)) : null
  const roomName = useSite((s) => (roomId ? s.site.rooms.find((r) => r.id === roomId)?.name : undefined))
  const group = NAV.find((g) => g.pages.includes(page!))?.group
  const parts: { label: string; to?: string }[] = [{ label: building, to: '/' }]
  if (group === 'Settings') parts.push({ label: 'Settings' })
  if (pathname === '/connections/doctor') parts.push({ label: 'Connections', to: '/connections' })
  if (page && page.to !== '/') parts.push({ label: page.label, to: roomId ? page.to : undefined })
  if (roomId) parts.push({ label: roomName ? `${roomId}, ${roomName}` : roomId })
  if (parts.length === 1) parts[0] = { label: building }
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {parts.map((p, i) => {
          const last = i === parts.length - 1
          return (
            <Fragment key={`${p.label}-${i}`}>
              <BreadcrumbItem className={cn('min-w-0', !last && 'hidden md:inline-flex')}>
                {last ? (
                  <BreadcrumbPage className="truncate font-medium">{p.label}</BreadcrumbPage>
                ) : p.to ? (
                  <BreadcrumbLink asChild className="truncate">
                    <Link to={p.to}>{p.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <span className="truncate">{p.label}</span>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator className="hidden md:inline-flex" />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

const TABS = ['/', '/rooms', '/alerts', '/camera']

/** Phones: the four most used pages plus More, which opens the full menu */
function TabBar() {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const alerts = useTwin((s) => s.alerts.length)
  const current = pageOf(pathname)
  const pages = NAV.flatMap((g) => g.pages).filter((p) => TABS.includes(p.to))
  return (
    <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {pages.map((p) => {
        const active = current?.to === p.to
        return (
          <Link
            key={p.to}
            to={p.to}
            aria-current={active ? 'page' : undefined}
            className={cn('relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-highlight' : 'text-muted-foreground')}
          >
            <p.icon className="size-5" aria-hidden />
            {p.label}
            {p.to === '/alerts' && alerts > 0 && (
              <span className="num absolute top-1.5 left-1/2 ml-1.5 rounded-full bg-waste px-1.5 text-[10px] leading-4 text-white" aria-label={`${alerts} open`}>
                {alerts}
              </span>
            )}
          </Link>
        )
      })}
      <button type="button" onClick={() => setOpenMobile(true)} className="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground">
        <Menu className="size-5" aria-hidden />
        More
      </button>
    </nav>
  )
}

function readSidebarDefault() {
  const saved = document.cookie.match(/sidebar_state=(true|false)/)?.[1]
  return saved ? saved === 'true' : window.innerWidth >= 1280
}

export function Layout() {
  const start = useTwin((s) => s.start)
  const alerts = useTwin((s) => s.alerts.length)
  const [dark, setDark] = useTheme()
  const [assistant, setAssistant] = useState(false)
  const [palette, setPalette] = useState(false)
  const [invite, setInvite] = useState(false)
  const [params] = useSearchParams()
  const { pathname } = useLocation()

  useEffect(start, [start])

  // The 3D view in full screen (lobby display): no chrome at all.
  if (pathname === '/building' && params.get('fs') === '1')
    return (
      <ErrorBoundary label="the 3D view">
        <Outlet />
      </ErrorBoundary>
    )

  return (
    <SidebarProvider defaultOpen={readSidebarDefault()}>
      <a href="#main" className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-4">
          <SidebarTrigger className="hidden md:inline-flex" aria-label="Collapse or expand the menu" />
          <div className="min-w-0 flex-1">
            <Crumbs />
          </div>
          <LiveStatus />
          <IconTip label="Search rooms, pages and actions (Ctrl+K)">
            <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={() => setPalette(true)} aria-label="Search (Ctrl+K)">
              <Search aria-hidden />
              <kbd className="hidden rounded border bg-muted px-1 font-mono text-[10px] lg:inline">Ctrl K</kbd>
            </Button>
          </IconTip>
          <IconTip label={alerts ? `${alerts} open alerts` : 'No open alerts'}>
            <Button variant="ghost" size="icon" asChild className="relative" aria-label={alerts ? `Alerts, ${alerts} open` : 'Alerts, none open'}>
              <Link to="/alerts">
                <Bell aria-hidden />
                {alerts > 0 && (
                  <span className="num absolute top-0.5 right-0.5 min-w-4 rounded-full bg-waste px-1 text-center text-[10px] leading-4 text-white" aria-hidden>
                    {alerts}
                  </span>
                )}
              </Link>
            </Button>
          </IconTip>
          <Button size="sm" onClick={() => setAssistant(true)} className="gap-1.5" aria-label="Open the Assistant">
            <Bot aria-hidden /> <span className="hidden lg:inline">Assistant</span>
          </Button>
          <WorkspaceMenu onInvite={() => setInvite(true)} />
          <IconTip label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
            <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} className="hidden sm:inline-flex">
              {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </Button>
          </IconTip>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 p-4 pb-24 outline-none md:p-6 md:pb-8">
          <ErrorBoundary label="this page">
            <Outlet />
          </ErrorBoundary>
        </main>
        <footer className="no-print mx-auto hidden w-full max-w-[1600px] px-6 pb-6 text-xs text-muted-foreground md:block">
          Pratibimb by Team Barfi · Weather and air quality by Open-Meteo (CC BY 4.0) · Video never leaves the device
        </footer>
      </SidebarInset>
      <TabBar />
      <Sheet open={assistant} onOpenChange={setAssistant}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <Bot className="size-4 text-highlight" aria-hidden /> Assistant
            </SheetTitle>
            <SheetDescription>Asks this building's live data. It never changes anything without your approval.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ErrorBoundary label="the Assistant">
              <AssistantPanel />
            </ErrorBoundary>
          </div>
        </SheetContent>
      </Sheet>
      <CommandPalette open={palette} onOpenChange={setPalette} onAssistant={() => setAssistant(true)} onTheme={() => setDark(!dark)} onInvite={() => setInvite(true)} />
      <InviteDialog open={invite} onOpenChange={setInvite} />
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" mobileOffset={{ bottom: 72 }} />
    </SidebarProvider>
  )
}
