import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { detectRooms } from '../spatial/rooms';
import { footprintsOverlap, type OrientedFootprint } from '../spatial/placement';
import { planRoomFurnishing, type FurnishingPreset } from './smartFurnish';
import { createInteriorFurnitureGeometry, createInteriorFurnitureShape, interiorFurnitureCatalog } from './parametricFurniture';
import { ROOM_FURNITURE_TYPES } from './roomFurniture';

const wall = (id: string, x: number, z: number, length: number, rotationY = 0): Shape => ({
  id, type: 'wall', position: [x, 1.4, z], rotation: [0, rotationY, 0], args: [length, 2.8, 0.2], color: '#fff',
});
/** A rectangular room of w × d metres centred on the origin, with a door in its south wall. */
const room = (w: number, d: number): Shape[] => [
  wall('north', 0, -d / 2, w), wall('south', 0, d / 2, w),
  wall('west', -w / 2, 0, d, Math.PI / 2), wall('east', w / 2, 0, d, Math.PI / 2),
  { id: 'door', type: 'door', hostWallId: 'south', position: [w / 2 - 0.6, 1.0, d / 2], args: [0.9, 2.0, 0.2], color: '#fff' },
];
const plan = (shapes: Shape[], preset: FurnishingPreset) => {
  const r = detectRooms(shapes, { cell: 0.1 })[0]!;
  return { room: r, ...planRoomFurnishing(shapes, r, preset) };
};
const types = (shapes: Shape[]) => shapes.map(s => s.customData.furnitureType as string);
const footprint = (s: Shape): OrientedFootprint => ({
  id: s.id, center: [s.position[0], s.position[2]],
  halfSize: [Number(s.customData.semanticComponent.params.width) / 2, Number(s.customData.semanticComponent.params.depth) / 2],
  rotationY: s.rotation![1],
});
const expectNoOverlaps = (shapes: Shape[]) => {
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++)
    expect(footprintsOverlap(footprint(shapes[i]!), footprint(shapes[j]!)), `${types([shapes[i]!, shapes[j]!])}`).toBe(false);
};

describe('room-type furniture catalogue', () => {
  it('builds every new piece at its default size with finite geometry', () => {
    for (const type of ROOM_FURNITURE_TYPES) {
      const entry = interiorFurnitureCatalog().find(e => e.type === type)!;
      expect(entry, type).toBeDefined();
      const g = createInteriorFurnitureGeometry(type);
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new (g.boundingBox!.min.constructor as any)());
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite), type).toBe(true);
      expect(g.getAttribute('normal').count).toBe(g.getAttribute('position').count);
      // Footprint matches the declared width/depth (small overhangs for taps, handles and worktops are fine).
      expect(Math.abs(size.x - entry.defaults.width), `${type} width`).toBeLessThan(0.12);
      expect(Math.abs(size.z - entry.defaults.depth), `${type} depth`).toBeLessThan(0.16);
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
      g.dispose();
    }
  });

  it('marks wet fixtures with plumbing and keeps their ceramics glossy', () => {
    for (const type of ['toilet', 'basin', 'bath', 'shower', 'kitchen-run'] as const) {
      const shape = createInteriorFurnitureShape(type);
      expect(shape.customData.semanticComponent.plumbing.waste, type).toBe(true);
      expect(shape.customData.semanticComponent.kind).toBe('fixture');
    }
    expect(createInteriorFurnitureShape('toilet').roughness).toBeLessThan(0.4);
    expect(createInteriorFurnitureShape('desk').customData.semanticComponent.plumbing).toBeUndefined();
  });

  it('scales kitchen units to the requested width', () => {
    const g = createInteriorFurnitureGeometry('kitchen-run', { width: 3.6 });
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(3.6, 1);
    g.dispose();
  });
});

