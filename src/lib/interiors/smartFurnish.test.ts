import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { detectRooms } from '../spatial/rooms';
import { planRoomFurnishing } from './smartFurnish';

const wall = (id: string, x: number, z: number, length: number, rotationY = 0): Shape => ({
  id,
  type: 'wall',
  position: [x, 1.4, z],
  rotation: [0, rotationY, 0],
  args: [length, 2.8, 0.2],
  color: '#fff',
});

const roomShapes = (): Shape[] => [
  wall('north', 0, -3, 6),
  wall('south', 0, 3, 6),
  wall('west', -3, 0, 6, Math.PI / 2),
  wall('east', 3, 0, 6, Math.PI / 2),
];

describe('smart room furnishing', () => {
  it('places a bedroom plan inside a detected room', () => {
    const shapes = roomShapes();
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const plan = planRoomFurnishing(shapes, room, 'bedroom');
    expect(plan.shapes.some(shape => shape.customData?.furnitureType === 'bed')).toBe(true);
    expect(plan.shapes.every(shape => shape.customData?.semanticComponent?.roomId === room.id)).toBe(true);
    expect(plan.unplaced.length).toBeLessThan(3);
  });

  it('exposes a soft-furnishings preset with soft-body and cloth geometry', () => {
    const shapes = roomShapes();
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const plan = planRoomFurnishing(shapes, room, 'soft-furnishings');
    const sofa = plan.shapes.find(shape => shape.customData?.furnitureType === 'sofa');
    const curtain = plan.shapes.find(shape => shape.customData?.furnitureType === 'curtain');
    expect(sofa?.customData?.semanticComponent?.simulation?.type).toBe('softbody');
    expect(curtain?.customData?.semanticComponent?.simulation?.type).toBe('cloth');
  });

  it('reserves access space around a hosted door', () => {
    const shapes: Shape[] = [
      ...roomShapes(),
      { id: 'door', type: 'door', position: [0, 1.05, -3], args: [1.2, 2.1, 0.2], color: '#fff', hostWallId: 'north' },
    ];
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const plan = planRoomFurnishing(shapes, room, 'living-room');
    expect(plan.shapes.length).toBeGreaterThan(0);
    for (const shape of plan.shapes) {
      expect(Math.hypot(shape.position[0], shape.position[2] + 3)).toBeGreaterThan(0.5);
    }
  });

  it('reports furniture that cannot be placed rather than forcing collisions', () => {
    const shapes = roomShapes();
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const blocker: Shape = {
      id: 'blocker',
      type: 'custom',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      args: [20, 1, 20],
      color: '#888',
      customData: {
        semanticComponent: {
          kind: 'furniture',
          params: { width: 20, depth: 20 },
          placement: { hosts: ['floor'] },
        },
      },
    };
    const plan = planRoomFurnishing([...shapes, blocker], room, 'bedroom');
    expect(plan.shapes).toHaveLength(0);
    expect(plan.unplaced).toHaveLength(3);
  });
});
