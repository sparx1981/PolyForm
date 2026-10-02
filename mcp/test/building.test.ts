import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Shape } from '../../src/types';
import { MemoryStore } from '../src/store';
import { registerTools } from '../src/tools';
import { checkStair, stairFootprint, storyForElevation } from '../src/checks';

/** The connector's tools called directly (as Claude does) against an in-memory model. */
function harness() {
  const store = new MemoryStore();
  const tools = new Map<string, { schema: z.ZodObject<any>; run: (args: any) => Promise<any> }>();
  registerTools({
    registerTool: (name: string, config: any, run: any) => tools.set(name, { schema: z.object(config.inputSchema ?? {}), run }),
  } as any, { caller: { uid: 'u1', email: 'me@example.com' }, store });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name)!;
    const result = await tool.run(tool.schema.parse(args));
    const text: string = result.content[0].text;
    return result.isError ? { error: text } : JSON.parse(text);
  };
  return { store, call };
}

type Harness = ReturnType<typeof harness>;
const shapesOf = async (h: Harness, id: string): Promise<Shape[]> => (await h.store.loadModel({ uid: 'u1', email: 'me@example.com' }, id)).shapes;

/** A two-storey 11 × 9 m house: walls and floors on both storeys, no roof yet. */
async function house() {
  const h = harness();
  const { id } = await h.call('create_model', { name: 'House' });
  await h.call('add_room', { model: id, width: 11, length: 9, position: [5.5, 0, 4.5], height: 2.8 });
  await h.call('add_room', { model: id, width: 11, length: 9, position: [5.5, 2.8, 4.5], height: 2.8 });
  return { ...h, id };
}

describe('storeys', () => {
  it('files upper-floor walls under their own level and keeps the foundation to the ground floor', async () => {
    const { id, ...h } = await house();
    const shapes = await shapesOf({ ...h, id } as any, id);
    const walls = shapes.filter(s => s.type === 'wall');
    expect(walls).toHaveLength(8);
    for (const w of walls) {
      const expected = w.position[1] - (w.args as number[])[1] / 2 > 1 ? 'story-2' : 'story-1';
      expect(w.tags).toContain(expected);
      expect(w.tags!.filter(t => /^story-\d+$/.test(t))).toHaveLength(1);
    }
    expect(shapes.filter(s => /foundation skirt/i.test(s.name ?? ''))).toHaveLength(1);
  });

  it('works out the storey for a height', async () => {
    const { id, ...h } = await house();
    const shapes = await shapesOf({ ...h, id } as any, id);
    expect(storyForElevation(shapes, 0)).toBe(1);
    expect(storyForElevation(shapes, 2.8)).toBe(2);
    expect(storyForElevation(shapes, 5.6)).toBe(3);
  });
});

describe('stairs', () => {
  it('refuses a flight that would stick out of the house', async () => {
    const { id, call } = await house();
    // Starts 1.5 m inside the back wall and runs 3.6 m towards +z, out through it.
    const result = await call('add_stairs', { model: id, rise: 2.8, position: [3, 0, 7.5], rotation_deg: 0 });
    expect(result.error).toMatch(/stick out of the house/);
  });

  it('accepts a flight inside the room, and cuts the stairwell in the floor above', async () => {
    const { id, call, store } = await house();
    const ok = await call('add_stairs', { model: id, rise: 2.8, position: [3, 0, 8.4], rotation_deg: 180 });
    expect(ok.error).toBeUndefined();
    const shapes = await shapesOf({ store, call, id } as any, id);
    const stair = shapes.find(s => s.type === 'staircase')!;
    expect(checkStair(shapes, stair).errors).toEqual([]);
    const f = stairFootprint(stair);
    expect(f.climb[1]).toBeCloseTo(-1);
    const slab = shapes.find(s => /floor slab/i.test(s.name ?? '') && s.position[1] > 2);
    expect(JSON.stringify(slab)).toMatch(/hole/i);
  });

  it('places the stairs by itself when given a room, inside it', async () => {
    const { id, call, store } = await house();
    const rooms = await call('list_rooms', { model: id });
    const ground = rooms.find((r: any) => r.level === 1);
    const placed = await call('add_stairs', { model: id, rise: 2.8, room: ground.id });
    expect(placed.error).toBeUndefined();
    const shapes = await shapesOf({ store, call, id } as any, id);
    const stair = shapes.find(s => s.type === 'staircase')!;
    expect(checkStair(shapes, stair).errors).toEqual([]);
  });

  it('keeps a second flight clear of the first', async () => {
    const { id, call, store } = await house();
    const rooms = await call('list_rooms', { model: id });
    const ground = rooms.find((r: any) => r.level === 1);
    await call('add_stairs', { model: id, rise: 2.8, room: ground.id });
    const second = await call('add_stairs', { model: id, rise: 2.8, room: ground.id });
    expect(second.error).toBeUndefined();
    const shapes = await shapesOf({ store, call, id } as any, id);
    const flights = shapes.filter(s => s.type === 'staircase');
    expect(flights).toHaveLength(2);
    for (const f of flights) expect(checkStair(shapes, f).errors).toEqual([]);
    const [a, b] = flights.map(f => stairFootprint(f).centre);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(1);
  });

  it('says so when no flight fits the room', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Small' });
    await h.call('add_room', { model: id, width: 2, length: 2.2, position: [0, 0, 0] });
    const rooms = await h.call('list_rooms', { model: id });
    const result = await h.call('add_stairs', { model: id, rise: 2.8, room: rooms[0].id });
    expect(result.error).toMatch(/No stairs fit/);
  });
});

