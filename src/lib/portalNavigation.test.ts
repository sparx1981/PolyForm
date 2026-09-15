import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  resolveWorldHit,
  isNavigableSurface,
  isFloorSurface,
  resolveExitPoint,
  sampleFloorDatum,
  resolveLandingPoint,
  resolveFloorLanding,
  computeClearanceRadius,
  computeDynamicFov,
  computeNearClip,
  computeYawFromDirection,
  buildPortalOrientation,
  smoothstep,
  resolvePortalDestination,
  resolvePortalDestinationForFloor,
  type ResolvedSurfaceHit,
} from './portalNavigation';

// Double-sided so these synthetic test planes register raycast hits from
// either side regardless of which way their authored normal happens to
// face - the tests care about hit distance/position, not real front-face
// culling semantics (resolveExitPoint's anti-parallel check still reads
// the geometry's own authored normal either way, unaffected by this).
function testMaterial() {
  return new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
}

function markShape(mesh: THREE.Mesh, id: string) {
  mesh.userData = { isShape: true, id };
  return mesh;
}

function wallPair(thickness: number, center = new THREE.Vector3(0, 1.5, 0)) {
  // Two facing planes standing in for a solid wall's front (exterior) and
  // back (interior) finished faces, `thickness` apart along Z. A solid
  // slab's two outward face normals point AWAY from each other - front's
  // outward normal is -Z, back's is +Z (PlaneGeometry's own default,
  // unrotated) - not toward each other, which is what "anti-parallel"
  // means physically.
  const front = markShape(
    new THREE.Mesh(new THREE.PlaneGeometry(4, 3), testMaterial()),
    'wall-front'
  );
  front.position.copy(center).setZ(center.z - thickness / 2);
  front.rotateY(Math.PI); // default +Z normal -> -Z, facing the approaching camera
  front.updateMatrixWorld(true);

  const back = markShape(
    new THREE.Mesh(new THREE.PlaneGeometry(4, 3), testMaterial()),
    'wall-back'
  );
  back.position.copy(center).setZ(center.z + thickness / 2);
  back.updateMatrixWorld(true); // default +Z normal, pointing further into the room

  return { front, back };
}

function floorMesh(y = 0) {
  const floor = markShape(new THREE.Mesh(new THREE.PlaneGeometry(20, 20), testMaterial()), 'floor');
  floor.rotateX(-Math.PI / 2);
  floor.position.set(0, y, 3);
  floor.updateMatrixWorld(true);
  return floor;
}

describe('isNavigableSurface', () => {
  it('accepts vertical wall normals', () => {
    expect(isNavigableSurface(new THREE.Vector3(0, 0, 1))).toBe(true);
    expect(isNavigableSurface(new THREE.Vector3(1, 0, 0))).toBe(true);
  });

  it('rejects floor/ceiling normals', () => {
    expect(isNavigableSurface(new THREE.Vector3(0, 1, 0))).toBe(false);
    expect(isNavigableSurface(new THREE.Vector3(0, -1, 0))).toBe(false);
  });

  it('rejects steep roof pitches beyond 45 degrees from vertical', () => {
    // A slope closer to horizontal than 45deg from vertical - normal.y > cos(45)
    const steepRoof = new THREE.Vector3(0, 0.9, Math.sqrt(1 - 0.81)).normalize();
    expect(isNavigableSurface(steepRoof)).toBe(false);
  });

  it('accepts a wall pitched right at the 45 degree boundary', () => {
    const boundary = new THREE.Vector3(0, Math.SQRT1_2, Math.SQRT1_2);
    expect(isNavigableSurface(boundary)).toBe(true);
  });
});

