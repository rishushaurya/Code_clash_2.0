// What the Assistant knows beyond one tool: this workspace as it is now (site, rooms, devices, cameras, settings,
// open alerts, the caller's role) and how to do every task in the app, page by page. Every number comes from the
// site and the twin, so the grounding check still holds; the AI only words it.

import { getSite } from '@/shared/site'
import { useTwin } from '@/twin/store'
import { useCameras } from '@/cv/cameras'
import { role, SESSION } from '@/shared/workspace'
import { formatMoney } from '@/twin/energy'

interface Guide {
  title: string
  route: string
  /** Words a question about this task tends to use, for the offline answer */
  keywords: RegExp
  steps: string[]
}

/** How to do each task, with the page, route and button names as the app shows them */
export const APP_GUIDE: Guide[] = [
  {
    title: 'Set up the building',
    route: '/settings/site',
    keywords: /set ?up|setting|building|room|floor|device|hours|tariff|currency|import|export|template/,
    steps: [
      'Open Settings, Site (/settings/site).',
      'Quick way: press Set up with AI, describe the building in plain words or press Speak, then Read it into the form, review, and Fill the form.',
      'By hand: search the city (it prefills currency, tariff and grid factor), set opening hours and days, add floors, then rooms from templates with their seats and number of lights, fans, ACs, screens and PCs.',
      'Set device ratings in watts; a connected meter overrides them.',
      'Press Save; every device of the workspace gets the change. Export keeps a JSON backup, Import loads one.',
    ],
  },
  {
    title: 'Add a camera',
    route: '/camera',
    keywords: /camera|cctv|webcam|phone|qr|stream|video|zone|calibrat|boundary/,
    steps: [
      'Open Cameras (/camera) and choose Add a camera on this device, pick the room, and choose the source: this computer, a back camera, a CCTV stream (WHEP) or a recorded video file.',
      'For a phone, press Add a phone next to the room and scan the QR code with it, then tap Use this phone’s rear camera.',
      'Open Zones and calibration: Mark the room boundary around the floor, Mark a tight box around each light and screen, record On and Off, and Mark a box for each fan.',
      'Video never leaves the device; only counts and device states are sent.',
    ],
  },
  {
    title: 'Connect sensors, smart plugs or Home Assistant',
    route: '/connections',
    keywords: /sensor|plug|shelly|home assistant|meter|ingest|api|webhook|mqtt|integration|connection/,
    steps: [
      'Open Connections (/connections). Each card shows whether it is connected.',
      'Sensor API: send readings to /api/ingest with the workspace sensor key shown there.',
      'Smart plugs (Shelly) and Home Assistant: save the key in Settings, Keys and AI, then map each plug or entity to a room on Connections.',
      'Command webhook: set COMMAND_WEBHOOK_URL so switch-offs reach your control system, signed with COMMAND_WEBHOOK_SECRET.',
      'Press Run the connection doctor (/connections/doctor) to check every connection and see what to fix.',
    ],
  },
  {
    title: 'Add AI and other keys',
    route: '/settings/keys',
    keywords: /key|groq|gemini|openai|anthropic|openrouter|model|provider|byok|api key|telegram bot|google maps/,
    steps: [
      'Open Settings, Keys and AI (/settings/keys). Only the workspace owner manages keys.',
      'Get a key from the provider (each card links to its page), paste it, press Save, then Test.',
      'Under Which AI does what, choose the provider and model for chat, reports, vision and speech.',
      'Keys are encrypted for this workspace and never sent back to the browser; Remove deletes one.',
    ],
  },
  {
    title: 'Team, roles and devices',
    route: '/settings/team',
    keywords: /team|invite|member|role|owner|manager|viewer|sign ?out|password|device|delete the workspace|export my data/,
    steps: [
      'Open Settings, Team (/settings/team). Only the owner manages it.',
      'Invite someone: choose the role (owner, manager or viewer) and how long it is valid, press Create link, then Copy link and send it privately.',
      'Signed-in devices lists each device; Sign out ends one within 30 seconds.',
      'Workspace password: changing it signs every other device out.',
      'Your data: Download a copy, or Delete the workspace with its password.',
    ],
  },
  {
    title: 'The 3D building',
    route: '/building',
    keywords: /3d|three|walk|fly|cutaway|orbit|design|outline|openstreetmap|furniture|colour|color|model/,
    steps: [
      'Open Building 3D (/building). Rooms are green when occupied, grey when idle, red when empty with power on, dashed with no data.',
      'Orbit, walk in or fly; press K for Cutaway to lift the roof off.',
      'Press Edit to resize, recolour, add or remove rooms, floors, devices and furniture, with Undo, then Save.',
      'Design with AI: describe a change or paste a room photo; review the proposed changes before applying.',
      'Outline: generate the building shape from OpenStreetMap.',
    ],
  },
  {
    title: 'Alerts and switching off',
    route: '/alerts',
    keywords: /alert|fix|switch off|turn off|relay|telegram|notification|acknowledge|auto-?off/,
    steps: [
      'Open Alerts (/alerts). Each alert shows its evidence; press Apply the fix to switch off, or Acknowledge.',
      'A USB relay: plug in the board and press Connect relay (the cable icon) in the top bar, in Chrome or Edge.',
      'Telegram: set the chat id in Settings, Site; alerts arrive with a switch-off button.',
      'Automatic switch-off: turn it on in Settings, Site, Automation, and mark labs and server rooms Never auto-off.',
      'A saving counts only after a camera, sensor or staff member confirms the devices went off.',
    ],
  },
  {
    title: 'Savings what-ifs',
    route: '/lab',
    keywords: /scenario|what if|simulat|policy|payback|solar|business case|lab|forecast/,
    steps: [
      'Open Scenario Lab (/lab), pick a policy (auto-off, daylight, consolidate or combined) and press Run.',
      'Results are modelled over many runs and labelled Modelled, with the business case, payback and rooftop solar estimate.',
    ],
  },
  {
    title: 'Reports and trends',
    route: '/reports',
    keywords: /report|pdf|audit|naac|csv|log|trend|history|chart/,
    steps: [
      'Open Reports (/reports) for the one-click sustainability report; Download PDF prints it (choose Save as PDF).',
      'The activity log downloads as CSV, for audits such as NAAC 7.1.6.',
      'Trends (/trends) charts power, energy and occupancy over time.',
    ],
  },
  {
    title: 'Public view',
    route: '/live',
    keywords: /public|qr|visitor|student|share|live view|kiosk/,
    steps: ['The workspace menu at the top right shows the public view QR code.', 'Anyone who scans it sees the live building with no sign-in, and can report lights left on.'],
  },
  {
    title: 'Using the Assistant',
    route: '/',
    keywords: /assistant|voice|speak|mic|microphone|talk|hands-?free|language|hindi|kannada/,
    steps: [
      'Press the blue Assistant button at the top. Type, or press the microphone and talk, then press Ask; Cancel throws the recording away.',
      'Download voices once to hear answers in a natural voice that runs on this device; Read answers aloud turns it on.',
      'Talk hands-free keeps the conversation going: it listens again after each answer.',
      'Language: English, Hindi or Kannada. Voice input needs a Groq or OpenAI key.',
      'Setup changes come back as a table to Approve and save, or Dismiss; nothing changes without approval.',
    ],
  },
  {
    title: 'Troubleshooting',
    route: '/connections/doctor',
    keywords: /not working|problem|error|broken|fix it|troubleshoot|no data|storage unavailable|permission|why/,
    steps: [
      'A room stays No data: nothing watches it; add a camera or a sensor.',
      'A light zone always reads on: mark the box tighter and record On and Off again in the room’s real lighting.',
      'People in the corridor are counted: mark the room boundary tighter.',
      'Camera or microphone permission: allow it in the address bar, then try again.',
      'Storage unavailable online: run supabase/schema.sql once in the Supabase SQL editor.',
      'AI text looks like a template: no AI key, the quota is used up, or the answer failed the number check.',
      'Run the connection doctor (/connections/doctor) for a check of everything.',
    ],
  },
]

