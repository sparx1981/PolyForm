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
    if (result.isError) return { error: text };
    try { return JSON.parse(text); } catch { return { text }; }
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

describe('model health', () => {
  it('no longer calls the storeys of a house duplicate walls, or furniture on another floor a collision', async () => {
    const { id, call } = await house();
    const rooms = await call('list_rooms', { model: id });
    for (const room of rooms) await call('furnish_room', { model: id, room: room.id, preset: 'living-room', settle_soft: false });
    const health = await call('check_model_health', { model: id });
    expect(health.issues.filter((i: any) => i.code === 'duplicate-wall')).toEqual([]);
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

  it('adds gutters, a chimney and solar panels, keeping dormers already on the roof', async () => {
    const { id, call } = await roofed();
    await call('add_dormers', { model: id, facing: 'south', type: 'gable' });
    const result = await call('set_roof_extras', { model: id, gutters: true, chimney: true, chimney_x: 0.3, chimney_z: 0.2, solar: true, solar_facing: 'north' });
    expect(result.error).toBeUndefined();
    const names = result.created.map((s: any) => s.name).join(' | ');
    expect(names).toMatch(/Gutters/);
    expect(names).toMatch(/Chimney/);
    expect(names).toMatch(/Solar/);
    expect(names).toMatch(/Dormers/);
    const off = await call('set_roof_extras', { model: id, chimney: false });
    expect(off.created.map((s: any) => s.name).join(' | ')).not.toMatch(/Chimney/);
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

describe('layout checks', () => {
  /** A 10 × 6 m ground floor with a front door, split by a wall at x = 0 with a doorway of the given width. */
  async function twoRooms(doorWidth = 0.9) {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Layout' });
    await h.call('add_room', { model: id, width: 10, length: 6, position: [0, 0, 0], height: 2.8 });
    const walls = await h.call('list_objects', { model: id, type: 'wall' });
    const front = walls.objects.reduce((a: any, b: any) => (b.position[2] > a.position[2] ? b : a));
    await h.call('add_opening', { model: id, wall: front.id, kind: 'door', along: 2, width: 0.9 });
    const part = await h.call('add_wall', { model: id, start: [0, 0, -3], end: [0, 0, 3], thickness: 0.12 });
    const inner = await h.call('add_opening', { model: id, wall: part.created[0].id, kind: 'door', along: 3, width: doorWidth });
    return { ...h, id, innerDoor: inner.created[0] };
  }
  const issuesOf = (r: any, code: string) => r.issues.filter((i: any) => i.code === code);

  it('finds no problems in a plain house with a way in and a doorway between rooms', async () => {
    const { id, call } = await twoRooms();
    const report = await call('check_layout', { model: id });
    expect(report.errors).toBe(0);
    expect(issuesOf(report, 'unreachable-room')).toEqual([]);
    expect(report.checked.join(' ')).toMatch(/circulation/);
    expect(report.checked.join(' ')).toMatch(/door swing/);
  });

  it('says a room is unreachable when its only doorway is too narrow', async () => {
    const { id, call } = await twoRooms(0.5);
    const report = await call('check_layout', { model: id });
    expect(issuesOf(report, 'unreachable-room').length).toBeGreaterThan(0);
  });

  it('says furniture blocks the way when it stands in the doorway', async () => {
    const { id, call, innerDoor } = await twoRooms();
    // A tall unit across the inner doorway, on the near side.
    await call('add_shape', { model: id, shape: 'box', width: 0.6, height: 1.8, depth: 1.6, position: [-0.6, 0.9, innerDoor.position[2]], name: 'Wardrobe' });
    await call('add_shape', { model: id, shape: 'box', width: 0.6, height: 1.8, depth: 1.6, position: [0.6, 0.9, innerDoor.position[2]], name: 'Chest' });
    const report = await call('check_layout', { model: id });
    expect(issuesOf(report, 'furniture-blocks-route').length + issuesOf(report, 'unreachable-room').length).toBeGreaterThan(0);
    expect(issuesOf(report, 'furniture-blocks-route').length).toBeGreaterThan(0);
  });

  it('warns when a door cannot swing on either side', async () => {
    const { id, call, innerDoor } = await twoRooms();
    const z = innerDoor.position[2];
    await call('add_shape', { model: id, shape: 'box', width: 0.5, height: 1, depth: 1.6, position: [-0.65, 0.5, z], name: 'Low unit A' });
    await call('add_shape', { model: id, shape: 'box', width: 0.5, height: 1, depth: 1.6, position: [0.65, 0.5, z], name: 'Low unit B' });
    const report = await call('check_layout', { model: id });
    expect(issuesOf(report, 'door-swing').length).toBeGreaterThan(0);
  });

  it('does not report door swing when one side is clear', async () => {
    const { id, call, innerDoor } = await twoRooms();
    await call('add_shape', { model: id, shape: 'box', width: 0.5, height: 1, depth: 1.6, position: [-0.65, 0.5, innerDoor.position[2]], name: 'Low unit A' });
    const report = await call('check_layout', { model: id });
    expect(issuesOf(report, 'door-swing')).toEqual([]);
  });

  it('wants stairs to reach an upper floor, and finds none missing when they do', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Two floors' });
    await h.call('add_room', { model: id, width: 10, length: 8, position: [0, 0, 0], height: 2.8 });
    await h.call('add_room', { model: id, width: 10, length: 8, position: [0, 2.8, 0], height: 2.8 });
    const walls = await h.call('list_objects', { model: id, type: 'wall' });
    const ground = walls.objects.filter((w: any) => w.position[1] < 2);
    const front = ground.reduce((a: any, b: any) => (b.position[2] > a.position[2] ? b : a));
    await h.call('add_opening', { model: id, wall: front.id, kind: 'door', along: 5 });
    const without = await h.call('check_layout', { model: id });
    expect(issuesOf(without, 'no-stairs-to-level').map((i: any) => i.level)).toEqual([2]);
    const rooms = await h.call('list_rooms', { model: id });
    await h.call('add_stairs', { model: id, rise: 2.8, room: rooms.find((r: any) => r.level === 1).id });
    const withStairs = await h.call('check_layout', { model: id });
    expect(issuesOf(withStairs, 'no-stairs-to-level')).toEqual([]);
    expect(issuesOf(withStairs, 'stair-headroom')).toEqual([]);
    expect(withStairs.checked.join(' ')).toMatch(/stair headroom/);
  });

  it('says when the space in front of furniture is inside a wall, and not when it is clear', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Zones' });
    await h.call('add_room', { model: id, width: 8, length: 6, position: [0, 0, 0] });
    // A cabinet standing in the middle: its front zone is clear.
    const middle = await h.call('add_interior_furniture', { model: id, type: 'cabinet', position: [0, 0, 0], settle_soft: false });
    expect((await h.call('check_layout', { model: id })).issues.filter((i: any) => i.code === 'use-zone-blocked')).toEqual([]);
    await h.call('delete_objects', { model: id, objects: [middle.created[0].id] });
    // The same cabinet 0.2 m from the back wall, facing it (turned half a turn so its front is towards the wall).
    const walled = await h.call('add_interior_furniture', { model: id, type: 'cabinet', position: [0, 0, -2.6], rotation_deg: 180, settle_soft: false });
    const zones = (await h.call('check_layout', { model: id })).issues.filter((i: any) => i.code === 'use-zone-blocked');
    expect(zones.map((i: any) => i.ids[0])).toContain(walled.created[0].id);
  });

  it('says what it could not check when there is no building', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Garden' });
    const report = await h.call('check_layout', { model: id });
    expect(report.checked).toEqual([]);
    expect(report.skipped.length).toBeGreaterThan(0);
  });
});

describe('single-slope roof', () => {
  it('slopes down one way, rising to a raised high wall on the other side', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Mono' });
    await h.call('add_room', { model: id, width: 8, length: 5, position: [0, 0, 0], height: 2.7 });
    const result = await h.call('add_roof', { model: id, roof_type: 'mono', falls_toward: 'south', pitch_deg: 15 });
    expect(result.error).toBeUndefined();
    const roofShape = (await h.store.loadModel({ uid: 'u1', email: 'me@example.com' }, id)).shapes.find(s => s.roofData && s.tags?.includes('roof-slopes'))!;
    expect(roofShape.roofData.extension.kind).toBe('lean-to');
    expect(Math.round(roofShape.roofData.pitchAngleDeg)).toBe(15);
    // The roof is high on the north side (z = -2.5) and low on the south side (z = +2.5).
    const { RoofSurface } = await import('../../src/lib/roofSurface');
    const surface = new RoofSurface(roofShape);
    const north = surface.at(0, -2.0)!.y, south = surface.at(0, 2.0)!.y;
    expect(north).toBeGreaterThan(south + 0.8);
    // Pitch: rise over 4 m between those points is about tan 15° × 4.
    expect((north - south) / 4).toBeCloseTo(Math.tan(15 * Math.PI / 180), 1);
    surface.dispose();
    // The north wall is carried up to the roof.
    const raised = (await h.call('list_objects', { model: id, name_contains: 'Raised wall' })).objects;
    expect(raised).toHaveLength(1);
    expect(raised[0].position[2]).toBeCloseTo(-2.5, 1);
  });

  it('takes Velux windows on its slope like any other roof', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Mono 2' });
    await h.call('add_room', { model: id, width: 8, length: 5, position: [0, 0, 0], height: 2.7 });
    await h.call('add_roof', { model: id, roof_type: 'mono', falls_toward: 'east', pitch_deg: 20 });
    const win = await h.call('add_roof_window', { model: id, at: [[0, 0]] });
    expect(win.error).toBeUndefined();
  });

  it('falls the other way when asked, defaulting to 15 degrees', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Mono 3' });
    await h.call('add_room', { model: id, width: 8, length: 5, position: [0, 0, 0], height: 2.7 });
    await h.call('add_roof', { model: id, roof_type: 'mono', falls_toward: 'north' });
    const roof = (await h.store.loadModel({ uid: 'u1', email: 'me@example.com' }, id)).shapes.find(s => s.roofData && s.tags?.includes('roof-slopes'))!;
    expect(Math.round(roof.roofData.pitchAngleDeg)).toBe(15);
    const { RoofSurface } = await import('../../src/lib/roofSurface');
    const surface = new RoofSurface(roof);
    expect(surface.at(0, 2.0)!.y).toBeGreaterThan(surface.at(0, -2.0)!.y + 0.8);
    surface.dispose();
    const raised = (await h.call('list_objects', { model: id, name_contains: 'Raised wall' })).objects;
    expect(raised[0].position[2]).toBeCloseTo(2.5, 1);
  });
});

