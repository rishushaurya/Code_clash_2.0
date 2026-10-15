// Assistant tools that explain: where a number came from, how to connect a room with no inputs, and the
// ideas behind the app. Code writes the facts and steps from this site's settings and live state; the AI may
// rephrase them, and every figure it says must be in what these functions return.

import { CO2_ALERT_PPM, CO2_OUTDOOR_PPM, CO2_PER_PERSON_M3S, VENTILATION_ACH, WASTE_MIN_W } from '@/shared/config'
import type { Room, RoomState, Site } from '@/shared/types'
import { round } from '@/twin/energy'

export type Metric = 'power' | 'cost' | 'energy' | 'emissions' | 'air' | 'people' | 'waste' | 'saved' | 'savings' | 'epi'
export type Topic = 'kwh' | 'epi' | 'bee' | 'co2' | 'naac'
export const METRICS: Metric[] = ['power', 'cost', 'energy', 'emissions', 'air', 'people', 'waste', 'saved', 'savings', 'epi']
export const TOPICS: Topic[] = ['kwh', 'epi', 'bee', 'co2', 'naac']

const INPUT_WORDS = { camera: 'a camera', sensor: 'a sensor or smart plug', manual: 'a staff report' } as const
const inputs = (s: RoomState | undefined) => (s?.sources.length ? s.sources.map((x) => INPUT_WORDS[x]).join(', ') : 'no live input')

/** Where a number on screen comes from, for one room or the whole building */
export function explainMetric(metric: Metric, site: Site, rooms: Record<string, RoomState>, room?: Room) {
  const s = room ? rooms[room.id] : undefined
  const all = Object.values(rooms)
  const scope = room ? { roomId: room.id } : { roomsWithLiveInput: all.filter((r) => r.sources.length).length, rooms: site.rooms.length }
  const base = { metric, ...scope, currency: site.currency }
  switch (metric) {
    case 'power': {
      if (!room) return { ...base, wattsNow: round(all.reduce((a, r) => a + r.watts, 0), 0), how: 'Measured: the sum of every room. Each room is metered by a smart plug or meter where one reports, otherwise it is the rated watts of each device seen on.' }
      const observed = Object.keys(s?.deviceOn ?? {}).length
      const sources = Object.values(s?.deviceSource ?? {})
      return {
        ...base,
        wattsNow: round(s?.watts ?? 0, 0),
        source: s?.metered ? 'a meter or smart plug' : 'device ratings',
        devicesObserved: observed,
        devicesInRoom: room.devices.length,
        inferredDevices: sources.filter((x) => x === 'inferred').length,
        inputs: inputs(s),
        how: s?.metered
          ? 'A meter or smart plug in this room reports the power directly.'
          : 'The rated watts of each device seen on are added up. Devices no input observes count as off and are listed as not observed. Inferred devices take the state of the same type the camera sees.',
      }
    }
    case 'cost':
      return { ...base, tariffPerKwh: site.tariffPerKwh, ...(s && { wattsNow: round(s.watts, 0) }), how: 'Power in kilowatts times the tariff per kWh from Settings, Site. Money spent so far adds this up every 2 seconds.' }
    case 'energy':
      return { ...base, ...(s && { kwhSinceTwinStarted: round(s.kwh, 3) }), how: 'kWh is power over time: the twin adds watts times the 2 second tick, from when this screen opened the twin.' }
    case 'emissions':
      return { ...base, gridKgCo2PerKwh: site.gridKgPerKwh, ...(s && { co2KgSinceTwinStarted: round(s.co2Kg, 3) }), how: 'Energy in kWh times the grid emission factor in Settings, Site (kg CO2 per kWh from the grid authority).' }
    case 'air':
      if (s?.co2Measured) return { ...base, co2ppm: round(s.co2ppm, 0), source: 'a CO2 sensor', how: 'A CO2 sensor in the room reports it; measured values replace the estimate.' }
      return {
        ...base,
        ...(s?.occupancyKnown && { co2ppmEstimated: round(s.co2ppm, 0), people: s.headcount }),
        source: s?.occupancyKnown ? 'an estimate from the head-count' : 'none: no head-count or CO2 sensor',
        outdoorPpm: CO2_OUTDOOR_PPM,
        airChangesPerHour: VENTILATION_ACH,
        guidelinePpm: CO2_ALERT_PPM,
        how: 'Estimated with a single-room mass balance: each seated person adds CO2, ventilation brings it back toward outdoor air. The ventilation rate is the main uncertainty, so a sensor is better.',
      }
    case 'people':
      return { ...base, ...(s?.occupancyKnown && { people: s.headcount }), inputs: inputs(s), how: 'Counted on the camera device by a person detector (only the number leaves the camera), or reported by an occupancy or motion sensor. With neither, people are unknown, never zero.' }
    case 'waste':
      return { ...base, emptyDelaySeconds: site.emptyDelayS, minimumWatts: WASTE_MIN_W, ...(s && { wasteCostSoFar: round(s.wasteCost) }), how: 'A room wastes power when nobody has been seen for the empty delay and it still draws more than the minimum. Money spent in that state is the waste.' }
    case 'saved':
      return { ...base, how: 'Counted only after a switch-off is confirmed by a camera, a sensor or staff: the load before the command minus the load after, for as long as the room stays off.' }
    case 'savings':
      return { ...base, modelled: true, how: 'Modelled in the Scenario Lab: a simulation of your rooms, hours and devices runs many times with different random class patterns, and the saving is given as a range (p10 to p90), not one number.' }
    case 'epi':
      return { ...base, modelled: true, how: 'Energy performance index: kWh per square metre of floor per year. The app scales a modelled week to a year and divides by the area of the configured rooms.' }
  }
}

