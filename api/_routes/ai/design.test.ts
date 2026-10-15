import { describe, expect, it } from 'vitest'
import { route } from '../../router.js'
import { checkOps, OpSchema } from './design.js'

const building = {
  floors: [{ level: 0, name: 'Ground floor' }],
  rooms: [{ id: 'LH-1', name: 'Hall', floor: 0, type: 'lecture_hall' as const, widthM: 15, depthM: 10, heightM: 3, capacity: 120, counts: { light: 16 } }],
}

describe('/api/ai/design', () => {
  it('is reached through the router (not a 404)', async () => {
    for (const path of ['ai/design', 'ai/floorplan']) {
      const res = await route(new Request(`http://localhost/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
      expect(res.status).not.toBe(404)
    }
  })

  it('keeps valid operations on real rooms and floors, drops the rest', () => {
    const parse = (o: unknown) => OpSchema.nullable().catch(null).parse(o)
    const out = checkOps(
      {
        summary: 'A new seminar room.',
        ops: [
          { op: 'addFloor', level: 1, name: 'First floor' },
          { op: 'addRoom', floor: 1, name: 'Seminar', type: 'classroom', widthM: 8, depthM: 6 },
          { op: 'setStyle', roomId: 'LH-1', style: { wall: '#f0e6d8' } },
          { op: 'setStyle', roomId: 'XX-9', style: { wall: '#f0e6d8' } },
          { op: 'moveRoom', roomId: 'LH-1', floor: 7 },
          { op: 'setStyle', roomId: 'LH-1', style: { wall: 'beige' } },
          { op: 'deleteEverything' },
        ].map(parse),
      },
      building,
    )
    expect(out.ops.map((o) => o.op)).toEqual(['addFloor', 'addRoom', 'setStyle'])
    expect(out.summary).toBe('A new seminar room.')
  })
})
