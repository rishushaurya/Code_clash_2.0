// Engineering constants. Anything a customer might change (tariff, grid factor, currency, empty delay,
// rooms) lives in their site settings (src/shared/site.ts), not here.

import type { DeviceType } from './types'

/** Default device ratings for new rooms; the setup page and the AI Surveyor can change them */
export const WATTS: Record<DeviceType, number> = { light: 20, fan: 75, ac: 1500, projector: 300, pc: 120 }

/** Below this load an empty room is "idle", above it "waste" */
export const WASTE_MIN_W = 10

// Computer vision
export const PERSON_MIN_SCORE = 0.4
export const SMOOTHING_WINDOW = 5
export const DETECT_EVERY_MS = 500
export const READING_EVERY_MS = 2000
/** Zone hysteresis as a fraction of the on/off gap */
export const LIGHT_HYSTERESIS = 0.15
/** Mean frame-to-frame change (0-255) inside a fan zone that means the blades are turning */
export const MOTION_ON_THRESHOLD = 6
/** Readings older than this are ignored when merging cameras */
export const CAMERA_FRESH_MS = 6000
/** Sensor occupancy older than this no longer counts as live */
export const SENSOR_FRESH_MS = 15 * 60_000
/** After a relay command, the camera must see the zone go dark within this window */
export const VERIFY_WINDOW_MS = 15000

// Indoor air (approximate textbook values)
export const CO2_PER_PERSON_M3S = 0.005 / 1000
export const CO2_OUTDOOR_PPM = 420
export const CO2_ALERT_PPM = 1000
/** Natural ventilation, air changes per hour; the main uncertainty in the CO2 model */
export const VENTILATION_ACH = 2

export const TICK_MS = 2000

// What-if model (Scenario Lab): typical teaching day
/** The modelled day covers early openers and late closers; sessions follow the site's own hours inside it */
export const DAY_START_MIN = 6 * 60
export const DAY_END_MIN = 23 * 60
/** The cleaner's round, which switches everything off, comes this long after closing */
export const CLEANER_AFTER_CLOSE_MIN = 60
export const DAYLIGHT_FROM_MIN = 10 * 60
export const DAYLIGHT_TO_MIN = 15 * 60
export const DEFAULT_RUNS = 20
export const DEFAULT_DAYS = 7

// AI
/** At most one AI call per room and alert type in this window */
export const AI_COOLDOWN_S = 300

// Realtime (channels belong to the workspace: src/shared/workspace.ts)
export const SNAPSHOT_STALE_MS = 10000
