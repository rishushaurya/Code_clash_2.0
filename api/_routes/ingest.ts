// POST /api/ingest  (header x-api-key: the workspace's sensor key from Setup)  { readings: SensorReading[] }
// The door for every other system: smart plugs, energy meters, motion sensors, people counters,
// building management systems, Home Assistant. Readings go straight to the workspace's live twin, and are
// stored (room_inputs) so the server's minute tick sees them with no browser open.
//
//   curl -X POST https://<app>/api/ingest -H "x-api-key: $SENSOR_KEY" -H "content-type: application/json" \
//     -d '{"readings":[{"roomId":"CR-101","source":"shelly","occupancy":0,"devices":[{"type":"light","on":true}],"powerW":240}]}'

import { z } from 'zod'
import { readIngestKey } from '../_lib/auth.js'
import { broadcast, json, logJson, rateLimit, readBody } from '../_lib/http.js'
import { SensorSchema } from '../_lib/schemas.js'
import { storeSensors } from './reading.js'

export async function POST(req: Request) {
  const workspace = readIngestKey(req.headers.get('x-api-key') ?? '')
  if (!workspace) return json({ error: 'Unauthorized: use the sensor key shown in Setup' }, 401)
  const limited = rateLimit(req, 600)
  if (limited) return limited
  const body = await readBody(req, z.object({ readings: z.array(SensorSchema).min(1).max(100) }), 200_000)
  if (body instanceof Response) return body

  const now = Date.now()
  const readings = body.readings.map((r) => ({ ...r, ts: Math.min(r.ts ?? now, now) }))
  const [stored, ...results] = await Promise.all([storeSensors(workspace, readings), ...readings.map((r) => broadcast(workspace, 'sensor', r))])
  const delivered = results.filter(Boolean).length
  logJson('info', 'ingest', { workspace, readings: readings.length, delivered, stored })
  return json({ ok: delivered === readings.length, received: readings.length, delivered, stored }, delivered || stored ? 200 : 502)
}
