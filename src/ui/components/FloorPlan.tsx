// Floor plan in plain SVG: sharp on a projector, nothing to break. Works for any site's layout.
// Rooms are coloured by status, waste rooms are hatched and pulse, rooms without data are dashed,
// and every room is keyboard reachable.

import type { Room, RoomState } from '@/shared/types'
import { STATUS } from './status'

type PlanRoom = Pick<Room, 'id' | 'name' | 'floor' | 'polygon'>

interface Props {
  plan: PlanRoom[]
  floor: number
  floorName?: string
  rooms: Record<string, RoomState>
  onSelect?: (roomId: string) => void
  compact?: boolean
}

export function FloorPlan({ plan, floor, floorName, rooms, onSelect, compact }: Props) {
  const list = plan.filter((r) => r.floor === floor && r.polygon)
  return (
    <svg viewBox="0 0 1000 600" className="h-auto w-full" role="group" aria-label={`Floor plan${floorName ? `, ${floorName}` : ''}`}>
      <defs>
        <pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="14" stroke="var(--status-waste)" strokeWidth="4" strokeOpacity="0.45" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="1000" height="600" rx="16" fill="var(--surface-2)" opacity="0.5" />
      {list.map((room) => {
        const s = rooms[room.id]
        const status = s?.status ?? 'unknown'
        const meta = STATUS[status]
        const xs = room.polygon!.map((p) => p[0])
        const ys = room.polygon!.map((p) => p[1])
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        const cx = (x0 + x1) / 2
        // Shrink text in small rooms so labels never spill out.
        const k = Math.min(1, (x1 - x0) / 240, (y1 - y0) / 150)
        const points = room.polygon!.map((p) => p.join(',')).join(' ')
        const label = `${room.id}, ${meta.label}${s?.occupancyKnown ? `, ${s.headcount} people` : ''}, ${Math.round(s?.watts ?? 0)} watts`
        return (
          <g
            key={room.id}
            role={onSelect ? 'button' : 'img'}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={label}
            className={onSelect ? 'cursor-pointer outline-none focus-visible:[&>polygon]:stroke-[var(--highlight)]' : undefined}
            onClick={() => onSelect?.(room.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(room.id)}
          >
            <title>{label}</title>
            <polygon
              points={points}
              fill={meta.fill}
              fillOpacity={status === 'idle' || status === 'unknown' ? 0.12 : 0.28}
              stroke={meta.fill}
              strokeWidth={status === 'waste' ? 5 : 2}
              strokeDasharray={status === 'unknown' ? '8 6' : undefined}
              strokeLinejoin="round"
              className={status === 'waste' ? 'waste-pulse' : undefined}
              style={{ transition: 'fill 250ms ease-out, stroke 250ms ease-out' }}
            />
            {status === 'waste' && <polygon points={points} fill="url(#hatch)" pointerEvents="none" />}
            <text
              x={cx}
              y={y0 + (compact ? 60 : 46) * k}
              textAnchor="middle"
              fontSize={(compact ? 34 : 26) * k}
              className={compact ? undefined : 'max-sm:text-[42px]'}
              fontWeight="600"
              fill="var(--text)"
              fontFamily="JetBrains Mono, monospace"
            >
              {room.id}
            </text>
            {!compact && (
              // On a phone the plan is too small for details; the id and colour stay, a tap opens the room.
              <g className="max-sm:hidden">
                <text x={cx} y={y0 + 74 * k} textAnchor="middle" fontSize={15 * k} fill="var(--text-muted)">
                  {room.name}
                </text>
                <text x={cx} y={(y0 + y1) / 2 + 26 * k} textAnchor="middle" fontSize={20 * k} fill="var(--text)" fontFamily="JetBrains Mono, monospace">
                  {!s || !s.occupancyKnown ? (s?.watts ? `${Math.round(s.watts)} W` : '') : `${s.headcount} ppl · ${Math.round(s.watts)} W`}
                </text>
                <text x={cx} y={(y0 + y1) / 2 + 52 * k} textAnchor="middle" fontSize={16 * k} fill={meta.fill} fontWeight="600">
                  {meta.label}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