describe('resolveWorldHit', () => {
  it('resolves world point/normal and flips a backface hit to face the camera', () => {
    const mesh = markShape(new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), 'w1');
    mesh.updateMatrixWorld(true);
    // PlaneGeometry's default normal is +Z.
    const face = { normal: new THREE.Vector3(0, 0, 1) } as THREE.Face;
    const intersection = {
      object: mesh,
      face,
      point: new THREE.Vector3(0, 0, 0),
    } as unknown as THREE.Intersection;

    // Ray traveling in +Z hits the front face's back side (backface).
    const rayDir = new THREE.Vector3(0, 0, 1);
    const hit = resolveWorldHit(intersection, rayDir)!;
    expect(hit.isBackface).toBe(true);
    // Normal gets flipped to oppose the ray (point back toward the camera).
    expect(hit.worldNormal.z).toBeCloseTo(-1, 5);
  });

  it('does not flip a front-facing hit', () => {
    const mesh = markShape(new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), 'w1');
    mesh.updateMatrixWorld(true);
    const face = { normal: new THREE.Vector3(0, 0, 1) } as THREE.Face;
    const intersection = {
      object: mesh,
      face,
      point: new THREE.Vector3(0, 0, 0),
    } as unknown as THREE.Intersection;

    // Ray traveling in -Z hits the true front face.
    const rayDir = new THREE.Vector3(0, 0, -1);
    const hit = resolveWorldHit(intersection, rayDir)!;
    expect(hit.isBackface).toBe(false);
    expect(hit.worldNormal.z).toBeCloseTo(1, 5);
  });

  it('inverts the backface reading for a mirrored (negative-determinant) component', () => {
    const plain = markShape(new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), 'plain');
    plain.updateMatrixWorld(true);

    const mirrored = markShape(new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), 'mirrored');
    mirrored.scale.x = -1; // negative determinant - a mirrored door/window pair
    mirrored.updateMatrixWorld(true);
    expect(mirrored.matrixWorld.determinant()).toBeLessThan(0);

    const face = { normal: new THREE.Vector3(0, 0, 1) } as THREE.Face;
    const rayDir = new THREE.Vector3(0, 0, 1);
    const makeIntersection = (object: THREE.Object3D) =>
      ({ object, face, point: new THREE.Vector3(0, 0, 0) }) as unknown as THREE.Intersection;

    const plainHit = resolveWorldHit(makeIntersection(plain), rayDir)!;
    const mirroredHit = resolveWorldHit(makeIntersection(mirrored), rayDir)!;

    // Identical face normal and ray direction, differing only by the
    // mirror - the mirrored component's backface classification must
    // come out inverted relative to the plain one.
    expect(mirroredHit.isBackface).toBe(!plainHit.isBackface);
  });

  it('returns null when the intersection has no face', () => {
    const mesh = markShape(new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), 'w1');
    const intersection = { object: mesh, point: new THREE.Vector3() } as unknown as THREE.Intersection;
    expect(resolveWorldHit(intersection, new THREE.Vector3(0, 0, 1))).toBeNull();
  });
});

describe('resolveExitPoint', () => {
  it('finds the anti-parallel far face of a two-leaf wall assembly', () => {
    const { front, back } = wallPair(0.2);
    const enterHit: ResolvedSurfaceHit = {
      worldPoint: front.position.clone(),
      worldNormal: new THREE.Vector3(0, 0, -1),
      hitObject: front,
      isBackface: false,
    };
    const exit = resolveExitPoint([front, back], enterHit, 0.6);
    expect(exit.z).toBeCloseTo(back.position.z, 3);
  });

  it('falls back to the entry point for zero-thickness/single-surface geometry', () => {
    const { front } = wallPair(0.2);
    const enterHit: ResolvedSurfaceHit = {
      worldPoint: front.position.clone(),
      worldNormal: new THREE.Vector3(0, 0, -1),
      hitObject: front,
      isBackface: false,
    };
    const exit = resolveExitPoint([front], enterHit, 0.6);
    expect(exit.equals(enterHit.worldPoint)).toBe(true);
  });
});

describe('sampleFloorDatum', () => {
  it('finds a floor below the exit point', () => {
    const floor = floorMesh(0);
    const exitPoint = new THREE.Vector3(0, 1.5, 0.1);
    const wallNormal = new THREE.Vector3(0, 0, -1);
    const y = sampleFloorDatum([floor], exitPoint, wallNormal, 99);
    expect(y).toBeCloseTo(0, 3);
  });

  it('falls back to the given elevation when no horizontal face is found', () => {
    const exitPoint = new THREE.Vector3(0, 1.5, 0.1);
    const wallNormal = new THREE.Vector3(0, 0, -1);
    const y = sampleFloorDatum([], exitPoint, wallNormal, 42);
    expect(y).toBe(42);
  });
});

