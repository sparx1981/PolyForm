import * as THREE from 'three';

/**
 * Portal Navigation: click a vertical architectural surface (wall, window,
 * door) to traverse through it into the room/setting on the other side, with
 * camera framing (clearance, FOV, near-plane, eye height, yaw) calibrated
 * algorithmically on arrival. Pure geometry/math lives here so it can be
 * unit tested without a live WebGL context; Viewport.tsx wires it to actual
 * scene raycasting and the camera transition.
 */

export interface ResolvedSurfaceHit {
  worldPoint: THREE.Vector3;
  worldNormal: THREE.Vector3;
  hitObject: THREE.Object3D;
  isBackface: boolean;
}

/**
 * Resolves a raycast intersection to a world-space point/normal via the
 * hit object's matrixWorld, using the inverse-transpose (normalMatrix) so
 * normals stay correct under non-uniform scaling. A mirrored (negative
 * determinant) matrixWorld - common for symmetric door/window pairs
 * modeled once and mirrored - flips triangle winding, which would
 * otherwise invert the backface test; that's detected and corrected for
 * here rather than left to silently misclassify front/back on exactly the
 * geometry (mirrored pairs) most likely to hit it.
 */
export function resolveWorldHit(
  intersection: THREE.Intersection,
  rayDirection: THREE.Vector3
): ResolvedSurfaceHit | null {
  const mesh = intersection.object;
  if (!intersection.face) return null;
  mesh.updateWorldMatrix(true, false);

  const worldPoint = intersection.point.clone();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const worldNormal = intersection.face.normal.clone().applyMatrix3(normalMatrix).normalize();

  const alignment = rayDirection.dot(worldNormal);
  let isBackface = alignment > 0.0;
  if (mesh.matrixWorld.determinant() < 0) isBackface = !isBackface;
  if (isBackface) worldNormal.negate();

  return { worldPoint, worldNormal, hitObject: mesh, isBackface };
}

const COS_45 = Math.SQRT1_2; // cos(45deg) ~= 0.7071

/** Rejects floors/ceilings/steep roof pitches - only near-vertical surfaces are navigable. */
export function isNavigableSurface(worldNormal: THREE.Vector3): boolean {
  return Math.abs(worldNormal.y) <= COS_45 + 1e-6;
}

/**
 * Probes along the wall's own normal (not the, possibly oblique, click
 * ray) to find the far/finished face of the assembly the user clicked -
 * so measured wall thickness is a property of the wall, not of how
 * obliquely it was clicked. Falls back to the entry point itself for
 * zero-thickness planes/legacy single-surface geometry.
 */
export function resolveExitPoint(
  raycastRoots: THREE.Object3D[],
  enterHit: ResolvedSurfaceHit,
  maxWallThickness: number
): THREE.Vector3 {
  const raycaster = new THREE.Raycaster();
  const probeOrigin = enterHit.worldPoint.clone().addScaledVector(enterHit.worldNormal, 0.001);
  const probeDirection = enterHit.worldNormal.clone().negate();
  raycaster.set(probeOrigin, probeDirection);
  raycaster.near = 0.0;
  raycaster.far = maxWallThickness;

  const hits = raycaster.intersectObjects(raycastRoots, true);
  for (const hit of hits) {
    if (hit.object === enterHit.hitObject && hit.distance < 0.002) continue;
    if (!hit.face) continue;

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const candidateNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    // Anti-parallel verification: far-face normal must oppose the entering normal.
    if (candidateNormal.dot(enterHit.worldNormal) < -COS_45) {
      return hit.point.clone();
    }
  }
  return enterHit.worldPoint.clone();
}

/**
 * Drops a vertical probe from just inside the room to find the actual
 * floor height, since interior/exterior floor elevations aren't assumed
 * equal (split levels, raised foundations). Falls back to the camera's
 * current eye elevation when no qualifying horizontal face is found
 * (unfinished massing, open-air context).
 */
export function sampleFloorDatum(
  raycastRoots: THREE.Object3D[],
  exitPoint: THREE.Vector3,
  wallNormal: THREE.Vector3,
  fallbackY: number
): number {
  const probeOrigin = exitPoint.clone()
    .addScaledVector(wallNormal.clone().negate(), 0.3)
    .add(new THREE.Vector3(0, 1.0, 0));
  const raycaster = new THREE.Raycaster(probeOrigin, new THREE.Vector3(0, -1, 0), 0, 4.0);
  const hits = raycaster.intersectObjects(raycastRoots, true);
  for (const hit of hits) {
    if (!hit.face) continue;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const n = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (n.y >= 0.9) return hit.point.y;
  }
  return fallbackY;
}

export interface LandingResolution {
  eye: THREE.Vector3;
  clearanceUsed: number;
  obstructed: boolean;
}

const CLEARANCE_TIERS = [1.6, 1.0, 0.6, 0.3];

/**
 * Steps the standing distance from the exit face down through
 * [1.6m -> 1.0m -> 0.6m -> 0.3m] until an unobstructed landing point is
 * found (furniture, partitions, structural columns). The y-coordinate
 * always comes from the floor-sampled target height, never from the
 * exit point's own height - otherwise a high window click would land the
 * camera up near the ceiling instead of standing on the floor.
 */
