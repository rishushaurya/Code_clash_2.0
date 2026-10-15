// Shared contracts between modules (docs/BUILD_SPEC.md section 4).
// Change only by team agreement: every module depends on these shapes.

export type RoomId = string
export type DeviceType = 'light' | 'fan' | 'ac' | 'projector' | 'pc'
/** occupied = people present; idle = empty and off; waste = empty but drawing power; unknown = no live input yet */
export type RoomStatus = 'occupied' | 'idle' | 'waste' | 'unknown'
export type RoomType = 'lecture_hall' | 'classroom' | 'lab' | 'office' | 'meeting' | 'other'
export type CameraSourceKind = 'webcam' | 'phone' | 'usb' | 'cctv' | 'video_file' | 'python_edge'
export type AlertLanguage = 'en' | 'hi' | 'kn'

export interface Device {
  id: string
  type: DeviceType
  ratedW: number
  /** Camera zone that watches this device: L* lights (brightness), F* fans (motion), S* screens (brightness) */
  zone?: string
  /** Brick Schema class, e.g. "Luminaire" */
  brickClass: string
  /** Where it is in the room, in metres from the room's corner nearest the floor plan's origin: [x, height, z] */
  position?: [number, number, number]
}

export interface Room {
  id: RoomId
  name: string
  floor: number
  type: RoomType
  capacity: number
  areaM2: number
  volumeM3: number
  windowSide: boolean
  /** Floor-plan polygon in SVG units (1000 x 600 per floor); laid out automatically when missing */
  polygon?: [number, number][]
  /** true when the polygon came from the automatic layout, so it is recomputed when rooms change */
  autoLayout?: boolean
  devices: Device[]
  /** Floor to ceiling, metres; 3 when missing */
  heightM?: number
  /** Several cameras in one room: 'max' if views overlap (default), 'sum' if they split the room */
  cameraMerge?: 'max' | 'sum'
  /** A relay on this machine's USB port switches this room's lights */
  hasRealRelay?: boolean
  /** Never switched off automatically (labs with long runs, server rooms) */
  autoOffExempt?: boolean
}

/** Everything a customer configures. Exported and imported as JSON; this is the integration contract. */
export interface Site {
  version: 1
  organization: string
  buildingName: string
  location: { name: string; lat: number; lon: number; countryCode?: string } | null
  /** ISO 4217 code, e.g. INR, USD, EUR */
  currency: string
  /** Marginal energy charge from the electricity bill */
  tariffPerKwh: number
  /** Grid emission factor, kg CO2 per kWh */
  gridKgPerKwh: number
  /** A room counts as empty only after this long with nobody seen */
  emptyDelayS: number
  /** Model assumption: share of classes after which lights stay on; learn it from your own data */
  leftOnProbability: number
  alertLanguages: AlertLanguage[]
  /** When the building is in use; the what-if engine models classes and offices inside these hours */
  hours: { from: number; to: number; days: number[] }
  /** Live automation: switch off watched rooms left empty with power on for this many minutes */
  autoOff: { enabled: boolean; minutes: number }
  /** `building` groups floors when one site covers several buildings of a campus */
  floors: { level: number; name: string; building?: string }[]
  rooms: Room[]
  /** Telegram chat that receives this workspace's alerts and weekly digest (the bot answers /chatid with it) */
  telegramChatId?: string
}

/** A marked area of a camera picture: the room boundary, or a light, fan or screen zone */
export interface CameraZone {
  /** ROOM for the boundary, else the device zone it watches (L1, F1, S1) */
  id: string
  kind: 'region' | 'brightness' | 'motion'
  /** Fractions of the picture, 0 to 1 */
  x: number
  y: number
  w: number
  h: number
  /** Calibration: brightness (or motion) recorded with the device on and off */
  onRef?: number
  offRef?: number
}

/** One camera's saved settings, shared by every device of the workspace. Id: <roomId>/cam-<n> */
export interface CameraConfig {
  roomId: RoomId
  name: string
  zones: CameraZone[]
  updatedAt: number
}

/** Sent by a camera every 2 s. Nothing else ever leaves a camera. */
export interface CvReading {
  roomId: RoomId
  cameraId: string
  sourceKind: CameraSourceKind
  ts: number
  headcount: number
  /** Zone id -> on (lights and screens by brightness, fans by motion) */
  zones: Record<string, boolean>
  confidence: number
}

/** Any other input: smart plugs, building systems, motion sensors, Home Assistant, or a person reporting. */
export interface SensorReading {
  roomId: RoomId
  /** Where it came from, e.g. "home-assistant", "shelly", "bms", "manual" */
  source: string
  ts: number
  /** People counted, or 1 / 0 from a motion sensor */
  occupancy?: number
  /** Device states, by device id or for every device of a type */
  devices?: { id?: string; type?: DeviceType; on: boolean }[]
  /** Metered power for the whole room, if a meter or smart plug reports it */
  powerW?: number
  /** Indoor air from a room sensor; measured values replace the head-count estimate */
  co2ppm?: number
  temperatureC?: number
  humidity?: number
}

export interface RoomState {
  roomId: RoomId
  headcount: number
  /** false when no camera or sensor reports occupancy */
  occupancyKnown: boolean
  occupied: boolean
  emptySince: number | null
  /** Device id -> on; devices nobody observes are missing from this map */
  deviceOn: Record<string, boolean>
  watts: number
  /** true when watts come from a meter rather than device ratings */
  metered: boolean
  co2ppm: number
  /** true when CO2 comes from a sensor, false when estimated from the head-count */
  co2Measured: boolean
  temperatureC?: number
  humidity?: number
  status: RoomStatus
  /** How each device's state in deviceOn is known; 'inferred' = unseen, takes the state of seen devices of its type */
  deviceSource?: Record<string, 'camera' | 'sensor' | 'manual' | 'inferred'>
  /** Which inputs fed this room in the last tick */
  sources: ('camera' | 'sensor' | 'manual')[]
  zones: Record<string, boolean>
  /** Energy since the twin started */
  kwh: number
  cost: number
  co2Kg: number
  /** Money spent while status was 'waste' */
  wasteCost: number
  updatedAt: number
}

