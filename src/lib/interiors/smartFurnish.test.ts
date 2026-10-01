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
    expect(plan.shapes.length).toBeGreaterThanOrEqual(5);
    expect(plan.shapes.filter(s => s.customData.furnitureType === 'nightstand')).toHaveLength(2);
  });

  it('exposes a soft-furnishings preset with soft-body and cloth geometry', () => {
    // Use a deliberately roomy fixture: this test is about the preset and its
    // simulation metadata, not whether two wall-hosted objects can squeeze
    // into the smaller collision/clearance fixture used by other tests.
    const shapes: Shape[] = [
      wall('north', 0, -5, 10),
      { id: 'window', type: 'window', hostWallId: 'north', position: [0, 1.5, -5], args: [1.8, 1.3, 0.2], color: '#fff' },
      wall('south', 0, 5, 10),
      wall('west', -5, 0, 10, Math.PI / 2),
      wall('east', 5, 0, 10, Math.PI / 2),
    ];
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const plan = planRoomFurnishing(shapes, room, 'soft-furnishings');
    const sofa = plan.shapes.find(shape => shape.customData?.furnitureType === 'sofa');
    const curtain = plan.shapes.find(shape => shape.customData?.furnitureType === 'curtain');
    expect(plan.unplaced).not.toContain('sofa');
    expect(plan.unplaced).not.toContain('curtain');
    expect(sofa?.customData?.semanticComponent?.simulation?.type).toBe('softbody');
    expect(curtain?.customData?.semanticComponent?.simulation?.type).toBe('cloth');
  });

  it('places wall-hosted soft furnishings regardless of wall face orientation', () => {
    // Reverse two wall directions so their local +Z faces away from the room. The planner
    // must still use the inward face rather than treating the wall as unusable.
    const shapes: Shape[] = [
      wall('north', 0, -5, 10, Math.PI),
      wall('south', 0, 5, 10),
      wall('west', -5, 0, 10, -Math.PI / 2),
      wall('east', 5, 0, 10, Math.PI / 2),
    ];
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const plan = planRoomFurnishing(shapes, room, 'soft-furnishings');
    expect(plan.unplaced).not.toContain('sofa');
    expect(plan.unplaced).not.toContain('curtain');
    expect(plan.shapes.some(shape => shape.customData?.furnitureType === 'curtain')).toBe(false);
    for (const shape of plan.shapes.filter(s => s.customData.furnitureType === 'sofa')) {
      const yaw = shape.rotation![1];
      const toCentre = [-shape.position[0], -shape.position[2]];
      expect(Math.sin(yaw)*toCentre[0] + Math.cos(yaw)*toCentre[1]).toBeGreaterThan(0);
    }
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
    expect(plan.unplaced).toHaveLength(6);
  });
  it('fits curtains inside reversed window walls and avoids duplicate treatments', () => {
    const shapes = roomShapes();
    shapes[0].rotation = [0, Math.PI, 0];
    shapes.push({ id: 'window', type: 'window', hostWallId: 'north', position: [0, 1.5, -3], args: [1.8, 1.3, 0.2], color: '#fff' });
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    const first = planRoomFurnishing(shapes, room, 'bedroom');
    const curtains = first.shapes.filter(s => s.customData.furnitureType === 'curtain');
    expect(curtains).toHaveLength(1);
    expect(curtains[0].position[2]).toBeGreaterThan(-2.9);
    expect(Math.cos(curtains[0].rotation![1])).toBeCloseTo(1);
    expect(curtains[0].customData.windowId).toBe('window');
    const second = planRoomFurnishing([...shapes, ...first.shapes], room, 'bedroom');
    expect(second.shapes.filter(s => s.customData.furnitureType === 'curtain')).toHaveLength(0);
  });

  it('keeps the entire furniture footprint within the room', () => {
    const shapes = roomShapes();
    const room = detectRooms(shapes, { cell: 0.1 })[0];
    for (const s of planRoomFurnishing(shapes, room, 'living-room').shapes) {
      const p = s.customData.semanticComponent.params;
      const yaw = s.rotation![1];
      for (const x of [-p.width/2, p.width/2]) for (const z of [-p.depth/2, p.depth/2]) {
        expect(Math.abs(s.position[0] + Math.cos(yaw)*x + Math.sin(yaw)*z)).toBeLessThan(2.91);
        expect(Math.abs(s.position[2] - Math.sin(yaw)*x + Math.cos(yaw)*z)).toBeLessThan(2.91);
      }
    }
  });

});
