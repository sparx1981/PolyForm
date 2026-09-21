import * as THREE from 'three';

/**
 * Portal Navigation: click a vertical architectural surface (wall, window,
 * door) to traverse through it into the room/setting on the other side, with
 * camera framing (clearance, FOV, near-plane, eye height, yaw) calibrated
 * algorithmically on arrival. Pure geometry/math lives here so it can be
 * unit tested without a live WebGL context; Viewport.tsx wires it to actual
 * scene raycasting and the camera transition.
 */

/** Shared standing eye height, also used by Walk Mode (src/lib/walkMode/constants.ts) so the two features agree on where "standing" puts your eyes. */
export const PORTAL_EYE_HEIGHT = 1.6;

export interface ResolvedSurfaceHit {
  worldPoint: THREE.Vector3;
  worldNormal: THREE.Vector3;
  hitObject: THREE.Object3D;
  isBackface: boolean;
}

/** Only rendered architectural meshes participate; editor helpers never do. */
export function isPortalSurface(object: THREE.Object3D): boolean {
  if (!object.userData?.isShape && !object.userData?.isKernelGeometry) return false;
  for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
    if (!parent.visible) return false;
  }
  return true;
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
  // Mirroring changes winding metadata, not which side the viewer is on.
  if (alignment > 0) worldNormal.negate();

  return { worldPoint, worldNormal, hitObject: mesh, isBackface };
}

const COS_45 = Math.SQRT1_2; // cos(45deg) ~= 0.7071

/** Rejects floors/ceilings/steep roof pitches - only near-vertical surfaces are navigable as walls. */
export function isNavigableSurface(worldNormal: THREE.Vector3): boolean {
  return Math.abs(worldNormal.y) <= COS_45 + 1e-6;
}

