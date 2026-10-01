import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { wallAttachmentPoint } from './wallAttachment';
import { detectRooms } from './rooms';
import type { Shape } from '../../types';
const wall = (id: string, x: number, z: number, yaw = 0): Shape => ({ id, type: 'wall', position: [x, 1.4, z], rotation: [0, yaw, 0], args: [6, 2.8, 0.2], color: '#fff' });
describe('interior wall attachments', () => {
  it('finds the inward face even when wall directions are reversed', () => {
    for (const reversed of [false, true]) {
      const north = wall('north', 0, -3, reversed ? Math.PI : 0);
      const shapes = [north, wall('south', 0, 3), wall('west', -3, 0, Math.PI / 2), wall('east', 3, 0, Math.PI / 2)];
      const room = detectRooms(shapes, { cell: 0.1 });
      expect(wallAttachmentPoint(north, new THREE.Vector3(1, 0, -3), true, room).z).toBeCloseTo(-2.9);
    }
  });
  it('uses Euler rotations and clamps attachment positions to the wall length', () => {
    const east = wall('east', 3, 0, Math.PI / 2);
    const shapes = [wall('north', 0, -3), wall('south', 0, 3), wall('west', -3, 0, Math.PI / 2), east];
    const p = wallAttachmentPoint(east, new THREE.Vector3(2.8, 0, 2), true, detectRooms(shapes, { cell: 0.1 }));
    expect(p.x).toBeCloseTo(2.9); expect(p.z).toBeCloseTo(2);
    expect(wallAttachmentPoint(east, new THREE.Vector3(3, 0, 20), false, []).z).toBeCloseTo(3);
  });
});
