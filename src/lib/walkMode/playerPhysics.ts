import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { isFloorSurface } from '../portalNavigation';
import {
  PLAYER_HEIGHT,
  CAPSULE_RADIUS,
  MAX_STEP_HEIGHT,
  GRAVITY,
  JUMP_SPEED,
  GROUND_ACCEL,
  GROUND_DAMPING,
  AIR_CONTROL,
  PHYSICS_SUBSTEPS,
  MAX_FRAME_DT,
  FALL_RESPAWN_DEPTH,
} from './constants';
import type { MoveIntent } from './inputState';

/** A tiny sustained downward speed while grounded keeps the capsule pressed onto downward ramps/stairs instead of momentarily going airborne on every step down (spec §7.5 step 4). */
const GROUND_STICK_SPEED = 1.5;
/** How close consecutive collision-resolve passes must get before we stop iterating within one substep (spec §7.5's "collision resolve"). */
const RESOLVE_SETTLE_EPS = 1e-4;
const RESOLVE_ITERATIONS = 3;

export interface PhysicsBounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface PlayerState {
  feet: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  /** Camera Y offset above `feet.y + EYE_HEIGHT`, eased toward 0 after a step-up so stairs don't feel jerky (spec §7.5 step 5). Never affects `feet` itself. */
  cameraYOffset: number;
  startSpot: THREE.Vector3;
}

export function createPlayerState(startFeet: THREE.Vector3): PlayerState {
  return {
    feet: startFeet.clone(),
    velocity: new THREE.Vector3(),
    grounded: false,
    cameraYOffset: 0,
    startSpot: startFeet.clone(),
  };
}

interface ContactInfo {
  direction: THREE.Vector3;
}

interface ResolveResult {
  contacts: ContactInfo[];
  totalPush: number;
}

// Scratch objects reused across every call so the physics loop never
// allocates per frame (spec §9).
const _segment = new THREE.Line3();
const _box = new THREE.Box3();
const _triPoint = new THREE.Vector3();
const _capsulePoint = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wishDir = new THREE.Vector3();
const _preMoveFeet = new THREE.Vector3();
const _liftedFeet = new THREE.Vector3();
const _downRay = new THREE.Ray();
const _rayOrigin = new THREE.Vector3();
const contactPool: ContactInfo[] = Array.from({ length: 8 }, () => ({ direction: new THREE.Vector3() }));

/**
 * Resolves capsule-vs-BVH overlap by iteratively pushing the capsule
 * segment out of any triangle within `CAPSULE_RADIUS`, re-deriving the
 * capsule's AABB after each push so later triangles test against the
 * corrected position (spec §7.5's "Collision resolve" - the standard
 * three-mesh-bvh capsule pattern).
 */
function resolveCapsuleCollisions(bvh: MeshBVH, feet: THREE.Vector3): ResolveResult {
  _segment.start.set(feet.x, feet.y + CAPSULE_RADIUS, feet.z);
  _segment.end.set(feet.x, feet.y + PLAYER_HEIGHT - CAPSULE_RADIUS, feet.z);

  let contactCount = 0;
  let totalPush = 0;

  for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
    _box.makeEmpty();
    _box.expandByPoint(_segment.start);
    _box.expandByPoint(_segment.end);
    _box.min.addScalar(-CAPSULE_RADIUS);
    _box.max.addScalar(CAPSULE_RADIUS);

    let pushedThisIteration = 0;

    bvh.shapecast({
      intersectsBounds: (bounds) => bounds.intersectsBox(_box),
      intersectsTriangle: (tri: any) => {
        const distance = tri.closestPointToSegment(_segment, _triPoint, _capsulePoint);
        if (distance < CAPSULE_RADIUS) {
          const depth = CAPSULE_RADIUS - distance;
          _direction.copy(_capsulePoint).sub(_triPoint);
          if (_direction.lengthSq() < 1e-12) _direction.set(0, 1, 0);
          else _direction.normalize();
          _segment.start.addScaledVector(_direction, depth);
          _segment.end.addScaledVector(_direction, depth);
          pushedThisIteration += depth;
          if (contactCount < contactPool.length) {
            contactPool[contactCount].direction.copy(_direction);
            contactCount++;
          }
        }
      },
    });

    totalPush += pushedThisIteration;
    if (pushedThisIteration < RESOLVE_SETTLE_EPS) break;
  }

  feet.set(_segment.start.x, _segment.start.y - CAPSULE_RADIUS, _segment.start.z);
  return { contacts: contactPool.slice(0, contactCount), totalPush };
}