describe('roofs: windows and dormers', () => {
  async function roofed() {
    const h = await house();
    await h.call('add_roof', { model: h.id, roof_type: 'gable', pitch_deg: 35 });
    return h;
  }

  it('sets real Velux roof windows in the slope, turned to the pitch', async () => {
    const { id, call } = await roofed();
    let result: any;
    for (const facing of ['south', 'east']) {
      result = await call('add_roof_window', { model: id, facing, count: 2 });
      if (!result.error) break;
    }
    expect(result.error).toBeUndefined();
    expect(result.created).toHaveLength(2);
    for (const w of result.created) {
      expect(w.type).toBe('window');
      expect(w.name).toBe('Velux Roof Window');
    }
    const detail = await call('get_object', { model: id, object: result.created[0].id });
    expect(detail.archStyle).toBe('velux-roof');
    // Lying in a slope: not upright like a wall window.
    expect(Math.abs(detail.quaternion[0]) + Math.abs(detail.quaternion[1]) + Math.abs(detail.quaternion[2])).toBeGreaterThan(0.2);
  });

  it('refuses a roof window in the air', async () => {
    const { id, call } = await roofed();
    const result = await call('add_roof_window', { model: id, at: [[40, 40]] });
    expect(result.error).toMatch(/not on the roof/);
  });

  it('adds a full-width flat dormer on a slope', async () => {
    const { id, call } = await roofed();
    let result: any;
    for (const facing of ['south', 'north', 'east', 'west']) {
      result = await call('add_dormers', { model: id, facing, type: 'flat', full_width: true });
      if (!result.error) break;
    }
    expect(result.error).toBeUndefined();
    expect(result.created.map((s: any) => s.name).join(' ')).toMatch(/Dormers \(1, flat\)/);
    expect(result.done).toMatch(/flat dormer/);
  });
});

describe('furniture and the ceiling', () => {
  it('refuses a tall item under a low sloping roof', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Attic' });
    await h.call('add_room', { model: id, width: 8, length: 6, position: [0, 0, 0], height: 0.9 });
    await h.call('add_roof', { model: id, roof_type: 'gable', pitch_deg: 35 });
    const tight = await h.call('add_interior_furniture', { model: id, type: 'cabinet', position: [-3.6, 0, 0], settle_soft: false });
    expect(tight.error).toMatch(/headroom/);
  });

  it('allows the same item where the ceiling is high enough', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Room' });
    await h.call('add_room', { model: id, width: 8, length: 6, position: [0, 0, 0], height: 2.8 });
    const ok = await h.call('add_interior_furniture', { model: id, type: 'cabinet', position: [0, 0, 0], settle_soft: false });
    expect(ok.error).toBeUndefined();
  });
});

describe('porch', () => {
  async function withFrontDoor() {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Porch' });
    await h.call('add_room', { model: id, width: 10, length: 8, position: [0, 0, 0], height: 2.8 });
    const walls = await h.call('list_objects', { model: id, type: 'wall' });
    // The wall at the front: the one with the largest z.
    const front = walls.objects.reduce((a: any, b: any) => (b.position[2] > a.position[2] ? b : a));
    const door = await h.call('add_opening', { model: id, wall: front.id, kind: 'door', along: 5 });
    return { ...h, id, front, doorId: door.created[0].id, doorPos: door.created[0].position as number[] };
  }

  for (const style of ['gable', 'lean-to', 'flat'] as const) {
    it(`builds a ${style} porch outside the wall, with the roof above the door`, async () => {
      const { id, call, doorId, doorPos, front } = await withFrontDoor();
      const result = await call('add_porch', { model: id, door: doorId, style, width: 2.4, depth: 1.5 });
      expect(result.error).toBeUndefined();
      const parts = result.created as { name: string; position: number[] }[];
      expect(parts.map(p => p.name)).toEqual(expect.arrayContaining(['Porch landing', 'Porch roof', 'Porch post 1', 'Porch post 2']));
      const wallOuterFace = front.position[2] + 0.1;
      for (const part of parts) {
        // Every part stands outside the wall (more z than its outer face), centred on the door across the front.
        expect(part.position[2]).toBeGreaterThan(wallOuterFace - 0.01);
        expect(Math.abs(part.position[0] - doorPos[0])).toBeLessThan(1.5);
      }
      const roof = parts.find(p => p.name === 'Porch roof')!;
      expect(roof.position[1]).toBeGreaterThan(2.1 + 0.1);
      const posts = parts.filter(p => p.name.startsWith('Porch post'));
      expect(posts.every(p => p.position[2] > wallOuterFace + 1.0)).toBe(true);
    });
  }

  it('refuses something that is not a door', async () => {
    const { id, call, front } = await withFrontDoor();
    const result = await call('add_porch', { model: id, door: front.id });
    expect(result.error).toMatch(/not a door/);
  });
});
