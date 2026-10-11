// One status vocabulary for the whole app: colour plus icon plus text (DESIGN_SYSTEM section 3).

import { CircleDashed, FlaskConical, Gauge, Hand, Moon, ScanEye, Users, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RoomState, RoomStatus } from '@/shared/types'

export const STATUS: Record<RoomStatus, { label: string; icon: LucideIcon; text: string; bg: string; fill: string }> = {
  occupied: { label: 'Occupied', icon: Users, text: 'text-occupied', bg: 'bg-occupied/15', fill: 'var(--status-occupied)' },
  idle: { label: 'Empty, off', icon: Moon, text: 'text-idle', bg: 'bg-idle/15', fill: 'var(--status-idle)' },
  waste: { label: 'Empty, wasting', icon: Zap, text: 'text-waste', bg: 'bg-waste/15', fill: 'var(--status-waste)' },
  unknown: { label: 'No data', icon: CircleDashed, text: 'text-muted-foreground', bg: 'bg-muted', fill: 'var(--text-muted)' },
}

export function StatusBadge({ status, className }: { status: RoomStatus; className?: string }) {
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', s.text, s.bg, className)}>
      <s.icon className="size-3.5" aria-hidden />
      {s.label}
    </span>
  )
}

export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border border-dashed border-simulated px-2 py-0.5 text-xs text-simulated', className)}
      title="Modelled from your rooms and assumptions, not measured"
    >
      <FlaskConical className="size-3.5" aria-hidden />
      Modelled
    </span>
  )
}

const SOURCE: Record<RoomState['sources'][number], { label: string; icon: LucideIcon; title: string }> = {
  camera: { label: 'Camera', icon: ScanEye, title: 'Live from a camera' },
  sensor: { label: 'Sensor', icon: Gauge, title: 'From a connected sensor, meter or building system' },
  manual: { label: 'Staff report', icon: Hand, title: 'Reported by a person in the room' },
}

/** Where this room's numbers come from right now */
export function SourceBadges({ sources, className }: { sources: RoomState['sources']; className?: string }) {
  if (!sources.length) return null
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {sources.map((k) => {
        const s = SOURCE[k]
        return (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-highlight/15 px-2 py-0.5 text-xs text-highlight" title={s.title}>
            <s.icon className="size-3.5" aria-hidden />
            {s.label}
          </span>
        )
      })}
    </span>
  )
}