const ROOM_LIMIT = 120

/** This workspace now: everything the Assistant may quote about it */
export function workspaceSnapshot() {
  const site = getSite()
  const twin = useTwin.getState()
  const cameras = Object.values(useCameras.getState().cameras)
  const rooms = site.rooms.slice(0, ROOM_LIMIT).map((r) => {
    const live = twin.rooms[r.id]
    const devices: Record<string, number> = {}
    for (const d of r.devices) devices[d.type] = (devices[d.type] ?? 0) + 1
    return {
      roomId: r.id,
      name: r.name,
      floor: r.floor,
      type: r.type,
      seats: r.capacity,
      devices,
      cameras: cameras.filter((c) => c.roomId === r.id).length,
      ...(r.autoOffExempt && { neverAutoOff: true }),
      status: live?.status ?? 'unknown',
      liveInputs: live?.sources ?? [],
    }
  })
  return {
    you: { role: role(), workspace: SESSION?.name ?? null, online: SESSION?.mode === 'server' },
    building: {
      organization: site.organization,
      name: site.buildingName,
      location: site.location?.name ?? null,
      currency: site.currency,
      tariffPerKwh: site.tariffPerKwh,
      gridKgCo2PerKwh: site.gridKgPerKwh,
      openingHours: { from: site.hours.from, to: site.hours.to, days: site.hours.days },
      autoOff: site.autoOff,
      emptyAfterSeconds: site.emptyDelayS,
      alertLanguages: site.alertLanguages,
      telegramConnected: Boolean(site.telegramChatId),
      outlineFromOpenStreetMap: Boolean(site.outline),
      floors: site.floors.map((f) => ({ level: f.level, name: f.name, ...(f.building && { building: f.building }) })),
    },
    totals: {
      rooms: site.rooms.length,
      devices: site.rooms.reduce((a, r) => a + r.devices.length, 0),
      cameras: cameras.length,
      watchedRooms: Object.values(twin.rooms).filter((x) => x.sources.length).length,
      openAlerts: twin.alerts.length,
      savedThisSession: formatMoney(twin.savedCost, 2),
    },
    openAlerts: twin.alerts.slice(0, 20).map((a) => ({ roomId: a.roomId, type: a.type })),
    rooms,
    ...(site.rooms.length > ROOM_LIMIT && { roomsNotListed: site.rooms.length - ROOM_LIMIT }),
    appGuide: APP_GUIDE.map((g) => ({ title: g.title, route: g.route, steps: g.steps })),
  }
}

/** Offline: the guide entry that best fits the question, as numbered steps */
export function guideAnswer(question: string) {
  const text = question.toLowerCase()
  const g = APP_GUIDE.find((x) => x.keywords.test(text))
  if (!g) return 'I can explain any page of this app and walk you through it: setup, cameras, connections, keys, team, the 3D view, alerts, what-ifs and reports. What would you like to do?'
  return `${g.title} (${g.route}):\n${g.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
}