export function resolveLandingPoint(
  raycastRoots: THREE.Object3D[],
  exitPoint: THREE.Vector3,
  wallNormal: THREE.Vector3,
  targetY: number,
  tiers: number[] = CLEARANCE_TIERS
): LandingResolution {
  const raycaster = new THREE.Raycaster();
  const testOrigin = new THREE.Vector3(exitPoint.x, targetY, exitPoint.z);
  const inward = wallNormal.clone().negate();

  for (const clearance of tiers) {
    const candidate = testOrigin.clone().addScaledVector(inward, clearance);
    const toCandidate = candidate.clone().sub(testOrigin);
    const dist = toCandidate.length();
    if (dist < 1e-4) return { eye: candidate, clearanceUsed: clearance, obstructed: false };

    raycaster.set(testOrigin, toCandidate.clone().normalize());
    raycaster.near = 0.01;
    raycaster.far = Math.max(0.02, dist - 0.05);
    const hits = raycaster.intersectObjects(raycastRoots, true).filter(h => h.object.userData?.isShape);
    if (hits.length === 0) {
      return { eye: candidate, clearanceUsed: clearance, obstructed: false };
    }
  }

  const smallest = tiers[tiers.length - 1];
  const fallback = testOrigin.clone().addScaledVector(inward, smallest);
  return { eye: fallback, clearanceUsed: smallest, obstructed: true };
}

/**
 * 8-ray horizontal sweep at both standing eye level and low-obstacle
 * level (desks, counters, kitchen islands), returning the nearest
 * boundary distance found at either elevation - drives the dynamic FOV
 * and near-clip calibration below.
 */
export function computeClearanceRadius(
  raycastRoots: THREE.Object3D[],
  targetEye: THREE.Vector3,
  dMax: number
): number {
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0.05;
  raycaster.far = dMax;
  let minRadius = dMax;

  const elevations = [0.0, -0.75];
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];

  for (const yOffset of elevations) {
    for (const deg of angles) {
      const rad = (deg * Math.PI) / 180;
      const direction = new THREE.Vector3(Math.sin(rad), 0, Math.cos(rad)).normalize();
      const origin = targetEye.clone().add(new THREE.Vector3(0, yOffset, 0));
      raycaster.set(origin, direction);
      const hits = raycaster.intersectObjects(raycastRoots, true);
      if (hits.length > 0 && hits[0].distance < minRadius) {
        minRadius = hits[0].distance;
      }
    }
  }
  return minRadius;
}

export interface FovParams {
  fovBase: number;
  fovWide: number;
  dMin: number;
  dMax: number;
}

export const DEFAULT_FOV_PARAMS: FovParams = { fovBase: 45.0, fovWide: 75.0, dMin: 0.8, dMax: 3.5 };

/** Wide angle in confined spaces, standard architectural framing once there's room to breathe. */
export function computeDynamicFov(clearanceRadius: number, params: FovParams = DEFAULT_FOV_PARAMS): number {
  const t = THREE.MathUtils.clamp((clearanceRadius - params.dMin) / (params.dMax - params.dMin), 0, 1);
  return params.fovWide + t * (params.fovBase - params.fovWide);
}

/** Keeps the near-clip plane just inside the measured clearance, bounded to a sane range. */
export function computeNearClip(clearanceRadius: number): number {
  return Math.max(0.01, Math.min(0.1, clearanceRadius * 0.25));
}

/** Camera-eye-to-hit-point direction, used as D_cam for yaw derivation. */
export function computeApproachDirection(camEye: THREE.Vector3, enterPoint: THREE.Vector3): THREE.Vector3 {
  return enterPoint.clone().sub(camEye).normalize();
}

/** Yaw only - pitch/roll are forced to zero so vertical building lines stay parallel to screen edges. */
export function computeYawFromDirection(direction: THREE.Vector3): number {
  return Math.atan2(direction.x, direction.z);
}

export interface PortalOrientation {
  target: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Builds a level (zero pitch/roll) look-at orientation at `eye` facing along `yaw`. */
export function buildPortalOrientation(eye: THREE.Vector3, yaw: number, focusDistance = 5): PortalOrientation {
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const target = eye.clone().addScaledVector(dir, focusDistance);
  const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0));
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { target, quaternion };
}

/** Cubic smoothstep easing: 3t^2 - 2t^3. */
export function smoothstep(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export interface PortalDestination {
  eye: THREE.Vector3;
  target: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
  near: number;
  obstructed: boolean;
}

export interface PortalDestinationParams {
  camEye: THREE.Vector3;
  maxWallThickness: number;
  eyeHeight: number;
  clearanceDMax: number;
  fovParams?: FovParams;
}

/**
 * Runs the full §4-§5 pipeline (cavity exit, floor datum, occupancy-tiered
 * landing, clearance-driven FOV/near, level yaw orientation) from a single
 * resolved entry hit. Shared by the actual click-to-travel handler and the
 * live hover preview so they can never disagree about where a click will
 * land.
 */
export function resolvePortalDestination(
  raycastRoots: THREE.Object3D[],
  enterHit: ResolvedSurfaceHit,
  params: PortalDestinationParams
): PortalDestination {
  const exitPoint = resolveExitPoint(raycastRoots, enterHit, params.maxWallThickness);
  const fallbackY = params.camEye.y;
  const floorY = sampleFloorDatum(raycastRoots, exitPoint, enterHit.worldNormal, fallbackY);
  const targetY = floorY + params.eyeHeight;

  const landing = resolveLandingPoint(raycastRoots, exitPoint, enterHit.worldNormal, targetY);
  const clearanceRadius = computeClearanceRadius(raycastRoots, landing.eye, params.clearanceDMax);
  const fov = computeDynamicFov(clearanceRadius, params.fovParams);
  const near = computeNearClip(clearanceRadius);

  const approach = computeApproachDirection(params.camEye, enterHit.worldPoint);
  const yaw = computeYawFromDirection(approach);
  const { target, quaternion } = buildPortalOrientation(landing.eye, yaw);

  return { eye: landing.eye, target, quaternion, fov, near, obstructed: landing.obstructed };
}