describe('geometry checks', () => {
  const codes = (r: any, code: string) => r.issues.filter((i: any) => i.code === code);

  it('finds nothing wrong in a plain two-storey house', async () => {
    const { id, call } = await house();
    const walls = await call('list_objects', { model: id, type: 'wall' });
    const front = walls.objects.filter((w: any) => w.position[1] < 2).reduce((a: any, b: any) => (b.position[2] > a.position[2] ? b : a));
    await call('add_opening', { model: id, wall: front.id, kind: 'door', along: 5 });
    await call('add_opening', { model: id, wall: front.id, kind: 'window', along: 8, width: 1.2 });
    const report = await call('check_geometry', { model: id });
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.checked.join(' ')).toMatch(/junctions/);
    expect(report.checked.join(' ')).toMatch(/lining up/);
  });

  it('finds overlapping openings and an opening near the corner', async () => {
    const { id, call } = await house();
    const walls = await call('list_objects', { model: id, type: 'wall' });
    const front = walls.objects.filter((w: any) => w.position[1] < 2).reduce((a: any, b: any) => (b.position[2] > a.position[2] ? b : a));
    await call('add_opening', { model: id, wall: front.id, kind: 'window', along: 5, width: 1.2 });
    await call('add_opening', { model: id, wall: front.id, kind: 'window', along: 5.5, width: 1.2 });
    await call('add_opening', { model: id, wall: front.id, kind: 'window', along: 0.65, width: 1.2 });
    const report = await call('check_geometry', { model: id });
    expect(codes(report, 'openings-overlap').length).toBeGreaterThan(0);
    expect(codes(report, 'opening-near-corner').length).toBeGreaterThan(0);
  });

  it('finds a wall that stops short of the wall it should meet', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Gap' });
    await h.call('add_room', { model: id, width: 8, length: 6, position: [0, 0, 0] });
    // A partition from the front wall that stops 0.2 m short of the back wall (z = -3).
    await h.call('add_wall', { model: id, start: [0, 0, 3], end: [0, 0, -2.7], thickness: 0.12 });
    const report = await h.call('check_geometry', { model: id });
    expect(codes(report, 'wall-gap').length).toBeGreaterThan(0);
    // The same partition carried right through to the wall is fine.
    await h.call('undo_last_change', { model: id });
    await h.call('add_wall', { model: id, start: [0, 0, 3], end: [0, 0, -3], thickness: 0.12 });
    expect(codes(await h.call('check_geometry', { model: id }), 'wall-gap')).toEqual([]);
  });

  it('finds a wall on the upper floor that does not sit over the wall below', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Drift' });
    await h.call('add_room', { model: id, width: 8, length: 6, position: [0, 0, 0], height: 2.8 });
    await h.call('add_room', { model: id, width: 8, length: 6.2, position: [0, 2.8, 0], height: 2.8 });
    const report = await h.call('check_geometry', { model: id });
    expect(codes(report, 'vertical-drift').length).toBeGreaterThan(0);
  });

  it('finds furniture floating above the floor, and not furniture standing on it', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Float' });
    await h.call('add_room', { model: id, width: 8, length: 6, position: [0, 0, 0] });
    const sofa = await h.call('add_interior_furniture', { model: id, type: 'sofa', position: [0, 0, 0], settle_soft: false });
    expect(codes(await h.call('check_geometry', { model: id }), 'floating-object')).toEqual([]);
    await h.call('transform_objects', { model: id, objects: [sofa.created[0].id], offset: [0, 0.6, 0] });
    expect(codes(await h.call('check_geometry', { model: id }), 'floating-object').length).toBe(1);
  });

  it('says what it could not check', async () => {
    const h = harness();
    const { id } = await h.call('create_model', { name: 'Empty' });
    const report = await h.call('check_geometry', { model: id });
    expect(report.checked.length).toBeGreaterThan(0);
    expect(report.skipped.length).toBeGreaterThan(0);
  });
});
