// The immersive 3D twin, loaded on demand so other pages never download three.js.
// Contract: <Building3DView rooms onSelect /> fills its parent; pages import only from '@/ui/3d'.
// A small parent (under 420 x 380 px) gets the mini view: a click on a room calls onSelect, and a link opens /building.

import { createElement, lazy, Suspense } from 'react'
import type { RoomState } from '@/shared/types'

const View = lazy(() => import('./Building3DView'))

export function Building3DView(props: { rooms: Record<string, RoomState>; onSelect?: (id: string) => void }) {
  return createElement(
    Suspense,
    { fallback: createElement('div', { className: 'h-full min-h-48 w-full animate-pulse rounded-xl bg-muted', role: 'status', 'aria-label': 'Loading the 3D model' }) },
    createElement(View, props),
  )
}
