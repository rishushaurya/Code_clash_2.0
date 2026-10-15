import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useStation } from '@/cv/station'
import { PUBLIC_LINK, SESSION } from '@/shared/workspace'
import { ErrorBoundary, NotFound, PanelSkeleton } from '@/ui/components/states'
import { Layout } from '@/ui/Layout'
import Overview from '@/ui/pages/Overview'
import { JoinPage, WorkspaceGate } from '@/ui/pages/Workspace'

// Heavy screens load on demand: the camera station brings MediaPipe, the lab and report bring the engine's charts.
const RoomDetail = lazy(() => import('@/ui/pages/RoomDetail'))
const ScenarioLab = lazy(() => import('@/ui/pages/ScenarioLab'))
const Reports = lazy(() => import('@/ui/pages/Reports'))
const JudgeView = lazy(() => import('@/ui/pages/JudgeView'))
const CameraStation = lazy(() => import('@/cv/CameraStation'))
const SiteSettings = lazy(() => import('@/ui/pages/SiteSettings'))
const KeysSettings = lazy(() => import('@/ui/pages/KeysSettings'))
const Team = lazy(() => import('@/ui/pages/Team'))
const Building = lazy(() => import('@/ui/pages/Building'))
const Rooms = lazy(() => import('@/ui/pages/Rooms'))
const Alerts = lazy(() => import('@/ui/pages/Alerts'))
const Trends = lazy(() => import('@/ui/pages/Trends'))
const Connections = lazy(() => import('@/ui/pages/Connections'))
const Doctor = lazy(() => import('@/ui/pages/Doctor'))

const page = (el: React.ReactNode, label: string) => (
  <ErrorBoundary label={label}>
    <Suspense fallback={<div className="p-4"><PanelSkeleton rows={6} /></div>}>{el}</Suspense>
  </ErrorBoundary>
)

/** The camera station lives outside the routes, so its cameras keep running on every page of this tab. */
function StationHost() {
  const { pathname } = useLocation()
  const visible = pathname.startsWith('/camera')
  const running = useStation((s) => s.feeds.length > 0)
  if (!visible && !running) return null
  return (
    <ErrorBoundary label="the cameras">
      <Suspense fallback={visible ? <div className="p-4"><PanelSkeleton rows={6} /></div> : null}>
        <CameraStation visible={visible} />
      </Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  // The public view needs no sign-in: its link carries the workspace's public key.
  if (!SESSION && location.pathname.startsWith('/live') && PUBLIC_LINK) return <BrowserRouter>{page(<JudgeView />, 'the public view')}</BrowserRouter>
  if (location.pathname.startsWith('/join')) return <JoinPage />
  if (!SESSION) return <WorkspaceGate />
  return (
    <TooltipProvider delayDuration={200}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="building" element={page(<Building />, 'the 3D view')} />
            <Route path="rooms" element={page(<Rooms />, 'the room list')} />
            <Route path="room/:id" element={page(<RoomDetail />, 'the room page')} />
            <Route path="alerts" element={page(<Alerts />, 'alerts')} />
            <Route path="lab" element={page(<ScenarioLab />, 'the Scenario Lab')} />
            <Route path="reports" element={page(<Reports />, 'the report')} />
            <Route path="trends" element={page(<Trends />, 'trends')} />
            <Route path="connections" element={page(<Connections />, 'connections')} />
            <Route path="connections/doctor" element={page(<Doctor />, 'the connection doctor')} />
            <Route path="settings/site" element={page(<SiteSettings />, 'site settings')} />
            <Route path="settings/keys" element={page(<KeysSettings />, 'keys and AI')} />
            <Route path="settings/team" element={page(<Team />, 'team')} />
            <Route path="settings" element={<Navigate to="/settings/site" replace />} />
            <Route path="setup" element={<Navigate to="/settings/site" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="live" element={page(<><JudgeView /><Toaster /></>, 'the public view')} />
          <Route path="camera/*" element={null} />
        </Routes>
        <StationHost />
      </BrowserRouter>
    </TooltipProvider>
  )
}
