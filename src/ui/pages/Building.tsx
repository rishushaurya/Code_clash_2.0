// /building  The 3D twin at full height. ?fs=1 drops every bar for a lobby screen; the browser's full screen hides the rest.

import { lazy, Suspense } from 'react'
import { Box, Maximize, Minimize2 } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { isConfigured, useSite } from '@/shared/site'
import { useTwin } from '@/twin/store'
import { EmptyState, PanelSkeleton } from '../components/states'

const Building3DView = lazy(() => import('@/ui/3d').then((m) => ({ default: m.Building3DView })))

export default function Building() {
  const site = useSite((s) => s.site)
  const rooms = useTwin((s) => s.rooms)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const fs = params.get('fs') === '1'

  if (!isConfigured(site))
    return (
      <Card>
        <CardContent>
          <EmptyState icon={Box} title="No building to show yet">
            <p className="text-sm">Add rooms in site settings and the 3D model builds itself from them.</p>
            <Button asChild className="mt-2">
              <Link to="/settings/site">Set up the building</Link>
            </Button>
          </EmptyState>
        </CardContent>
      </Card>
    )

  const enterFullScreen = () => {
    navigate('/building?fs=1')
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }
  const leave = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    navigate('/building')
  }

  return (
    <div className={fs ? 'fixed inset-0 bg-background' : 'flex h-[calc(100dvh-9.5rem)] min-h-[420px] flex-col gap-3 md:h-[calc(100dvh-7.5rem)]'}>
      {!fs && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-semibold">Building 3D</h1>
          <Button variant="outline" size="sm" onClick={enterFullScreen}>
            <Maximize aria-hidden /> Full screen
          </Button>
        </div>
      )}
      <div className={fs ? 'size-full' : 'min-h-0 flex-1 overflow-hidden rounded-xl border bg-card'}>
        <Suspense fallback={<PanelSkeleton rows={8} />}>
          <Building3DView rooms={rooms} onSelect={fs ? undefined : (id: string) => navigate(`/room/${id}`)} />
        </Suspense>
      </div>
      {fs && (
        <Button variant="secondary" size="sm" className="fixed top-3 right-3 z-10 shadow-md" onClick={leave}>
          <Minimize2 aria-hidden /> Leave full screen
        </Button>
      )}
      {fs && <h1 className="sr-only">{site.buildingName || 'Building'} in 3D</h1>}
    </div>
  )
}