describe('office and home office presets', () => {
  it('seats a chair at each desk, facing it', () => {
    const { shapes, unplaced } = plan(room(6, 5), 'office');
    const desks = shapes.filter(s => s.customData.furnitureType === 'desk');
    const chairs = shapes.filter(s => s.customData.furnitureType === 'office-chair');
    expect(desks.length).toBeGreaterThanOrEqual(2);
    expect(chairs).toHaveLength(desks.length);
    expect(unplaced).toEqual([]);
    for (const chair of chairs) {
      const nearest = Math.min(...desks.map(d => Math.hypot(d.position[0] - chair.position[0], d.position[2] - chair.position[2])));
      expect(nearest).toBeLessThan(1.0);
    }
    expectNoOverlaps(shapes);
  });

  it('furnishes a home office with desk, chair, bookcase and curtains for its window', () => {
    const shapes = [...room(4, 3.5), { id: 'win', type: 'window', hostWallId: 'north', position: [0, 1.5, -1.75], args: [1.2, 1.2, 0.2], color: '#fff' } as Shape];
    const result = plan(shapes, 'home-office');
    expect(types(result.shapes)).toEqual(expect.arrayContaining(['desk', 'office-chair', 'bookcase', 'curtain']));
    expect(result.unplaced).toEqual([]);
  });

  it('leaves windows undressed in an office', () => {
    const shapes = [...room(6, 5), { id: 'win', type: 'window', hostWallId: 'north', position: [0, 1.5, -2.5], args: [1.2, 1.2, 0.2], color: '#fff' } as Shape];
    expect(types(plan(shapes, 'office').shapes)).not.toContain('curtain');
  });
});

describe('kitchen preset', () => {
  it('fits a run of units plus a fridge, then a dining table with chairs when there is space', () => {
    const { shapes, unplaced } = plan(room(5.5, 4.5), 'kitchen');
    const t = types(shapes);
    expect(t).toEqual(expect.arrayContaining(['kitchen-run', 'fridge', 'dining-table']));
    expect(t.filter(x => x === 'dining-chair').length).toBeGreaterThanOrEqual(2);
    expect(unplaced).toEqual([]);
    expectNoOverlaps(shapes);
  });

  it('shrinks the run to suit a small kitchen and skips the dining area', () => {
    const { shapes, unplaced } = plan(room(3, 2.6), 'kitchen');
    const run = shapes.find(s => s.customData.furnitureType === 'kitchen-run')!;
    expect(run).toBeDefined();
    expect(Number(run.customData.semanticComponent.params.width)).toBeLessThanOrEqual(3);
    expect(types(shapes)).not.toContain('dining-table');
    expect(unplaced).not.toContain('dining-table');
    expectNoOverlaps(shapes);
  });
});

describe('bathroom and toilet presets', () => {
  it('places bath, toilet and basin, clustering them on neighbouring walls', () => {
    const { shapes, unplaced, room: r } = plan(room(3, 2.5), 'bathroom');
    expect(types(shapes)).toEqual(expect.arrayContaining(['bath', 'toilet', 'basin']));
    expect(unplaced).toEqual([]);
    expectNoOverlaps(shapes);
    const wet = shapes.filter(s => s.customData.semanticComponent.plumbing);
    for (const s of wet) expect(s.customData.hostWallId, s.customData.furnitureType).toBeTruthy();
    // Pipework stays short: every wet fixture sits within a couple of metres of the others.
    for (const a of wet) for (const b of wet)
      expect(Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])).toBeLessThan(3.2);
    for (const s of shapes) expect(r.boundary.length).toBeGreaterThan(2);
  });

  it('keeps the door swing clear', () => {
    const shapes = room(2.6, 2.2);
    const { shapes: placed } = plan(shapes, 'bathroom');
    const door: OrientedFootprint = { center: [2.6 / 2 - 0.6, 2.2 / 2], halfSize: [0.45, 0.55], rotationY: 0 };
    for (const s of placed) expect(footprintsOverlap(footprint(s), door), s.customData.furnitureType).toBe(false);
  });

  it('fits a toilet and a small basin into a cloakroom', () => {
    const { shapes } = plan(room(2.1, 1.7), 'toilet');
    expect(types(shapes)).toContain('toilet');
    expectNoOverlaps(shapes);
  });

  it('never free-stands a fixture: every wet piece is wall-hosted', () => {
    for (const preset of ['bathroom', 'toilet', 'kitchen'] as const) {
      const { shapes } = plan(room(4, 3.5), preset);
      for (const s of shapes.filter(x => x.customData.semanticComponent.plumbing)) expect(s.customData.hostWallId, `${preset}/${s.customData.furnitureType}`).toBeTruthy();
    }
  });
});

