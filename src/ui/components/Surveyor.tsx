// AI Surveyor: photograph the ceiling, the AI boxes every light, fan, AC, projector and PC,
// you confirm the counts, and the twin updates. Answers "how does this scale to 300 rooms?".

import { Check, ImagePlus, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { surveyRoom, type SurveyItem } from '@/ai/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { setDeviceCounts, type DeviceCounts } from '@/shared/site'
import type { DeviceType, Room } from '@/shared/types'
import { ErrorState } from './states'

const NAMES: Record<DeviceType, string> = { light: 'Lights', fan: 'Fans', ac: 'ACs', projector: 'Projectors', pc: 'PCs' }
const COLOURS: Record<DeviceType, string> = { light: '#f59e0b', fan: '#38bdf8', ac: '#a78bfa', projector: '#22c55e', pc: '#ef4444' }

/** Shrinks the photo to 1024 px so the upload stays small and fast. */
async function toDataUrl(file: File) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}

export function Surveyor({ room }: { room: Room }) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [image, setImage] = useState('')
  const [items, setItems] = useState<SurveyItem[]>([])

  async function run(file: File) {
    setPhase('loading')
    try {
      const url = await toDataUrl(file)
      setImage(url)
      setItems(await surveyRoom(room.id, url))
      setPhase('done')
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'not-configured'
          ? 'The AI Surveyor needs GEMINI_API_KEY (or GROQ_API_KEY) on the server.'
          : 'The AI could not read this photo. Try a sharper, well-lit picture of the ceiling.',
      )
      setPhase('error')
    }
  }

  const counts = items.reduce<DeviceCounts>((a, i) => ({ ...a, [i.label]: (a[i.label] ?? 0) + 1 }), {})

  function apply() {
    setDeviceCounts(room.id, counts)
    toast.success(`${room.id}: device list updated from the photo`)
    setPhase('idle')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanSearch className="size-4" aria-hidden /> AI Surveyor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-3">
          <ImagePlus className="size-4" aria-hidden /> Photograph the ceiling
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
        </Label>
        <p className="text-xs text-muted-foreground">Photograph fixtures only, never people. Unlike camera frames, this photo is sent to the AI provider.</p>
        {phase === 'loading' && <Skeleton className="aspect-video w-full" aria-label="Surveying the photo" />}
        {phase === 'error' && <ErrorState message={error} onRetry={() => setPhase('idle')} />}
        {phase === 'done' && (
          <>
            <div className="relative overflow-hidden rounded-md">
              <img src={image} alt={`Ceiling of ${room.id} with detected devices boxed`} className="w-full" />
              {items.map((it, i) => (
                <span
                  key={i}
                  className="absolute border-2"
                  style={{
                    top: `${it.box[0] / 10}%`,
                    left: `${it.box[1] / 10}%`,
                    height: `${(it.box[2] - it.box[0]) / 10}%`,
                    width: `${(it.box[3] - it.box[1]) / 10}%`,
                    borderColor: COLOURS[it.label],
                  }}
                  title={NAMES[it.label]}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-1">
              {(Object.keys(NAMES) as DeviceType[]).map((t) => (
                <li key={t} className="flex justify-between">
                  <span style={{ color: COLOURS[t] }}>{NAMES[t]}</span>
                  <span className="num">
                    {counts[t] ?? 0} <span className="text-muted-foreground">(now {room.devices.filter((d) => d.type === t).length})</span>
                  </span>
                </li>
              ))}
            </ul>
            <Button size="sm" className="w-full" onClick={apply} disabled={!items.length}>
              <Check aria-hidden /> Use these counts for {room.id}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
