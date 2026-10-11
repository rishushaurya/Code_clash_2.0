// Energy League: floors ranked by money wasted per seat this session; lower is better.
// A shout-out, written by the AI from these numbers (or by code offline), turns the ranking into a nudge.
// Real-time feedback cut dorm electricity 55 % at Oberlin (Petersen et al.); friendly competition is the lever.

import { Megaphone, Trophy } from 'lucide-react'
import { useState } from 'react'
import { copilotAnswer } from '@/ai/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSite } from '@/shared/site'
import type { RoomState } from '@/shared/types'
import { formatMoney, round } from '@/twin/energy'

export function EnergyLeague({ rooms }: { rooms: RoomState[] }) {
  const site = useSite((s) => s.site)
  const [shout, setShout] = useState<{ text: string; ai: boolean } | 'loading' | null>(null)
  const rows = site.floors
    .map((f) => {
      const inFloor = site.rooms.filter((r) => r.floor === f.level)
      const seats = inFloor.reduce((a, r) => a + r.capacity, 0)
      const watched = rooms.filter((s) => s.sources.length && inFloor.some((r) => r.id === s.roomId))
      const waste = watched.reduce((a, s) => a + s.wasteCost, 0)
      return { name: f.building ? `${f.building}, ${f.name}` : f.name, waste, perSeat: seats ? waste / seats : 0, watchedRooms: watched.length }
    })
    .filter((r) => r.watchedRooms > 0)
    .sort((a, b) => a.perSeat - b.perSeat)

  async function writeShoutOut() {
    setShout('loading')
    const facts = {
      currency: site.currency,
      period: 'this session',
      floors: rows.map((r, i) => ({ rank: i + 1, floor: r.name, wastedPer100Seats: round(r.perSeat * 100, 2), roomsWatched: r.watchedRooms })),
    }
    const best = rows[0]
    const worst = rows.at(-1)!
    const fallback =
      rows.length > 1
        ? `Well done, ${best.name}: the least waste per seat this session. ${worst.name}, switch off as you leave and you can catch up next time.`
        : `${best.name} is the only floor being watched so far. Every room switched off when empty keeps it at the top.`
    try {
      const { answer } = await copilotAnswer('Write a warm, two-sentence shout-out for the Energy League: praise the best floor and encourage the last one. No blame.', facts)
      setShout({ text: answer, ai: true })
    } catch {
      setShout({ text: fallback, ai: false })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4 text-warn" aria-hidden /> Energy League
        </CardTitle>
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" onClick={writeShoutOut} disabled={shout === 'loading'} title="Write a short message to share with each floor">
            <Megaphone aria-hidden /> Shout-out
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Floors join the league once a camera or sensor watches at least one of their rooms.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {rows.map((r, i) => (
              <li key={r.name} className="flex items-center justify-between gap-2">
                <span>
                  <span className="num mr-2 text-muted-foreground">{i + 1}</span>
                  {r.name}
                </span>
                <span className="num text-muted-foreground" title="Money wasted this session per 100 seats, in watched rooms; lower is better">
                  {formatMoney(r.perSeat * 100, 2)} per 100 seats
                </span>
              </li>
            ))}
          </ol>
        )}
        {shout === 'loading' && <Skeleton className="h-12 w-full" aria-label="Writing the shout-out" />}
        {shout && shout !== 'loading' && (
          <blockquote role="status" className="rounded-lg border-l-4 border-highlight bg-muted p-3 text-sm">
            {shout.text}
            <span className="mt-1 block text-xs text-muted-foreground">{shout.ai ? 'Written by AI from the league numbers' : 'Written offline from the league numbers'}</span>
          </blockquote>
        )}
      </CardContent>
    </Card>
  )
}
