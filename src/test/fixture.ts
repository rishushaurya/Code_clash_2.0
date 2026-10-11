// A small site for tests only. The app ships with no rooms; customers add their own in Setup.

import { emptySite, makeDevices, setSite } from '@/shared/site'
import type { Room, RoomType, Site } from '@/shared/types'

const room = (id: string, type: RoomType, capacity: number, areaM2: number, floor: number, counts: Parameters<typeof makeDevices>[1], windowSide = true): Room => ({
  id,
  name: id,
  floor,
  type,
  capacity,
  areaM2,
  volumeM3: areaM2 * 3.5,
  windowSide,
  devices: makeDevices(id, counts),
})

export const testSite: Site = {
  ...emptySite('IN'),
  organization: 'Test College',
  buildingName: 'Test Block',
  floors: [
    { level: 0, name: 'Ground floor' },
    { level: 1, name: 'First floor' },
  ],
  rooms: [
    room('LH-1', 'lecture_hall', 120, 200, 0, { light: 16, fan: 8, ac: 2, projector: 1 }),
    room('LH-2', 'lecture_hall', 120, 200, 0, { light: 16, fan: 8, ac: 2, projector: 1 }),
    room('CR-001', 'classroom', 60, 100, 0, { light: 10, fan: 6, projector: 1 }),
    room('LAB-1', 'lab', 40, 120, 1, { light: 12, fan: 6, ac: 2, projector: 1, pc: 40 }, false),
    room('OFF-1', 'office', 8, 40, 1, { light: 6, fan: 2, ac: 1, pc: 4 }),
  ],
}

export const loadTestSite = () => setSite(testSite)
