import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createPlayerState, stepPlayer, type PhysicsBounds, type StepInput } from './playerPhysics';
import { CAPSULE_RADIUS, MAX_STEP_HEIGHT } from './constants';

function buildBVH(geometries: THREE.BufferGeometry[]): MeshBVH {
  const merged = geometries.length === 1 ? geometries[0] : BufferGeometryUtils.mergeGeometries(geometries, false)!;
  return new MeshBVH(merged);
}

function flatFloorGeom(size = 40): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(size, size);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

function wallGeom(x: number, width = 100, height = 6, thickness = 0.2): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(thickness, height, width);
  geom.translate(x, height / 2, 0);
  return geom;
}

/** A solid staircase profile: each step is a box reaching from the floor to that step's tread, so the capsule always has continuous solid geometry to climb. */
function staircaseGeom(stepCount: number, riser: number, tread: number): THREE.BufferGeometry[] {
  const geoms: THREE.BufferGeometry[] = [];
  for (let i = 0; i < stepCount; i++) {
    const stepTopY = (i + 1) * riser;
    const stepFrontZ = i * tread;
    const geom = new THREE.BoxGeometry(4, stepTopY, tread);
    geom.translate(0, stepTopY / 2, stepFrontZ + tread / 2);
    geoms.push(geom);
  }
  return geoms;
}

function rampGeom(angleDeg: number, length = 6, width = 4): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(width, 0.1, length);
  geom.rotateX(-THREE.MathUtils.degToRad(angleDeg));
  const rad = THREE.MathUtils.degToRad(angleDeg);
  // Translated so the near (low) edge sits at (y=0, z=0) exactly, rather
  // than floating some distance above/before the origin - otherwise
  // there's a gap between wherever the test starts the player and the
  // ramp's actual near edge, and they fall through open air before ever
  // reaching it.
  geom.translate(0, (length / 2) * Math.sin(rad), (length / 2) * Math.cos(rad));
  return geom;
}

const OPEN_BOUNDS: PhysicsBounds = { min: new THREE.Vector3(-1000, -1000, -1000), max: new THREE.Vector3(1000, 1000, 1000) };

function idleInput(overrides: Partial<StepInput> = {}): StepInput {
  return { move: { x: 0, z: 0, magnitude: 0 }, jumpRequested: false, cameraYaw: 0, speed: 2.5, ...overrides };
}