/** How to bring live data into a room: the rooms with no input, and the steps for each way in */
export function connectionGuide(site: Site, rooms: Record<string, RoomState>, room?: Room) {
  const noInput = site.rooms.filter((r) => !rooms[r.id]?.sources.length).map((r) => r.id)
  const id = room?.id ?? noInput[0] ?? site.rooms[0]?.id ?? 'the room'
  return {
    ...(room && { roomId: room.id, inputsNow: inputs(rooms[room.id]) }),
    roomsWithNoInput: noInput,
    methods: [
      {
        name: 'Camera on this device or a phone',
        link: '/camera',
        steps: [
          `Open Cameras and pick ${id}.`,
          'Use this device, or choose Add a phone and scan the QR code with the phone that will stay in the room.',
          'Mount it high in a corner so it sees the seats and the lights; keep it charging.',
          'Mark the room boundary, then one zone on each light, fan and screen.',
          'Calibrate each zone with the device on, then off.',
        ],
      },
      {
        name: 'Sensor API',
        link: '/connections',
        steps: [
          'Copy the sensor key from Connections.',
          `Send readings to /api/ingest with the header x-api-key, for example {"readings":[{"roomId":"${id}","source":"bms","occupancy":0,"powerW":240}]}.`,
          'Occupancy, device states, power and CO2 are all optional; send what you have.',
        ],
      },
      {
        name: 'Smart plug or meter',
        link: '/connections',
        steps: ['Open Connections, add the Shelly or Tasmota plug, and assign it to the room.', 'Its watts then replace the rated watts for that room, and Switch off can turn it off.'],
      },
    ],
  }
}

/** Short lessons, with this site's own numbers where they apply */
export function teach(topic: Topic, site: Site, siteEpi?: number) {
  switch (topic) {
    case 'kwh':
      return {
        topic: 'kWh (kilowatt-hour)',
        idea: 'Power is how fast energy is used, in watts. Energy is power over time: 1000 watts for one hour is 1 kWh. The bill charges per kWh.',
        example: { tubeLightWatts: 40, hoursForOneKwh: 25 },
        tariffPerKwh: site.tariffPerKwh,
        currency: site.currency,
      }
    case 'epi':
      return {
        topic: 'EPI (energy performance index)',
        idea: 'Yearly energy divided by floor area, in kWh per square metre per year. It lets buildings of different sizes be compared; lower is better.',
        ...(siteEpi !== undefined && { thisBuildingModelledKwhPerM2Year: siteEpi }),
      }
    case 'bee':
      return {
        topic: 'BEE (Bureau of Energy Efficiency, India)',
        idea: 'The government agency behind the star labels on ACs, fans, lights and other appliances: more stars use less energy for the same work. BEE set 24 °C as the default temperature of room ACs from January 2020, and each degree higher saves about 6% of AC electricity.',
        acDefaultC: 24,
        savingPercentPerDegree: 6,
      }
    case 'co2':
      return {
        topic: 'CO2, two ways',
        emissions: 'Electricity from the grid releases CO2 where it is made. The app multiplies kWh by the grid emission factor in Settings, Site.',
        gridKgCo2PerKwh: site.gridKgPerKwh,
        indoorAir: 'Indoor CO2 in ppm shows how stale the air is. People breathe it out; ventilation brings it back toward outdoor air. Above the guideline people get drowsy, so the app suggests ventilating.',
        outdoorPpm: CO2_OUTDOOR_PPM,
        guidelinePpm: CO2_ALERT_PPM,
        perPersonLitresPerSecond: CO2_PER_PERSON_M3S * 1000,
        airChangesPerHour: VENTILATION_ACH,
      }
    case 'naac':
      return {
        topic: 'NAAC criterion 7.1.6',
        idea: 'NAAC accredits Indian colleges. Metric 7.1.6 asks whether quality audits on environment and energy are done regularly: a green audit and an energy audit by an independent agency, plus the actions taken.',
        howThisAppHelps: 'Reports gives an audit report with room-level measured and modelled figures, and the activity log records every alert, switch-off and confirmation as evidence of action taken. It supports the auditor; it does not replace one.',
      }
  }
}
