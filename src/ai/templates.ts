// Recommendations written by code from the facts pack. The title, action and priority always come from here
// (the rule decides what to do); the AI may rewrite only the reason. Offline, the whole card comes from here.

import type { FactsPack, Recommendation } from '@/shared/types'
import { formatMoney } from '@/twin/energy'

const NAMES: Record<string, [string, string]> = { light: ['light', 'lights'], fan: ['fan', 'fans'], ac: ['AC', 'ACs'], projector: ['projector', 'projectors'], pc: ['PC', 'PCs'] }
export const deviceList = (f: Pick<FactsPack, 'devicesOn'>) =>
  f.devicesOn.map((d) => `${d.count} ${NAMES[d.type][d.count === 1 ? 0 : 1]}`).join(', ') || 'devices'

export function templateRecommendation(f: FactsPack): Recommendation {
  const saving = f.monthlySavingCost ?? null
  const base = { monthlySavingCost: saving, source: 'template' as const }
  switch (f.alertType) {
    case 'empty_with_load':
      return {
        ...base,
        title: `Switch off ${f.roomId}`,
        action: `Switch off ${deviceList(f)} in ${f.roomName} now, and enable auto-off after 5 empty minutes.`,
        reason: `${f.roomId} is empty but drawing ${f.wattsNow} W, costing ${formatMoney(f.costPerHourNow, 2)} per hour.`,
        priority: f.wattsNow >= 1000 ? 'high' : 'medium',
        command: { roomId: f.roomId, target: 'all', state: 'off' },
      }
    case 'co2_high':
      return {
        ...base,
        title: `Ventilate ${f.roomId}`,
        action:
          f.outdoorAqi !== undefined && f.outdoorAqi > 100
            ? `Ventilate ${f.roomName} with the exhaust or ceiling fans; outdoor air is poor, so keep the windows shut.`
            : `Ventilate ${f.roomName}: open the windows for 10 minutes, or take a short break outside.`,
        reason: `Indoor CO2 is ${f.co2ppm} ppm with ${f.headcount} people, above the 1000 ppm guideline.`,
        priority: 'medium',
      }
    case 'over_capacity':
      return {
        ...base,
        title: `${f.roomId} is over capacity`,
        action: `Move part of the group from ${f.roomName} to a free room nearby.`,
        reason: `${f.headcount} people in a room that seats ${f.capacity}.`,
        priority: 'medium',
      }
    case 'daylight_available':
      return {
        ...base,
        title: `Use daylight in ${f.roomId}`,
        action: `Switch off the window-side lights in ${f.roomName}; daylight is enough right now.`,
        reason: `All lights are on in a window-side room while the sky is clear.`,
        priority: 'low',
      }
    case 'ac_mild_weather':
      return {
        ...base,
        title: `Ease off the AC in ${f.roomId}`,
        action:
          f.outdoorAqi !== undefined && f.outdoorAqi > 100
            ? `Outside is ${f.outdoorTempC} °C but the air is poor: switch the ACs in ${f.roomName} to fan mode, or set them no lower than 24 °C.`
            : `Outside is ${f.outdoorTempC} °C: switch off the ACs in ${f.roomName} and use fans or open windows; if cooling is still needed, set 24 °C.`,
        reason: `ACs are running while the outdoor air is already cooler than the 24 °C default setting.`,
        priority: 'medium',
      }
    case 'ac_overcooling':
      return {
        ...base,
        title: `Raise the AC in ${f.roomId} to 24 °C`,
        action: `${f.roomName} measures ${f.indoorTempC} °C with ACs running. Set them to 24 °C, the BEE default.`,
        reason: `Each degree higher saves about 6% of AC electricity: about ${f.acSavingPercent}% here, and the room gets more comfortable.`,
        priority: 'medium',
      }
    case 'camera_offline':
      return {
        ...base,
        title: `Camera for ${f.roomId} stopped`,
        action: `Check the device watching ${f.roomName}: battery, Wi-Fi, and that the camera page is open and in front.`,
        reason: `No reading for ${f.minutesSinceCamera} minutes, so ${f.roomId} shows no live data.`,
        priority: 'medium',
      }
    case 'reported':
      return {
        ...base,
        title: `Check ${f.roomId}: lights reported on`,
        action: `Someone using the public view reported lights left on in ${f.roomName}. Check the room, or switch it off if it is empty.`,
        reason: `No camera or sensor confirms the room is in use${f.wattsNow ? `, and ${f.wattsNow} W is observed there` : ''}.`,
        priority: 'medium',
        command: { roomId: f.roomId, target: 'all', state: 'off' },
      }
    case 'underused':
      return {
        ...base,
        title: `Move this class to a smaller room`,
        action: f.smallerRoomId
          ? `Move the class in ${f.roomName} to ${f.smallerRoomId} next time.`
          : `Schedule this class in a smaller room next time.`,
        reason: `${f.headcount} people are using a room that seats ${f.capacity}.`,
        priority: 'low',
      }
  }
}