describe('living room scales to the room', () => {
  it('gives a tiny or narrow room a sofa and little else', () => {
    const { shapes } = plan(room(2.4, 3.6), 'living-room');
    expect(types(shapes)).toContain('sofa');
    expect(types(shapes)).not.toContain('armchair');
    expect(types(shapes)).not.toContain('coffee-table');
  });

  it('adds a coffee table, chairs and a TV facing the sofa in a mid-sized room', () => {
    const { shapes, unplaced } = plan(room(5, 4.5), 'living-room');
    const sofa = shapes.find(s => s.customData.furnitureType === 'sofa')!;
    const tv = shapes.find(s => s.customData.furnitureType === 'tv-unit')!;
    expect(types(shapes)).toEqual(expect.arrayContaining(['sofa', 'coffee-table', 'armchair', 'tv-unit']));
    expect(unplaced).toEqual([]);
    // The TV looks back along the sofa's line of sight.
    expect(Math.cos(tv.rotation![1] - sofa.rotation![1])).toBeLessThan(-0.95);
    expectNoOverlaps(shapes);
  });

  it('keeps the sofa off the wall that carries the door', () => {
    const { shapes } = plan(room(5, 4), 'living-room');
    const sofa = shapes.find(s => s.customData.furnitureType === 'sofa')!;
    // The door is in the south wall (z = +2); the sofa should be on a different wall.
    expect(sofa.position[2]).toBeLessThan(1.2);
  });

  it('puts a second seating group and bookcase into a large room', () => {
    const { shapes } = plan(room(8, 6), 'living-room');
    expect(shapes.filter(s => s.customData.furnitureType === 'sofa').length).toBeGreaterThanOrEqual(2);
    expect(types(shapes)).toContain('bookcase');
    expectNoOverlaps(shapes);
  });

  it('treats the older soft-furnishings and minimal names as the living room', () => {
    const shapes = room(5, 4.5);
    const reference = types(plan(shapes, 'living-room').shapes);
    expect(types(plan(shapes, 'soft-furnishings').shapes)).toEqual(reference);
    expect(types(plan(shapes, 'minimal').shapes)).toEqual(reference);
  });

  it('still dresses windows with curtains', () => {
    const shapes = [...room(5, 4.5), { id: 'win', type: 'window', hostWallId: 'north', position: [0, 1.5, -2.25], args: [1.4, 1.2, 0.2], color: '#fff' } as Shape];
    expect(types(plan(shapes, 'living-room').shapes)).toContain('curtain');
  });
});

describe('garage / workshop preset', () => {
  it('fits a bench, tool chest and rack into a small garage', () => {
    const { shapes, unplaced } = plan(room(4, 3), 'workshop');
    expect(types(shapes)).toEqual(expect.arrayContaining(['workbench', 'tool-cabinet', 'shelving-rack']));
    expect(unplaced).toEqual([]);
    expectNoOverlaps(shapes);
  });

  it('adds more benches, racks and a free-standing bench in a large workshop', () => {
    const { shapes } = plan(room(9, 6.5), 'workshop');
    expect(shapes.filter(s => s.customData.furnitureType === 'workbench').length).toBeGreaterThanOrEqual(3);
    expect(shapes.filter(s => s.customData.furnitureType === 'shelving-rack').length).toBeGreaterThanOrEqual(2);
    expect(shapes.some(s => s.customData.furnitureType === 'workbench' && Number(s.customData.semanticComponent.params.doorCount) === 0)).toBe(true);
    expectNoOverlaps(shapes);
  });

  it('leaves windows undressed', () => {
    const shapes = [...room(6, 5), { id: 'win', type: 'window', hostWallId: 'north', position: [0, 1.5, -2.5], args: [1.2, 1.2, 0.2], color: '#fff' } as Shape];
    expect(types(plan(shapes, 'workshop').shapes)).not.toContain('curtain');
  });
});
