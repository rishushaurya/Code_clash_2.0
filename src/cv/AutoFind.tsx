// Guided auto-find: the camera proposes zones for lights, fans and screens, the person maps each proposal to a
// device zone of the room and confirms. Proposals are drawn on the live picture with their number.
// Frames are compared in this browser only.

import { Check, Fan, Lightbulb, LoaderCircle, MonitorSmartphone, ScanSearch, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CALIBRATION_MIN_GAP } from '@/shared/config'
import { averageFrames, findLights, findMotion, findScreens, type Found } from './fixtures'
import { meanLuminance, relativeLuminance, zoneReady, type Frame, type Zone } from './lightZones'

export type Target = 'lights' | 'fans' | 'screens'

/** One confirmed proposal: the zone it marks and, for lights found by switching, its calibration */
export interface Placement {
  id: string
  box: Found
  onRef?: number
  offRef?: number
}

type Step =
  | { at: 'idle' }
  | { at: 'lights-off' }
  | { at: 'lights-on'; off: Frame }
  | { at: 'busy'; what: string }
  | { at: 'review'; target: Target; found: Found[]; pick: string[]; off?: Frame; on?: Frame }
  | { at: 'none'; target: Target }
  | { at: 'failed' }

/** Zones a proposal can become: switching finds lights and projector screens alike */
const MATCH: Record<Target, RegExp> = { lights: /^[LS]/, fans: /^F/, screens: /^S/ }
const SKIP = 'skip'

export interface AutoFindProps {
  zones: Zone[]
  /** Collects `n` probe frames from the running detection, one per detection */
  grab: (n: number) => Promise<Frame[]>
  /** Screen boxes of recent detections, in video pixels, and the video size */
  screens: () => { seen: Found[][]; w: number; h: number }
  /** Proposals to draw on the picture; [] clears them */
  onPreview: (found: Found[]) => void
  onApply: (placements: Placement[]) => void
  /** Hold the camera's exposure before pictures are compared */
  onBeforeCapture: () => Promise<void>
  label: (id: string) => string
  disabled: boolean
}