export type AlertType = 'empty_with_load' | 'over_capacity' | 'co2_high' | 'daylight_available' | 'underused' | 'reported' | 'ac_mild_weather' | 'camera_offline' | 'ac_overcooling'

export interface Alert {
  id: string
  roomId: RoomId
  type: AlertType
  since: number
  facts: FactsPack
}

/** Everything the AI may quote. A number not in here may not appear in AI text. */
export interface FactsPack {
  roomId: RoomId
  roomName: string
  alertType: AlertType
  minutesEmpty?: number
  devicesOn: { type: DeviceType; count: number; watts: number }[]
  wattsNow: number
  costPerHourNow: number
  kwhToday: number
  costToday: number
  co2KgToday: number
  co2ppm?: number
  headcount?: number
  capacity: number
  /** Computed by the simulation engine, quoted by the AI */
  monthlySavingCost?: number
  smallerRoomId?: RoomId
  /** Outdoor US AQI from Open-Meteo; above 100 the advice is fans, not open windows */
  outdoorAqi?: number
  /** Minutes since the room's last camera reading, for camera-offline alerts */
  minutesSinceCamera?: number
  /** Measured room temperature, for overcooling advice */
  indoorTempC?: number
  /** Share of AC energy saved by raising to 24 C, at about 6 % per degree (BEE) */
  acSavingPercent?: number
  /** Outdoor air temperature from Open-Meteo, for cooling advice */
  outdoorTempC?: number
  /** ISO 4217 currency of every money figure */
  currency: string
}

export interface Recommendation {
  title: string
  action: string
  reason: string
  monthlySavingCost: number | null
  priority: 'high' | 'medium' | 'low'
  command?: { roomId: RoomId; target: CommandTarget; state: 'on' | 'off' }
  /** 'ai' when written by the model, 'template' when the offline fallback wrote it */
  source: 'ai' | 'template'
}

export type CommandTarget = 'lights' | 'fans' | 'all'

export interface Command {
  id: string
  ts: number
  roomId: RoomId
  target: CommandTarget
  state: 'on' | 'off'
  origin: 'ui' | 'telegram' | 'copilot' | 'policy'
}

export interface CommandAck {
  commandId: string
  roomId: RoomId
  /** 'real' when a relay on this machine switched; 'none' when the command went to integrations or staff */
  relay: 'real' | 'none'
  /** Who saw the devices go off: a camera, a sensor, or staff; null until confirmed */
  verifiedBy: 'camera' | 'sensor' | 'manual' | null
  ts: number
}

export type PolicyId = 'baseline' | 'auto_off' | 'daylight' | 'consolidate' | 'combined'

export interface ScenarioInput {
  policy: PolicyId
  params: { emptyMinutes?: number }
  days: number
  runs: number
  seed: number
}

export interface Range {
  p10: number
  p50: number
  p90: number
}

export interface ScenarioResult {
  policy: PolicyId
  days: number
  kwh: Range
  cost: Range
  co2Kg: Range
  daily: ({ day: number } & Range)[]
  perRoom: { roomId: RoomId; kwhP50: number }[]
}

export interface ScenarioComparison {
  baseline: ScenarioResult
  policy: ScenarioResult
  /** Savings over the simulated period, computed run by run on the same random seeds */
  savings: { kwh: Range; cost: Range; co2Kg: Range }
  /** Savings scaled to 30 days */
  monthly: { kwh: Range; cost: Range; co2Kg: Range }
}

export interface Snapshot {
  ts: number
  /** Enough of the site for a phone with no settings to draw the plan */
  layout: Pick<Site, 'buildingName' | 'currency' | 'floors'> & { rooms: Pick<Room, 'id' | 'name' | 'floor' | 'capacity' | 'polygon'>[] }
  rooms: RoomState[]
  totals: { watts: number; costPerHour: number; kwh: number; co2Kg: number; wasteCost: number; savedCost: number }
}

export interface TwinEvent {
  id: string
  ts: number
  roomId: RoomId | null
  kind: 'status' | 'alert' | 'recommendation' | 'command' | 'ack'
  text: string
}

// Bring your own keys: each workspace stores its own keys on the server, encrypted. A key's value is
// never sent back to the browser; only whether it is set, its last four characters, and its last test.

export type AiProvider = 'groq' | 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'custom'
export type KeyName = AiProvider | 'telegram' | 'google_maps' | 'command_webhook' | 'shelly_cloud' | 'home_assistant'
/** What an AI call is for; each can use a different provider and model */
export type AiTask = 'chat' | 'report' | 'vision' | 'speech'

export interface KeyStatus {
  name: KeyName
  set: boolean
  last4?: string
  /** For 'custom' (any OpenAI-compatible API), 'command_webhook', 'shelly_cloud' and 'home_assistant': the server address */
  baseUrl?: string
  testedAt?: number
  ok?: boolean
  error?: string
}

export interface AiChoice {
  provider: AiProvider
  /** Empty means the provider's default model */
  model: string
}

export interface AiSettings {
  tasks: Record<AiTask, AiChoice>
  /** Tried in this order when the task's provider fails */
  fallback: AiProvider[]
  /** Use the deployment's own keys when the workspace has none (the operator can switch this off) */
  useDeploymentKeys: boolean
}
