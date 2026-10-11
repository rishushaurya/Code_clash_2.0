// POST /api/ingest  (header x-api-key: the workspace's sensor key from Setup)  { readings: SensorReading[] }
// The door for every other system: smart plugs, energy meters, motion sensors, people counters,
// building management systems, Home Assistant. Readings go straight to the workspace's live twin.
//
//   curl -X POST https://<app>/api/ingest -H "x-api-key: $SENSOR_KEY" -H "content-type: application/json" \
//     -d '{"readings":[{"roomId":"CR-101","source":"shelly","occupancy":0,"devices":[{"type":"light","on":true}],"powerW":240}]}'

import { z } from 'zod'
import { readIngestKey } from '../_lib/auth.js'
import { broadcast, json, logJson, rateLimit, readBody } from '../_lib/http.js'
import { SensorSchema } from '../_lib/schemas.js'

export async function POST(req: Request) {
  const workspace = readIngestKey(req.headers.get('x-api-key') ?? '')
  if (!workspace) return json({ error: 'Unauthorized: use the sensor key shown in Setup' }, 401)
  const limited = rateLimit(req, 600)
  if (limited) return limited
  const body = await readBody(req, z.object({ readings: z.array(SensorSchema).min(1).max(100) }), 200_000)
  if (body instanceof Response) return body

  const now = Date.now()
  const results = await Promise.all(body.readings.map((r) => broadcast(workspace, 'sensor', { ...r, ts: r.ts ?? now })))
  const delivered = results.filter(Boolean).length
  logJson('info', 'ingest', { workspace, readings: body.readings.length, delivered })
  return json({ ok: delivered === body.readings.length, received: body.readings.length, delivered }, delivered ? 200 : 502)
}
