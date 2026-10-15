// Every page of the app, grouped as in the sidebar. The sidebar, the phone tab bar, the command palette and
// the breadcrumbs all read this list, so a page is added in one place. Paths: docs/PLAN.md, Gate 1 Pages table.

import { useEffect } from 'react'
import { useLocation } from 'react-router'
import {
  Bell,
  Box,
  Building2,
  Camera,
  DoorOpen,
  FileText,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  LineChart,
  Plug,
  Stethoscope,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'

export interface Page {
  to: string
  label: string
  icon: LucideIcon
  /** Extra words the command palette matches */
  keywords?: string
}

export const NAV: { group: string; pages: Page[] }[] = [
  {
    group: 'Monitor',
    pages: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, keywords: 'home dashboard health' },
      { to: '/building', label: 'Building 3D', icon: Box, keywords: 'twin model floors' },
      { to: '/rooms', label: 'Rooms', icon: DoorOpen, keywords: 'spaces list' },
      { to: '/alerts', label: 'Alerts', icon: Bell, keywords: 'waste problems' },
    ],
  },
  {
    group: 'Analyse',
    pages: [
      { to: '/lab', label: 'Scenario Lab', icon: FlaskConical, keywords: 'what if simulation payback solar' },
      { to: '/reports', label: 'Reports', icon: FileText, keywords: 'audit pdf activity log naac' },
      { to: '/trends', label: 'Trends', icon: LineChart, keywords: 'history day week month' },
    ],
  },
  {
    group: 'Connect',
    pages: [
      { to: '/camera', label: 'Cameras', icon: Camera, keywords: 'webcam phone cctv' },
      { to: '/connections', label: 'Connections', icon: Plug, keywords: 'devices integrations telegram plugs home assistant relay webhook sensor' },
      { to: '/connections/doctor', label: 'Connection doctor', icon: Stethoscope, keywords: 'check test diagnose' },
    ],
  },
  {
    group: 'Settings',
    pages: [
      { to: '/settings/site', label: 'Site', icon: Building2, keywords: 'setup building rooms floors tariff hours' },
      { to: '/settings/keys', label: 'Keys and AI', icon: KeyRound, keywords: 'api key groq gemini openai anthropic openrouter telegram maps' },
      { to: '/settings/team', label: 'Team', icon: UsersRound, keywords: 'members roles invite password sessions' },
    ],
  },
]

export const PAGES = NAV.flatMap((g) => g.pages)

/** The page a path belongs to: the longest matching prefix, so /room/LH-1 falls under Rooms */
export function pageOf(pathname: string): Page | undefined {
  if (pathname.startsWith('/room/')) return PAGES.find((p) => p.to === '/rooms')
  return [...PAGES].sort((a, b) => b.to.length - a.to.length).find((p) => (p.to === '/' ? pathname === '/' : pathname === p.to || pathname.startsWith(`${p.to}/`)))
}

/** Scroll to and focus the element named by the URL hash (#rooms, #telegram) once the page has rendered it */
export function useScrollToHash(ready = true) {
  const { hash } = useLocation()
  useEffect(() => {
    if (!ready || !hash) return
    const el = document.getElementById(decodeURIComponent(hash.slice(1)))
    if (!el) return
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }, [hash, ready])
}
