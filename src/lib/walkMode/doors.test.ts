import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { buildClosedDoorCollider, combineColliders, doorInView } from './doors';
import { createPlayerState, stepPlayer, type PhysicsBounds } from './playerPhysics';
import type { Shape } from '../../types';

// A door across the path at x = 2, its width running along z (turned 90 degrees).
const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const door: Shape = {
  id: 'door-1',
  type: 'door',
  position: [2, 1.05, 0],
  quaternion: [turned.x, turned.y, turned.z, turned.w],
  args: [0.9, 2.1, 0.15],
  color: '#ffffff',
};
const archway: Shape = { ...door, id: 'arch-1', archStyle: 'archway-round' };

const floor = (() => {
  const g = new THREE.PlaneGeometry(40, 40);
  g.rotateX(-Math.PI / 2);
  return new MeshBVH(g);
})();
const BOUNDS: PhysicsBounds = { min: new THREE.Vector3(-1000, -1000, -1000), max: new THREE.Vector3(1000, 1000, 1000) };

/** Walks towards +x for three seconds and says where the player ended up. */
function walkThrough(openIds: Set<string>, shapes: Shape[] = [door]): number {
  const collider = combineColliders(floor, buildClosedDoorCollider(shapes, openIds));
  const state = createPlayerState(new THREE.Vector3(0, 0, 0));
  // Negative move.x is world +x at camera yaw 0 (see playerPhysics.test.ts).
  for (let i = 0; i < 180; i++) {
    stepPlayer(state, { move: { x: -1, z: 0, magnitude: 1 }, jumpRequested: false, cameraYaw: 0, speed: 2.5 }, 1 / 60, collider, BOUNDS);
  }
  return state.feet.x;
}

describe('walk mode doors', () => {
  it('finds the door straight ahead within reach, not one behind or too far away', () => {
    const eye = new THREE.Vector3(0.5, 1.6, 0);
    expect(doorInView(new THREE.Ray(eye, new THREE.Vector3(1, 0, 0)), [door])?.id).toBe('door-1');
    expect(doorInView(new THREE.Ray(eye, new THREE.Vector3(-1, 0, 0)), [door])).toBeNull();
    expect(doorInView(new THREE.Ray(new THREE.Vector3(-3, 1.6, 0), new THREE.Vector3(1, 0, 0)), [door])).toBeNull();
    // Looking past the side of the door.
    expect(doorInView(new THREE.Ray(eye, new THREE.Vector3(1, 0, 1).normalize()), [door])).toBeNull();
  });

  it('never offers to open an archway or a hidden door', () => {
    const eye = new THREE.Vector3(0.5, 1.6, 0);
    const ahead = new THREE.Ray(eye, new THREE.Vector3(1, 0, 0));
    expect(doorInView(ahead, [archway])).toBeNull();
    expect(doorInView(ahead, [{ ...door, hidden: true }])).toBeNull();
  });

  it('a closed door stops the player; an open one lets them through', () => {
    expect(walkThrough(new Set())).toBeLessThan(2 - 0.2);
    expect(walkThrough(new Set(['door-1']))).toBeGreaterThan(4);
  });

  it('an archway never blocks the way', () => {
    expect(walkThrough(new Set(), [archway])).toBeGreaterThan(4);
    expect(buildClosedDoorCollider([archway], new Set())).toBeNull();
  });
});