describe('resolveLandingPoint', () => {
  it('lands at the widest clearance tier when unobstructed', () => {
    const exitPoint = new THREE.Vector3(0, 1.6, 0);
    const wallNormal = new THREE.Vector3(0, 0, -1);
    const result = resolveLandingPoint([], exitPoint, wallNormal, 1.6);
    expect(result.obstructed).toBe(false);
    expect(result.clearanceUsed).toBe(1.6);
    expect(result.eye.y).toBe(1.6);
    // Steps inward (opposite the wall normal) from the exit point.
    expect(result.eye.z).toBeGreaterThan(exitPoint.z);
  });

  it('steps down through tiers when the widest ones are obstructed', () => {
    // A blocking wall placed 0.5m inside the room - the 1.6m and 1.0m
    // tiers should be rejected, landing at 0.3m instead.
    const blocker = markShape(new THREE.Mesh(new THREE.PlaneGeometry(4, 3), testMaterial()), 'blocker');
    blocker.position.set(0, 1.6, 0.5);
    blocker.updateMatrixWorld(true);

    const exitPoint = new THREE.Vector3(0, 1.6, 0);
    const wallNormal = new THREE.Vector3(0, 0, -1);
    const result = resolveLandingPoint([blocker], exitPoint, wallNormal, 1.6, [1.6, 1.0, 0.6, 0.3]);
    expect(result.clearanceUsed).toBe(0.3);
    expect(result.obstructed).toBe(false);
  });

  it('reports obstructed when every tier is blocked', () => {
    const blocker = markShape(new THREE.Mesh(new THREE.PlaneGeometry(4, 3), testMaterial()), 'blocker');
    blocker.position.set(0, 1.6, 0.05);
    blocker.updateMatrixWorld(true);

    const exitPoint = new THREE.Vector3(0, 1.6, 0);
    const wallNormal = new THREE.Vector3(0, 0, -1);
    const result = resolveLandingPoint([blocker], exitPoint, wallNormal, 1.6, [1.6, 1.0, 0.6, 0.3]);
    expect(result.obstructed).toBe(true);
  });
});

describe('computeClearanceRadius', () => {
  it('returns dMax in open space', () => {
    const r = computeClearanceRadius([], new THREE.Vector3(0, 1.6, 0), 3.5);
    expect(r).toBe(3.5);
  });

  it('finds the nearest wall in a small room', () => {
    const wall = markShape(new THREE.Mesh(new THREE.PlaneGeometry(4, 3), testMaterial()), 'near-wall');
    wall.position.set(0, 1.6, 1.0);
    wall.updateMatrixWorld(true);
    const r = computeClearanceRadius([wall], new THREE.Vector3(0, 1.6, 0), 3.5);
    expect(r).toBeCloseTo(1.0, 1);
  });
});

describe('computeDynamicFov / computeNearClip', () => {
  it('uses the wide FOV in confined spaces', () => {
    expect(computeDynamicFov(0.8)).toBeCloseTo(75, 5);
  });

  it('uses the base FOV once there is standard framing room', () => {
    expect(computeDynamicFov(3.5)).toBeCloseTo(45, 5);
  });

  it('interpolates between wide and base FOV', () => {
    const mid = computeDynamicFov((0.8 + 3.5) / 2);
    expect(mid).toBeGreaterThan(45);
    expect(mid).toBeLessThan(75);
  });

  it('clamps near-clip to [0.01, 0.1]', () => {
    expect(computeNearClip(0.0)).toBeCloseTo(0.01, 5);
    expect(computeNearClip(10)).toBeCloseTo(0.1, 5);
    expect(computeNearClip(0.2)).toBeCloseTo(0.05, 5);
  });
});

describe('computeYawFromDirection / buildPortalOrientation', () => {
  it('produces a level (zero pitch/roll) orientation', () => {
    const eye = new THREE.Vector3(1, 1.6, 2);
    const yaw = computeYawFromDirection(new THREE.Vector3(0, -0.9, 1).normalize());
    const { target, quaternion } = buildPortalOrientation(eye, yaw);
    expect(target.y).toBeCloseTo(eye.y, 5);
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    expect(euler.x).toBeCloseTo(0, 5);
    expect(euler.z).toBeCloseTo(0, 5);
  });
});

