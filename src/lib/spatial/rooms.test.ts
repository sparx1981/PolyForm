import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { detectRooms, reconcileRooms } from './rooms';

const wall = (id: string, x: number, z: number, length: number, rotationY = 0): Shape => ({
  id,
  type: 'wall',
  name: 'Wall',
  position: [x, 1.4, z],
  rotation: [0, rotationY, 0],
  args: [length, 2.8, 0.2],
  color: '#ffffff',
});

describe('spatial room intelligence', () => {
  it('detects one enclosed rectangular room and its bounding walls', () => {
    const shapes = [
      wall('north', 0, -2, 4),
      wall('south', 0, 2, 4),
      wall('west', -2, 0, 4, Math.PI / 2),
      wall('east', 2, 0, 4, Math.PI / 2),
    ];
    const rooms = detectRooms(shapes, { cell: 0.1 });
    expect(rooms).toHaveLength(1);
    expect(rooms[0].boundaryWallIds).toEqual(['east', 'north', 'south', 'west']);
    expect(rooms[0].areaM2).toBeGreaterThan(13);
    expect(rooms[0].areaM2).toBeLessThan(17);
    expect(rooms[0].at[0]).toBeCloseTo(0, 1);
    expect(rooms[0].at[1]).toBeCloseTo(0, 1);
    expect(rooms[0].size[0]).toBeGreaterThan(3.5);
    expect(rooms[0].size[1]).toBeGreaterThan(3.5);
    expect(rooms[0].id).toContain('north');
  });

  it('includes hosted doors and windows belonging to the room boundary', () => {
    const shapes: Shape[] = [
      wall('north', 0, -2, 4),
      wall('south', 0, 2, 4),
      wall('west', -2, 0, 4, Math.PI / 2),
      wall('east', 2, 0, 4, Math.PI / 2),
      { id: 'door-1', type: 'door', position: [0, 1, -2], args: [0.9, 2.1, 0.2], color: '#fff', hostWallId: 'north' },
    ];
    expect(detectRooms(shapes, { cell: 0.1 })[0].openingIds).toEqual(['door-1']);
  });

  it('keeps a named room identity when a surrounding wall is moved', () => {
    const beforeShapes = [
      wall('north', 0, -2, 4),
      wall('south', 0, 2, 4),
      wall('west', -2, 0, 4, Math.PI / 2),
      wall('east', 2, 0, 4, Math.PI / 2),
    ];
    const before = detectRooms(beforeShapes, { cell: 0.1 });
    before[0].name = 'Living room';

    const afterShapes = beforeShapes.map(s => s.id === 'east' ? { ...s, position: [2.2, 1.4, 0] as [number, number, number] } : s);
    const reconciled = reconcileRooms(before, detectRooms(afterShapes, { cell: 0.1 }));
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].id).toBe(before[0].id);
    expect(reconciled[0].name).toBe('Living room');
  });

  it('outlines an L-shaped room as an L, not the convex hull that fills its notch', () => {
    // 8 x 6 footprint with a 4 x 3 corner missing: (4..8, 3..6) is outside.
    const seg = (id: string, a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      return wall(id, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, length + 0.2, Math.atan2(-dz, dx));
    };
    const shapes = [
      seg('a', [0, 0], [8, 0]), seg('b', [8, 0], [8, 3]), seg('c', [8, 3], [4, 3]),
      seg('d', [4, 3], [4, 6]), seg('e', [4, 6], [0, 6]), seg('f', [0, 6], [0, 0]),
    ];
    const room = detectRooms(shapes, { cell: 0.05 })[0]!;
    expect(room).toBeDefined();
    const inside = (p: [number, number]) => {
      let c = false;
      for (let i = 0, j = room.boundary.length - 1; i < room.boundary.length; j = i++) {
        const a = room.boundary[i]!, b = room.boundary[j]!;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    };
    expect(inside([2, 4.5])).toBe(true);
    expect(inside([6, 1.5])).toBe(true);
    expect(inside([6, 4.5])).toBe(false); // the notch is outside the building
    expect(inside([5, 3.6])).toBe(false);
    // The outline's own area agrees with the room's area to within a few percent.
    let a2 = 0;
    room.boundary.forEach((p, i) => { const q = room.boundary[(i + 1) % room.boundary.length]!; a2 += p[0] * q[1] - q[0] * p[1]; });
    expect(Math.abs(a2) / 2).toBeCloseTo(room.areaM2, -0.3);
    expect(room.boundary.length).toBeLessThanOrEqual(8);
  });

  it('keeps a rectangular room to four corners', () => {
    const shapes = [wall('n', 0, -2, 4), wall('s', 0, 2, 4), wall('w', -2, 0, 4, Math.PI / 2), wall('e', 2, 0, 4, Math.PI / 2)];
    expect(detectRooms(shapes, { cell: 0.1 })[0]!.boundary).toHaveLength(4);
  });

  it('stays fast and still finds rooms when a far-away wall makes the site huge', () => {
    const shapes = [
      wall('north', 0, -2, 4),
      wall('south', 0, 2, 4),
      wall('west', -2, 0, 4, Math.PI / 2),
      wall('east', 2, 0, 4, Math.PI / 2),
      // A stray wall 600 m away: at a 5 cm grid this site would be hundreds of millions of cells.
      wall('stray', 600, 600, 3),
    ];
    const started = performance.now();
    const rooms = detectRooms(shapes);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].boundaryWallIds).toEqual(['east', 'north', 'south', 'west']);
    expect(rooms[0].areaM2).toBeGreaterThan(10);
  });

  it('ignores walls with non-finite positions instead of failing', () => {
    const broken = wall('broken', NaN, 0, 4);
    const shapes = [
      wall('north', 0, -2, 4),
      wall('south', 0, 2, 4),
      wall('west', -2, 0, 4, Math.PI / 2),
      wall('east', 2, 0, 4, Math.PI / 2),
      broken,
    ];
    expect(detectRooms(shapes, { cell: 0.1 })).toHaveLength(1);
  });
});
