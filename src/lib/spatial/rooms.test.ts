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
});