describe('smoothstep', () => {
  it('is 0 at t=0 and 1 at t=1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it('clamps outside [0,1]', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });

  it('eases through the midpoint', () => {
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('resolvePortalDestination (integration)', () => {
  it('composes exit/floor/clearance/orientation into a full destination', () => {
    const { front, back } = wallPair(0.2, new THREE.Vector3(0, 1.5, -1));
    const floor = floorMesh(0);
    const roots = [front, back, floor];

    const camEye = new THREE.Vector3(0, 1.6, -3);
    const enterHit: ResolvedSurfaceHit = {
      worldPoint: front.position.clone(),
      worldNormal: new THREE.Vector3(0, 0, -1),
      hitObject: front,
      isBackface: false,
    };

    const dest = resolvePortalDestination(roots, enterHit, {
      camEye,
      maxWallThickness: 0.6,
      eyeHeight: 1.6,
      clearanceDMax: 3.5,
    });

    // Landed on the floor's actual height (0) + eye height, not the wall
    // click's own height.
    expect(dest.eye.y).toBeCloseTo(1.6, 3);
    // Stepped through the wall to the far side.
    expect(dest.eye.z).toBeGreaterThan(back.position.z - 0.01);
    expect(dest.fov).toBeGreaterThan(0);
    expect(dest.near).toBeGreaterThanOrEqual(0.01);
    expect(dest.obstructed).toBe(false);
  });
});

describe('isFloorSurface', () => {
  it('accepts an upward-facing horizontal surface', () => {
    expect(isFloorSurface(new THREE.Vector3(0, 1, 0))).toBe(true);
  });

  it('rejects a downward-facing (ceiling) surface', () => {
    expect(isFloorSurface(new THREE.Vector3(0, -1, 0))).toBe(false);
  });

  it('rejects vertical wall normals', () => {
    expect(isFloorSurface(new THREE.Vector3(0, 0, 1))).toBe(false);
  });
});

describe('resolveFloorLanding', () => {
  it('stands directly above the clicked point at eye height in open space', () => {
    const eye = resolveFloorLanding([], new THREE.Vector3(2, 0, 3), 1.6);
    expect(eye.x).toBeCloseTo(2, 5);
    expect(eye.y).toBeCloseTo(1.6, 5);
    expect(eye.z).toBeCloseTo(3, 5);
  });

  it('nudges away from a wall right next to the clicked floor point', () => {
    // A wall 0.1m from the click - well inside the personal-space radius,
    // exactly the "clicked near a corner" scenario that used to land the
    // camera embedded in the wall.
    const wall = markShape(new THREE.Mesh(new THREE.PlaneGeometry(4, 3), testMaterial()), 'near-wall');
    wall.position.set(0, 1.6, 0.1);
    wall.updateMatrixWorld(true);

    const eye = resolveFloorLanding([wall], new THREE.Vector3(0, 0, 0), 1.6);
    // Pushed away from the wall (to more negative Z).
    expect(eye.z).toBeLessThan(0.1 - 0.34);
  });
});

describe('resolvePortalDestinationForFloor (integration)', () => {
  it('lands directly on a clicked floor point with a valid orientation', () => {
    const floor = floorMesh(0);
    const floorHit: ResolvedSurfaceHit = {
      worldPoint: new THREE.Vector3(1, 0, 2),
      worldNormal: new THREE.Vector3(0, 1, 0),
      hitObject: floor,
      isBackface: false,
    };
    const camEye = new THREE.Vector3(1, 3, -1);

    const dest = resolvePortalDestinationForFloor([floor], floorHit, {
      camEye,
      eyeHeight: 1.6,
      clearanceDMax: 3.5,
    });

    expect(dest.eye.x).toBeCloseTo(1, 3);
    expect(dest.eye.y).toBeCloseTo(1.6, 3);
    expect(dest.eye.z).toBeCloseTo(2, 3);
    expect(dest.obstructed).toBe(false);
    expect(dest.fov).toBeGreaterThan(0);
  });
});
