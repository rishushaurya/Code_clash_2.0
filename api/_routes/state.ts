// GET /api/state  (Bearer token)  The twin as the server last computed it, and the inputs it used, so a browser
// that just opened (or reloaded) starts from the live state instead of waiting for every input to report again.

import type { CvReading } from '../../src/shared/types'
import type { SensorState } from '../../src/twin/compute.js'
import { rows } from '../_lib/db.js'
import { json, requireRole, storageError } from '../_lib/http.js'
import type { InputRow } from './reading.js'

export async function GET(req: Request) {
  const c = await requireRole(req)
  if (c instanceof Response) return c
  const [state, inputs] = await Promise.all([
    rows<{ state: unknown; updated_at: string }>(`twin_state?workspace=eq.${c.id}&select=state,updated_at`),
    rows<InputRow>(`room_inputs?workspace=eq.${c.id}&select=key,room_id,kind,reading,ts`),
  ])
  if (!state || !inputs) return storageError(null)
  return json({
    state: state[0]?.state ?? null,
    updatedAt: state[0]?.updated_at ?? null,
    readings: inputs.filter((r) => r.kind === 'camera').map((r) => r.reading as CvReading),
    sensors: Object.fromEntries(inputs.filter((r) => r.kind === 'sensor').map((r) => [r.room_id, r.reading as SensorState])),
  })
}