/**
 * Placement validity check (spec §5.2 step 3): places a standing capsule
 * with its feet at `feetPoint`, resolves once, and reports whether it fit
 * without a significant push-out (a low ceiling, or a spot too close to a
 * wall to actually stand in).
 */
export function checkCapsuleFits(bvh: MeshBVH, feetPoint: THREE.Vector3): boolean {
  const testFeet = feetPoint.clone();
  const { totalPush } = resolveCapsuleCollisions(bvh, testFeet);
  return totalPush <= MAX_STEP_HEIGHT;
}

/** Forward/right basis from a yaw matching buildPortalOrientation's convention (dir = sin(yaw), 0, cos(yaw)). */
function computeWishDirection(move: MoveIntent, yaw: number, out: THREE.Vector3): THREE.Vector3 {
  _forward.set(Math.sin(yaw), 0, Math.cos(yaw));
  _right.set(_forward.z, 0, -_forward.x);
  return out.copy(_forward).multiplyScalar(move.z).addScaledVector(_right, move.x);
}

export interface StepInput {
  move: MoveIntent;
  jumpRequested: boolean;
  cameraYaw: number;
  speed: number;
}

/**
 * Advances `state` by `rawDt` seconds against `bvh`/`bounds`, running
 * PHYSICS_SUBSTEPS fixed substeps per the algorithm in spec §7.5. Mutates
 * `state` in place; `jumpRequested` is only actually consumed on the first
 * grounded substep it's available for; callers should have already
 * one-shot-consumed it from their input source before calling this.
 */
export function stepPlayer(state: PlayerState, input: StepInput, rawDt: number, bvh: MeshBVH, bounds: PhysicsBounds): void {
  const clampedDt = Math.min(rawDt, MAX_FRAME_DT);
  const substepDt = clampedDt / PHYSICS_SUBSTEPS;
  let jumpAvailable = input.jumpRequested;

  for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
    computeWishDirection(input.move, input.cameraYaw, _wishDir);
    const targetX = _wishDir.x * input.speed;
    const targetZ = _wishDir.z * input.speed;
    const hasInput = input.move.x !== 0 || input.move.z !== 0;

    if (hasInput) {
      const accelRate = state.grounded ? GROUND_ACCEL : GROUND_ACCEL * AIR_CONTROL;
      const t = 1 - Math.exp(-accelRate * substepDt);
      state.velocity.x += (targetX - state.velocity.x) * t;
      state.velocity.z += (targetZ - state.velocity.z) * t;
    } else if (state.grounded) {
      const decay = Math.exp(-GROUND_DAMPING * substepDt);
      state.velocity.x *= decay;
      state.velocity.z *= decay;
    }

    if (state.grounded && jumpAvailable) {
      state.velocity.y = JUMP_SPEED;
      state.grounded = false;
      jumpAvailable = false;
    }

    if (!state.grounded) {
      state.velocity.y -= GRAVITY * substepDt;
    } else {
      state.velocity.y = -GROUND_STICK_SPEED;
    }

    _preMoveFeet.copy(state.feet);
    state.feet.addScaledVector(state.velocity, substepDt);

    let { contacts } = resolveCapsuleCollisions(bvh, state.feet);

    // Step-up assist: only when the horizontal move was actually blocked
    // by a non-floor (wall-type) contact while grounded (spec §7.5's
    // "Step-up assist").
    const blockedByWall = state.grounded && contacts.some((c) => !isFloorSurface(c.direction));
    if (blockedByWall) {
      const stepUp = tryStepUp(bvh, _preMoveFeet, _wishDir);
      if (stepUp) {
        const cameraRise = stepUp.feet.y - state.feet.y;
        state.feet.copy(stepUp.feet);
        contacts = stepUp.contacts;
        // Ease the CAMERA (not the feet) up over ~80ms - see the constant's
        // own doc comment and WalkModeController, which decays this back
        // toward 0 every frame.
        state.cameraYOffset -= cameraRise;
      }
    }

    let grounded = false;
    for (const contact of contacts) {
      if (isFloorSurface(contact.direction)) {
        grounded = true;
      } else {
        const vn = state.velocity.dot(contact.direction);
        if (vn < 0) state.velocity.addScaledVector(contact.direction, -vn);
      }
    }
    state.grounded = grounded;
    if (grounded) state.velocity.y = Math.max(state.velocity.y, 0);

    clampToBounds(state, bounds);

    if (state.feet.y < bounds.min.y - FALL_RESPAWN_DEPTH) {
      state.feet.copy(state.startSpot);
      state.velocity.set(0, 0, 0);
      state.grounded = false;
      state.cameraYOffset = 0;
    }
  }
}