/** An upward-facing horizontal-enough surface to stand on directly (a floor, not a ceiling). */
export function isFloorSurface(worldNormal: THREE.Vector3): boolean {
  return worldNormal.y > COS_45 + 1e-6;
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
  // Approach the exit from outside the wall. Looking from the entry into
  // the solid misses the exit entirely with normal FrontSide materials.
  const probeOrigin = enterHit.worldPoint.clone().addScaledVector(enterHit.worldNormal, -maxWallThickness);
  const probeDirection = enterHit.worldNormal.clone();
  raycaster.set(probeOrigin, probeDirection);
  raycaster.near = 0.0;
  raycaster.far = maxWallThickness;

  const hits = raycaster.intersectObjects(raycastRoots, true);
  for (const hit of hits.reverse()) {
    if (hit.point.distanceTo(enterHit.worldPoint) < 0.002) continue;
    if (!hit.face || !isPortalSurface(hit.object)) continue;

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
 *
 * Deliberately does NOT restrict hits to `userData.isShape` the way the
 * other probes in this module do: stepping through an exterior wall into
 * an unmodeled yard/terrain should still land on the app's generic
 * ground plane, which - unlike an authored floor/roof Shape - was never
 * tagged as one.
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

// Only tried as a fallback, once every tier has already failed straight
// in along the wall's own normal - see the second pass below. This
// specifically rescues the "standing right in a room corner" case: an
// entry point right next to a perpendicular wall has that adjacent wall
// immediately in front along every tier's straight-in ray, even though the
// room has plenty of open floor just off to one side. Without this, a
// second teleport click from such a spot can spuriously report every tier
// obstructed and reject the click outright.
const LANDING_OFF_AXIS_ANGLES_DEG = [20, -20, 40, -40];

function landingCandidate(
  raycastRoots: THREE.Object3D[],
  testOrigin: THREE.Vector3,
  direction: THREE.Vector3,
  clearance: number
): { eye: THREE.Vector3; clear: boolean } {
  const raycaster = new THREE.Raycaster();
  const candidate = testOrigin.clone().addScaledVector(direction, clearance);
  const toCandidate = candidate.clone().sub(testOrigin);
  const dist = toCandidate.length();
  if (dist < 1e-4) return { eye: candidate, clear: true };

  raycaster.set(testOrigin, toCandidate.clone().normalize());
  raycaster.near = 0.01;
  // Test the full distance to the candidate (not a shortened one) - an
  // off-axis ray's forward reach shrinks as its angle from the wall normal
  // grows, so shortening `far` risked stopping just short of a thin
  // obstruction the candidate point actually sits behind.
  raycaster.far = dist;
  const hits = raycaster.intersectObjects(raycastRoots, true).filter(h => isPortalSurface(h.object));
  return { eye: candidate, clear: hits.length === 0 };
}

/**
 * Steps the standing distance from the exit face down through
 * [1.6m -> 1.0m -> 0.6m -> 0.3m] until an unobstructed landing point is
 * found (furniture, partitions, structural columns). If every tier is
 * blocked straight ahead, a second pass fans out to a few off-axis angles
 * at each tier before giving up, to escape a room corner's adjacent wall.
 * The y-coordinate always comes from the floor-sampled target height,
 * never from the exit point's own height - otherwise a high window click
 * would land the camera up near the ceiling instead of standing on the
 * floor.
 */
export function resolveLandingPoint(
  raycastRoots: THREE.Object3D[],
  exitPoint: THREE.Vector3,
  wallNormal: THREE.Vector3,
  targetY: number,
  tiers: number[] = CLEARANCE_TIERS
): LandingResolution {
  const testOrigin = new THREE.Vector3(exitPoint.x, targetY, exitPoint.z);
  const inward = wallNormal.clone().negate();

  for (const clearance of tiers) {
    const result = landingCandidate(raycastRoots, testOrigin, inward, clearance);
    if (result.clear) return { eye: result.eye, clearanceUsed: clearance, obstructed: false };
  }

  for (const clearance of tiers) {
    for (const angleDeg of LANDING_OFF_AXIS_ANGLES_DEG) {
      const direction = inward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(angleDeg));
      const result = landingCandidate(raycastRoots, testOrigin, direction, clearance);
      if (result.clear) return { eye: result.eye, clearanceUsed: clearance, obstructed: false };
    }
  }

  const smallest = tiers[tiers.length - 1];
  const fallback = testOrigin.clone().addScaledVector(inward, smallest);
  return { eye: fallback, clearanceUsed: smallest, obstructed: true };
}

/**
 * Floor clicks have no wall to traverse or step back from - the landing
 * spot is simply directly above the clicked point at eye height. The one
 * risk that still needs handling is the same one wall-adjacent standing
 * spots have: a floor point right next to a wall or corner (very common -
 * floors aren't usually clicked dead-center) would otherwise put the
 * camera's body inside the wall's own solid thickness, and the near clip
 * plane cuts straight through it with nothing to render. A short radial
 * ring of rays nudges the landing point away from anything within a
 * personal-space radius, same idea as resolveLandingPoint's tiers but
 * without a single wall normal to retreat along.
 */
/** Straight-down probe used to confirm solid floor still exists near `y` under `point`. */
function hasFloorBelow(raycastRoots: THREE.Object3D[], point: THREE.Vector3, y: number): boolean {
  const probeOrigin = new THREE.Vector3(point.x, y + 0.5, point.z);
  const raycaster = new THREE.Raycaster(probeOrigin, new THREE.Vector3(0, -1, 0), 0, 4.0);
  const hits = raycaster.intersectObjects(raycastRoots, true);
  for (const hit of hits) {
    if (!hit.face || !isPortalSurface(hit.object)) continue;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const n = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (n.y >= 0.9 && Math.abs(hit.point.y - y) < 0.3) return true;
  }
  return false;
}

export function resolveFloorLanding(
  raycastRoots: THREE.Object3D[],
  floorPoint: THREE.Vector3,
  eyeHeight: number,
  personalSpace = 0.35
): THREE.Vector3 {
  const eye = new THREE.Vector3(floorPoint.x, floorPoint.y + eyeHeight, floorPoint.z);
  const raycaster = new THREE.Raycaster();
  const rayDirs = 8;

  for (let pass = 0; pass < 2; pass++) {
    let adjusted = false;
    for (let i = 0; i < rayDirs; i++) {
      const angle = (i / rayDirs) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      raycaster.set(eye, dir);
      raycaster.near = 0.01;
      raycaster.far = personalSpace;
      const hit = raycaster.intersectObjects(raycastRoots, true).find(h => isPortalSurface(h.object));
      if (hit && hit.distance < personalSpace) {
        const candidate = eye.clone().addScaledVector(dir, -(personalSpace - hit.distance));
        // Only accept the nudge if solid floor still exists under the new
        // spot - retreating from a wall/corner can otherwise push the
        // camera past the edge of the floor slab (or over a stairwell
        // hole) into open space, which is worse than standing a little
        // close to whatever was nudged away from.
        if (hasFloorBelow(raycastRoots, candidate, floorPoint.y)) {
          eye.copy(candidate);
          adjusted = true;
        }
      }
    }
    if (!adjusted) break;
  }
  return eye;
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
      const hits = raycaster.intersectObjects(raycastRoots, true).filter(h => isPortalSurface(h.object));
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

// Below this horizontal-magnitude threshold, atan2(x, z) is numerically
// unstable/essentially arbitrary - both components are close enough to
// zero that floating-point noise decides the result. This is the common
// case for a floor click: users typically look nearly straight down to
// click a floor, making the camera-to-hit-point direction near-vertical.
const MIN_HORIZONTAL_MAGNITUDE = 1e-3;

/**
 * Yaw only - pitch/roll are forced to zero so vertical building lines stay
 * parallel to screen edges. Falls back to `fallbackYaw` (normally the
 * camera's own current facing) when `direction`'s horizontal component is
 * too small to derive a stable heading from, rather than committing to an
 * arbitrary atan2 result that can face the leveled camera into unrendered
 * space.
 */
export function computeYawFromDirection(direction: THREE.Vector3, fallbackYaw = 0): number {
  const horizontalMagnitude = Math.hypot(direction.x, direction.z);
  if (horizontalMagnitude < MIN_HORIZONTAL_MAGNITUDE) return fallbackYaw;
  return Math.atan2(direction.x, direction.z);
}

/**
 * Extracts a yaw matching computeYawFromDirection/buildPortalOrientation's
 * own convention (atan2(x, z) of the forward direction) directly from a
 * camera's world quaternion, by rotating the camera-local forward axis
 * (0, 0, -1) into world space. Deliberately not an Euler 'YXZ' decomposition
 * - that convention's yaw is offset from this one by pi and would feed a
 * bogus fallback back into buildPortalOrientation.
 */
export function extractYawFromQuaternion(quaternion: THREE.Quaternion): number {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  return Math.atan2(forward.x, forward.z);
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
  /** Camera's current yaw, used when the approach direction is too near-vertical to derive a stable heading. */
  camYaw?: number;
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
  const fallbackY = params.camEye.y - params.eyeHeight;
  const floorY = sampleFloorDatum(raycastRoots, exitPoint, enterHit.worldNormal, fallbackY);
  const targetY = floorY + params.eyeHeight;

  const landing = resolveLandingPoint(raycastRoots, exitPoint, enterHit.worldNormal, targetY);
  const clearanceRadius = computeClearanceRadius(raycastRoots, landing.eye, params.clearanceDMax);
  const fov = computeDynamicFov(clearanceRadius, params.fovParams);
  const near = computeNearClip(clearanceRadius);

  const approach = computeApproachDirection(params.camEye, enterHit.worldPoint);
  const yaw = computeYawFromDirection(approach, params.camYaw ?? 0);
  const { target, quaternion } = buildPortalOrientation(landing.eye, yaw);

  return { eye: landing.eye, target, quaternion, fov, near, obstructed: landing.obstructed };
}

export interface FloorDestinationParams {
  camEye: THREE.Vector3;
  eyeHeight: number;
  clearanceDMax: number;
  fovParams?: FovParams;
  /** Camera's current yaw, used when the approach direction is too near-vertical to derive a stable heading. */
  camYaw?: number;
}

/**
 * Floor-click counterpart to resolvePortalDestination: no wall cavity to
 * traverse, so this composes the simpler §5-only pipeline (clearance-driven
 * FOV/near, level yaw orientation) around resolveFloorLanding's wall-nudge.
 */
export function resolvePortalDestinationForFloor(
  raycastRoots: THREE.Object3D[],
  floorHit: ResolvedSurfaceHit,
  params: FloorDestinationParams
): PortalDestination {
  const eye = resolveFloorLanding(raycastRoots, floorHit.worldPoint, params.eyeHeight);
  const clearanceRadius = computeClearanceRadius(raycastRoots, eye, params.clearanceDMax);
  const fov = computeDynamicFov(clearanceRadius, params.fovParams);
  const near = computeNearClip(clearanceRadius);

  const approach = computeApproachDirection(params.camEye, floorHit.worldPoint);
  const yaw = computeYawFromDirection(approach, params.camYaw ?? 0);
  const { target, quaternion } = buildPortalOrientation(eye, yaw);

  return { eye, target, quaternion, fov, near, obstructed: false };
}
