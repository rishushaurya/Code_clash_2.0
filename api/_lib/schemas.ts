// Request shapes, validated before any handler logic runs. Mirrors src/shared/types.ts.

import { z } from 'zod'

export const RoomIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,12}$/, 'room id: letters, digits and dashes, up to 12')

export const FactsSchema = z.object({
  roomId: RoomIdSchema,
  roomName: z.string().max(60),
  alertType: z.enum(['empty_with_load', 'over_capacity', 'co2_high', 'daylight_available', 'underused', 'reported', 'ac_mild_weather', 'camera_offline', 'ac_overcooling']),
  minutesEmpty: z.number().optional(),
  devicesOn: z.array(z.object({ type: z.enum(['light', 'fan', 'ac', 'projector', 'pc']), count: z.number(), watts: z.number() })).max(5),
  wattsNow: z.number(),
  costPerHourNow: z.number(),
  kwhToday: z.number(),
  costToday: z.number(),
  co2KgToday: z.number(),
  co2ppm: z.number().optional(),
  headcount: z.number().optional(),
  capacity: z.number(),
  monthlySavingCost: z.number().optional(),
  smallerRoomId: RoomIdSchema.optional(),
  outdoorAqi: z.number().optional(),
  outdoorTempC: z.number().optional(),
  minutesSinceCamera: z.number().optional(),
  indoorTempC: z.number().optional(),
  acSavingPercent: z.number().optional(),
  currency: z.string().length(3),
})
export type Facts = z.infer<typeof FactsSchema>

export const SensorSchema = z.object({
  roomId: RoomIdSchema,
  source: z.string().min(1).max(40),
  ts: z.number().optional(),
  occupancy: z.number().min(0).max(5000).optional(),
  devices: z
    .array(z.object({ id: z.string().max(60).optional(), type: z.enum(['light', 'fan', 'ac', 'projector', 'pc']).optional(), on: z.boolean() }).refine((d) => d.id || d.type, 'each device needs an id or a type'))
    .max(200)
    .optional(),
  powerW: z.number().min(0).max(10_000_000).optional(),
  co2ppm: z.number().min(250).max(10_000).optional(),
  temperatureC: z.number().min(-40).max(80).optional(),
  humidity: z.number().min(0).max(100).optional(),
})

export const CommandSchema = z.object({
  id: z.string().uuid(),
  ts: z.number(),
  roomId: RoomIdSchema,
  target: z.enum(['lights', 'fans', 'all']),
  state: z.enum(['on', 'off']),
  origin: z.enum(['ui', 'telegram', 'copilot', 'policy']),
})