function clampToBounds(state: PlayerState, bounds: PhysicsBounds): void {
  const minX = bounds.min.x + CAPSULE_RADIUS;
  const maxX = bounds.max.x - CAPSULE_RADIUS;
  const minZ = bounds.min.z + CAPSULE_RADIUS;
  const maxZ = bounds.max.z - CAPSULE_RADIUS;

  if (minX >= maxX) {
    state.feet.x = (bounds.min.x + bounds.max.x) / 2;
    state.velocity.x = 0;
  } else if (state.feet.x < minX) {
    state.feet.x = minX;
    if (state.velocity.x < 0) state.velocity.x = 0;
  } else if (state.feet.x > maxX) {
    state.feet.x = maxX;
    if (state.velocity.x > 0) state.velocity.x = 0;
  }

  if (minZ >= maxZ) {
    state.feet.z = (bounds.min.z + bounds.max.z) / 2;
    state.velocity.z = 0;
  } else if (state.feet.z < minZ) {
    state.feet.z = minZ;
    if (state.velocity.z < 0) state.velocity.z = 0;
  } else if (state.feet.z > maxZ) {
    state.feet.z = maxZ;
    if (state.velocity.z > 0) state.velocity.z = 0;
  }
}

interface StepUpResult {
  feet: THREE.Vector3;
  contacts: ContactInfo[];
}

/**
 * How far past a blocking contact to probe, horizontally, when trying a
 * step-up (spec §7.5 "Step-up assist"). This is NOT tied to the current
 * substep's velocity: by the time a contact blocks forward motion, the
 * wall-slide/damping in the same substep has typically already reduced
 * the actual velocity toward zero in that direction, so a probe scaled by
 * `velocity * substepDt` would only ever cover a fraction of a millimeter
 * and could never reach past the wall onto the next tread - a real bug
 * caught by playerPhysics.test.ts's staircase-climbing case, which never
 * made any progress at all before this was a fixed distance. A capsule
 * touching a wall is, by construction, within CAPSULE_RADIUS of it, so
 * probing a bit further than that reliably lands past the corner.
 */
const STEP_UP_PROBE_DISTANCE = CAPSULE_RADIUS + 0.1;

/** See spec §7.5 "Step-up assist". Lifts, probes forward past the blocking contact, resolves, then confirms with a downward raycast that the landing is a real, close-enough floor before accepting it. */
function tryStepUp(bvh: MeshBVH, preMoveFeet: THREE.Vector3, wishDir: THREE.Vector3): StepUpResult | null {
  const dirLengthSq = wishDir.x * wishDir.x + wishDir.z * wishDir.z;
  if (dirLengthSq < 1e-8) return null;
  const invLen = STEP_UP_PROBE_DISTANCE / Math.sqrt(dirLengthSq);

  _liftedFeet.set(
    preMoveFeet.x + wishDir.x * invLen,
    preMoveFeet.y + MAX_STEP_HEIGHT,
    preMoveFeet.z + wishDir.z * invLen
  );

  const { contacts } = resolveCapsuleCollisions(bvh, _liftedFeet);

  _rayOrigin.set(_liftedFeet.x, _liftedFeet.y + CAPSULE_RADIUS + 0.02, _liftedFeet.z);
  _downRay.origin.copy(_rayOrigin);
  _downRay.direction.set(0, -1, 0);
  const hit = bvh.raycastFirst(_downRay, THREE.DoubleSide, 0, MAX_STEP_HEIGHT + 0.05 + CAPSULE_RADIUS + 0.02);
  if (!hit || !hit.face) return null;

  const normal = hit.face.normal;
  if (!isFloorSurface(normal)) return null;

  const rise = hit.point.y - preMoveFeet.y;
  if (rise <= 0 || rise > MAX_STEP_HEIGHT) return null;

  const landedFeet = _liftedFeet.clone();
  landedFeet.y = hit.point.y;
  // A modest push here is normal and expected, not a rejection reason: a
  // tread only slightly deeper than the capsule's diameter (common on
  // real staircases, where CAPSULE_RADIUS*2 and a typical tread depth are
  // similar) means standing anywhere on it will brush the next riser up
  // ahead, and resolveCapsuleCollisions correcting that small horizontal
  // overlap is exactly what it's for. Only a large push - suggesting the
  // capsule doesn't actually fit here at all (e.g. a low ceiling) - should
  // disqualify the landing.
  const { totalPush } = resolveCapsuleCollisions(bvh, landedFeet);
  if (totalPush > CAPSULE_RADIUS) return null;

  return { feet: landedFeet, contacts };
}