describe('stepPlayer', () => {
  it('a player on a flat floor stays grounded and does not sink or jitter over 300 frames', () => {
    const bvh = buildBVH([flatFloorGeom()]);
    const state = createPlayerState(new THREE.Vector3(0, 0.05, 0));
    for (let i = 0; i < 300; i++) {
      stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    }
    expect(state.grounded).toBe(true);
    expect(state.feet.y).toBeGreaterThan(-0.05);
    expect(state.feet.y).toBeLessThan(0.05);
  });

  it('stops at capsule-radius distance from a wall it walks straight into', () => {
    const bvh = buildBVH([flatFloorGeom(), wallGeom(3)]);
    const state = createPlayerState(new THREE.Vector3(0, 0, 0));
    // Ground first.
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, idleInput({ move: { x: 1, z: 0, magnitude: 1 } }), 1 / 60, bvh, OPEN_BOUNDS);
    }
    // Wall's near face is at x = 3 - 0.1 (thickness/2) = 2.9.
    expect(state.feet.x).toBeLessThanOrEqual(2.9 - CAPSULE_RADIUS + 0.02);
    expect(state.feet.x).toBeGreaterThan(2.9 - CAPSULE_RADIUS - 0.05);
  });

  it('slides along a wall when walking into it diagonally', () => {
    const bvh = buildBVH([flatFloorGeom(), wallGeom(3)]);
    const state = createPlayerState(new THREE.Vector3(0, 0, -2));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    for (let i = 0; i < 300; i++) {
      // Moving toward +x (into the wall) and +z (along it) at once.
      stepPlayer(state, idleInput({ move: { x: 0.7071, z: 0.7071, magnitude: 1 } }), 1 / 60, bvh, OPEN_BOUNDS);
    }
    // Blocked in x by the wall, but still slid forward in z.
    expect(state.feet.x).toBeLessThan(3);
    expect(state.feet.z).toBeGreaterThan(-1);
  });

  it('jumping from grounded rises then lands back on the floor', () => {
    const bvh = buildBVH([flatFloorGeom()]);
    const state = createPlayerState(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    expect(state.grounded).toBe(true);

    stepPlayer(state, idleInput({ jumpRequested: true }), 1 / 60, bvh, OPEN_BOUNDS);
    expect(state.grounded).toBe(false);
    expect(state.velocity.y).toBeGreaterThan(0);

    let maxY = state.feet.y;
    for (let i = 0; i < 120; i++) {
      stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
      maxY = Math.max(maxY, state.feet.y);
    }
    expect(maxY).toBeGreaterThan(0.3);
    expect(state.grounded).toBe(true);
    expect(state.feet.y).toBeCloseTo(0, 1);
  });

  it('jumping while already airborne does nothing (no double jump)', () => {
    const bvh = buildBVH([flatFloorGeom()]);
    const state = createPlayerState(new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    stepPlayer(state, idleInput({ jumpRequested: true }), 1 / 60, bvh, OPEN_BOUNDS);
    stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    const velocityBeforeSecondJumpAttempt = state.velocity.y;
    stepPlayer(state, idleInput({ jumpRequested: true }), 1 / 60, bvh, OPEN_BOUNDS);
    // A second jump call while airborne should not add another JUMP_SPEED
    // impulse - velocity should have only continued falling under gravity.
    expect(state.velocity.y).toBeLessThan(velocityBeforeSecondJumpAttempt);
  });

  it('climbs a 12-step staircase with 0.18m risers without jumping', () => {
    // A flat landing platform past the top step, so the player has
    // somewhere to stand once they reach the top instead of walking off
    // into open air - the test cares about reaching the top, not about
    // what (if anything) is beyond it.
    const landing = new THREE.BoxGeometry(4, 0.2, 4);
    landing.translate(0, 12 * 0.18 - 0.1, 3.6 + 2);
    const geoms = [flatFloorGeom(), ...staircaseGeom(12, 0.18, 0.3), landing];
    const bvh = buildBVH(geoms);
    const state = createPlayerState(new THREE.Vector3(0, 0, -0.5));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    let maxY = state.feet.y;
    for (let i = 0; i < 600; i++) {
      stepPlayer(state, idleInput({ move: { x: 0, z: 1, magnitude: 1 } }), 1 / 60, bvh, OPEN_BOUNDS);
      maxY = Math.max(maxY, state.feet.y);
    }
    expect(maxY).toBeGreaterThan(12 * 0.18 - 0.1);
  });

  it('does not climb a 0.5m block (taller than MAX_STEP_HEIGHT)', () => {
    const blockGeom = new THREE.BoxGeometry(4, 0.5, 1);
    blockGeom.translate(0, 0.25, 1);
    const bvh = buildBVH([flatFloorGeom(), blockGeom]);
    const state = createPlayerState(new THREE.Vector3(0, 0, -1));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    for (let i = 0; i < 300; i++) {
      stepPlayer(state, idleInput({ move: { x: 0, z: 1, magnitude: 1 } }), 1 / 60, bvh, OPEN_BOUNDS);
    }
    expect(0.5).toBeGreaterThan(MAX_STEP_HEIGHT);
    expect(state.feet.y).toBeLessThan(0.3);
  });

  it('walks up a 30 degree ramp', () => {
    const bvh = buildBVH([rampGeom(30)]);
    const state = createPlayerState(new THREE.Vector3(0, 0, 0.1));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    // Tracks the peak height reached rather than the final position - a
    // 6m ramp at 2.5m/s is fully climbed well within 400 frames, and the
    // player then walks off the top into open air (there's nothing beyond
    // it in this test geometry) and falls, which isn't what this test is
    // checking.
    let maxY = state.feet.y;
    for (let i = 0; i < 400; i++) {
      stepPlayer(state, idleInput({ move: { x: 0, z: 1, magnitude: 1 } }), 1 / 60, bvh, OPEN_BOUNDS);
      maxY = Math.max(maxY, state.feet.y);
    }
    expect(maxY).toBeGreaterThan(0.3);
  });

  it('cannot walk up a 60 degree ramp (steeper than the wall/floor threshold)', () => {
    const bvh = buildBVH([rampGeom(60)]);
    const state = createPlayerState(new THREE.Vector3(0, 0, 0.1));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    for (let i = 0; i < 400; i++) {
      stepPlayer(state, idleInput({ move: { x: 0, z: 1, magnitude: 1 } }), 1 / 60, bvh, OPEN_BOUNDS);
    }
    expect(state.feet.y).toBeLessThan(0.3);
  });

  it('bounds clamp holds the player inside and zeroes outward velocity', () => {
    const bvh = buildBVH([flatFloorGeom(200)]);
    const bounds: PhysicsBounds = { min: new THREE.Vector3(-5, 0, -5), max: new THREE.Vector3(5, 0, 5) };
    const state = createPlayerState(new THREE.Vector3(4.9, 0, 0));
    for (let i = 0; i < 120; i++) {
      stepPlayer(state, idleInput({ move: { x: 1, z: 0, magnitude: 1 } }), 1 / 60, bvh, bounds);
    }
    expect(state.feet.x).toBeLessThanOrEqual(5 - CAPSULE_RADIUS + 1e-6);
    expect(state.velocity.x).toBeLessThanOrEqual(0);
  });

  it('respawns at the start spot after falling below bounds.min.y - 10', () => {
    const bvh = buildBVH([flatFloorGeom()]);
    const bounds: PhysicsBounds = { min: new THREE.Vector3(-100, 0, -100), max: new THREE.Vector3(100, 100, 100) };
    // A real start spot is always a valid, grounded floor position (it's
    // wherever the player clicked to begin walking) - so once respawned
    // there, the very next collision resolve should hold them there with
    // no further fall, unlike an arbitrary point floating above the floor.
    const start = new THREE.Vector3(5, 0, 5);
    const state = createPlayerState(start);
    // Force the player into open air far from the floor so gravity keeps them falling.
    state.feet.set(50, 3, 50);
    for (let i = 0; i < 400; i++) {
      stepPlayer(state, idleInput(), 1 / 60, bvh, bounds);
      if (state.feet.distanceTo(start) < 1e-6) break;
    }
    expect(state.feet.distanceTo(start)).toBeLessThan(1e-6);
    expect(state.grounded).toBe(true);
  });

  it('clamps a large delta so a fast approach does not tunnel through a thin wall', () => {
    const bvh = buildBVH([flatFloorGeom(), wallGeom(3, 10, 6, 0.2)]);
    const state = createPlayerState(new THREE.Vector3(2, 0, 0));
    for (let i = 0; i < 10; i++) stepPlayer(state, idleInput(), 1 / 60, bvh, OPEN_BOUNDS);
    // A full second in one call - internally clamped to MAX_FRAME_DT.
    stepPlayer(state, idleInput({ move: { x: 1, z: 0, magnitude: 1 }, speed: 50 }), 1.0, bvh, OPEN_BOUNDS);
    expect(state.feet.x).toBeLessThan(2.9);
  });
});
