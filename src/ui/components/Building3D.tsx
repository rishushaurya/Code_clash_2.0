// Every floor of the site stacked in 3D with CSS transforms: the same live floor plans, tilted and lifted.
// seniordev: CSS 3D, not three.js; a photoreal scan would need a splat renderer and a day of work.

import { useSite } from '@/shared/site'
import type { RoomState } from '@/shared/types'
import { FloorPlan } from './FloorPlan'

export function Building3D({ rooms, onSelect }: { rooms: Record<string, RoomState>; onSelect?: (id: string) => void }) {
  const site = useSite((s) => s.site)
  const floors = [...site.floors].sort((a, b) => b.level - a.level)
  const lift = Math.min(190, 420 / Math.max(1, floors.length - 1))
  return (
    <div className="relative mx-auto h-[min(70vw,560px)] max-w-4xl overflow-hidden [perspective:1600px]" aria-label={`3D view of ${site.buildingName || 'the building'}, all floors`}>
      <div className="absolute inset-x-[18%] top-[40%] [transform-style:preserve-3d] [transform:rotateX(56deg)_rotateZ(-30deg)_scale(0.82)]">
        {floors.map((f) => (
          <div
            key={f.level}
            className="absolute inset-x-0 top-0 rounded-xl border bg-card/80 shadow-[0_30px_40px_-20px_rgb(0_0_0/0.6)]"
            style={{ transform: `translateZ(${f.level * lift}px)` }}
          >
            <span className="absolute -left-2 -top-7 rounded bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">{f.building ? `${f.building} · ${f.name}` : f.name}</span>
            <FloorPlan plan={site.rooms} floor={f.level} floorName={f.name} rooms={rooms} onSelect={onSelect} compact />
          </div>
        ))}
      </div>
    </div>
  )
}