export function AutoFind({ zones, grab, screens, onPreview, onApply, onBeforeCapture, label, disabled }: AutoFindProps) {
  const [step, setStep] = useState<Step>({ at: 'idle' })
  const ref = zones.find((z) => z.id === 'REF' && z.w > 0)
  const targets = (t: Target) => zones.filter((z) => MATCH[t].test(z.id))

  const show = (target: Target, found: Found[], extra: { off?: Frame; on?: Frame } = {}) => {
    if (!found.length) return setStep({ at: 'none', target })
    // Zones that do not report yet first (lights before screens), so a second run fills the gaps instead of moving what is done.
    const ready = (z: Zone) => zoneReady({ ...z, kind: z.kind ?? 'brightness' })
    const free = [...targets(target).filter((z) => !ready(z)), ...targets(target).filter(ready)].map((z) => z.id)
    onPreview(found)
    setStep({ at: 'review', target, found, pick: found.map((_, i) => free[i] ?? SKIP), ...extra })
  }
  const cancel = () => {
    onPreview([])
    setStep({ at: 'idle' })
  }

  /** Runs one capture step; a camera that stops sending pictures midway ends the guide with a clear message */
  const run = (what: string, work: () => Promise<void>) => {
    setStep({ at: 'busy', what })
    work().catch(() => {
      onPreview([])
      setStep({ at: 'failed' })
    })
  }
  const capture = async (n: number) => {
    await onBeforeCapture()
    return averageFrames(await grab(n))
  }
  const findLightsOff = () => run('Recording the room with the lights off', async () => setStep({ at: 'lights-on', off: await capture(4) }))
  const findLightsOn = (off: Frame) =>
    run('Recording the room with the lights on', async () => {
      const on = await capture(4)
      show('lights', findLights(off, on), { off, on })
    })
  const findFans = () =>
    run('Watching the fans for 10 seconds', async () => {
      await onBeforeCapture()
      show('fans', findMotion(await grab(20)))
    })
  const findScreensNow = () =>
    run('Looking for screens', async () => {
      await grab(4)
      const s = screens()
      show('screens', findScreens(s.seen, s.w, s.h))
    })

  function apply(r: Extract<Step, { at: 'review' }>) {
    const value = (f: Frame, box: Found) => relativeLuminance(meanLuminance(f, box), ref ? meanLuminance(f, ref) : undefined)
    const placements = r.found.flatMap((box, i): Placement[] => {
      const id = r.pick[i]
      if (id === SKIP) return []
      if (!r.off || !r.on) return [{ id, box }]
      const onRef = Math.round(value(r.on, box) * 10) / 10
      const offRef = Math.round(value(r.off, box) * 10) / 10
      return [Math.abs(onRef - offRef) >= CALIBRATION_MIN_GAP ? { id, box, onRef, offRef } : { id, box }]
    })
    onApply(placements)
    cancel()
  }

  const noZones = (t: Target) => !targets(t).length
  const Busy = <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />

  return (
    <section aria-labelledby="autofind-title" className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <h4 id="autofind-title" className="flex items-center gap-2 text-sm font-medium">
        <ScanSearch className="size-4 text-highlight" aria-hidden /> Find fixtures automatically
      </h4>
      <div aria-live="polite" className="space-y-3 text-sm">
        {step.at === 'idle' && (
          <>
            <p className="text-muted-foreground">The camera compares pictures on this device and proposes a box for each fixture. You check each one before it is saved.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={disabled || noZones('lights')} onClick={() => setStep({ at: 'lights-off' })} title={noZones('lights') ? 'This room has no light zones in Setup' : undefined}>
                <Lightbulb aria-hidden /> Find lights
              </Button>
              <Button size="sm" variant="outline" disabled={disabled || noZones('fans')} onClick={findFans} title={noZones('fans') ? 'This room has no fan zones in Setup' : 'Switch the fans on first'}>
                <Fan aria-hidden /> Find fans
              </Button>
              <Button size="sm" variant="outline" disabled={disabled || noZones('screens')} onClick={findScreensNow} title={noZones('screens') ? 'This room has no screen zones in Setup' : 'Finds TVs, monitors and laptops'}>
                <MonitorSmartphone aria-hidden /> Find screens
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Fans: switch them on and keep people out of view for 10 seconds. Screens: the detector finds TVs, monitors and laptops; projector screens are found with Find lights by switching the projector instead.</p>
          </>
        )}
        {step.at === 'lights-off' && (
          <Guide n={1} text="Switch the lights of this room off, wait a moment, then press Next." onCancel={cancel}>
            <Button size="sm" onClick={findLightsOff}>
              Next
            </Button>
          </Guide>
        )}
        {step.at === 'lights-on' && (
          <Guide n={2} text="Now switch the lights on. When they are fully bright, press Next." onCancel={cancel}>
            <Button size="sm" onClick={() => findLightsOn(step.off)}>
              Next
            </Button>
          </Guide>
        )}
        {step.at === 'busy' && (
          <p className="flex items-center gap-2" role="status">
            {Busy} {step.what}. Keep the camera still.
          </p>
        )}
        {step.at === 'none' && (
          <Guide
            text={
              step.target === 'lights'
                ? 'Nothing got brighter. Check that the lights were off in the first picture and on in the second, and that the camera sees the fixtures.'
                : step.target === 'fans'
                  ? 'No turning fan found. Check that the fans are on and in view, and that nobody walked through the picture.'
                  : 'No screen found. Screens far away or seen edge-on are hard to find: mark them by hand.'
            }
            onCancel={cancel}
            cancelLabel="Close"
          />
        )}
        {step.at === 'failed' && <Guide text="The camera stopped sending pictures. Try again once it runs." onCancel={cancel} cancelLabel="Close" />}
        {step.at === 'review' && (
          <>
            <p>
              Found {step.found.length} {step.found.length === 1 ? 'place' : 'places'}, numbered on the picture. Choose the zone each one is, or skip it.
              {step.off && ' Lights found this way are calibrated too.'}
            </p>
            <ol className="space-y-2">
              {step.found.map((_, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="num inline-flex size-7 items-center justify-center rounded-full bg-highlight text-xs font-semibold text-on-highlight" aria-hidden>
                    {i + 1}
                  </span>
                  <Select value={step.pick[i]} onValueChange={(v) => setStep({ ...step, pick: step.pick.map((p, j) => (j === i ? v : p === v && v !== SKIP ? SKIP : p)) })}>
                    <SelectTrigger className="h-9 w-56" aria-label={`Zone for place ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targets(step.target).map((z) => (
                        <SelectItem key={z.id} value={z.id}>
                          {z.id} {label(z.id)}
                          {z.w > 0 ? ' (replace its box)' : ''}
                        </SelectItem>
                      ))}
                      <SelectItem value={SKIP}>Skip this one</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={step.pick.every((p) => p === SKIP)} onClick={() => apply(step)}>
                <Check aria-hidden /> Use these zones
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                <X aria-hidden /> Discard
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Guide({ n, text, onCancel, cancelLabel = 'Cancel', children }: { n?: number; text: string; onCancel: () => void; cancelLabel?: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="flex gap-2">
        {n && <span className="num font-semibold text-highlight">Step {n} of 2.</span>}
        <span>{text}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {children}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}
