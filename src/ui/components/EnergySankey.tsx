// Where every watt goes right now: device types split into useful load and waste (Recharts Sankey).

import { ResponsiveContainer, Sankey, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getRoom } from '@/shared/site'
import type { DeviceType, RoomState } from '@/shared/types'

const TYPE_LABEL: Record<DeviceType, string> = { light: 'Lights', fan: 'Fans', ac: 'AC', projector: 'Projectors', pc: 'PCs' }

export default function EnergySankey({ rooms }: { rooms: RoomState[] }) {
  const types = Object.keys(TYPE_LABEL) as DeviceType[]
  const used: Record<string, number> = {}
  const wasted: Record<string, number> = {}
  for (const s of rooms) {
    const room = getRoom(s.roomId)
    if (!room) continue
    for (const d of room.devices) {
      if (!s.deviceOn[d.id]) continue
      const bucket = s.status === 'waste' ? wasted : used
      bucket[d.type] = (bucket[d.type] ?? 0) + d.ratedW
    }
  }
  const active = types.filter((t) => (used[t] ?? 0) + (wasted[t] ?? 0) > 0)
  const nodes = [{ name: 'Building' }, ...active.map((t) => ({ name: TYPE_LABEL[t] })), { name: 'Occupied rooms' }, { name: 'Empty rooms (waste)' }]
  const usefulIndex = active.length + 1
  const links = active.flatMap((t, i) => [
    { source: 0, target: i + 1, value: (used[t] ?? 0) + (wasted[t] ?? 0) },
    ...(used[t] ? [{ source: i + 1, target: usefulIndex, value: used[t] }] : []),
    ...(wasted[t] ? [{ source: i + 1, target: usefulIndex + 1, value: wasted[t] }] : []),
  ])
  const totalWaste = Object.values(wasted).reduce((a, b) => a + b, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Where the power goes now</CardTitle>
      </CardHeader>
      <CardContent>
        {links.length < 2 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing is switched on.</p>
        ) : (
          <div className="h-64" role="img" aria-label={`Energy flow: ${Math.round(totalWaste)} watts are going to empty rooms`}>
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={{ nodes, links }}
                nodePadding={18}
                margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
                link={{ stroke: 'var(--highlight)', strokeOpacity: 0.25 }}
                node={({ x, y, width, height, payload }: { x: number; y: number; width: number; height: number; payload: { name: string; value: number; depth: number } }) => (
                  <g>
                    <rect x={x} y={y} width={width} height={height} fill={payload.name.startsWith('Empty') ? 'var(--status-waste)' : 'var(--highlight)'} />
                    <text
                      x={payload.depth === 2 ? x - 6 : x + width + 6}
                      textAnchor={payload.depth === 2 ? 'end' : 'start'}
                      y={y + height / 2}
                      dominantBaseline="middle"
                      fontSize={12}
                      fill="var(--text)"
                    >
                      {payload.name} · {Math.round(payload.value)} W
                    </text>
                  </g>
                )}
              >
                <Tooltip />
              </Sankey>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
