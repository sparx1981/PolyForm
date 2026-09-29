import type { Shape } from '../../types';
import type { PlacementHost, PlacementProfile, SemanticObjectKind } from '../semantics/componentTypes';

export type PlacementCandidateType = 'wall' | 'corner' | 'surface' | 'room' | 'grid' | 'free';

export interface PlacementCandidate {
  type: PlacementCandidateType;
  host: PlacementHost;
  position: [number, number, number];
  rotationY?: number;
  distanceM: number;
  sourceId?: string;
  /** Optional extra penalty/reward supplied by the caller. Lower is better. */
  bias?: number;
}

export interface OrientedFootprint {
  center: [number, number];
  halfSize: [number, number];
  rotationY: number;
  kind?: SemanticObjectKind;
  id?: string;
}

const TYPE_WEIGHT: Record<PlacementCandidateType, number> = {
  corner: 0,
  wall: 0.5,
  surface: 1,
  room: 1.5,
  grid: 2,
  free: 3,
};

export function placementScore(candidate: PlacementCandidate, profile: PlacementProfile): number {
  if (!profile.hosts.includes(candidate.host)) return Infinity;
  const preferred = profile.preferredHost === candidate.host ? -2 : 0;
  return TYPE_WEIGHT[candidate.type] + candidate.distanceM + preferred + (candidate.bias ?? 0);
}

export function resolvePlacementCandidate(
  candidates: readonly PlacementCandidate[],
  profile: PlacementProfile,
): PlacementCandidate | null {
  let best: PlacementCandidate | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = placementScore(candidate, profile);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function axes(footprint: OrientedFootprint): [[number, number], [number, number]] {
  const c = Math.cos(footprint.rotationY), s = Math.sin(footprint.rotationY);
  return [[c, s], [-s, c]];
}

function corners(footprint: OrientedFootprint): Array<[number, number]> {
  const [[ux, uz], [vx, vz]] = axes(footprint);
  const [cx, cz] = footprint.center;
  const [hx, hz] = footprint.halfSize;
  return [
    [cx + ux * hx + vx * hz, cz + uz * hx + vz * hz],
    [cx + ux * hx - vx * hz, cz + uz * hx - vz * hz],
    [cx - ux * hx + vx * hz, cz - uz * hx + vz * hz],
    [cx - ux * hx - vx * hz, cz - uz * hx - vz * hz],
  ];
}

function projection(points: Array<[number, number]>, axis: [number, number]): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const [x, z] of points) {
    const d = x * axis[0] + z * axis[1];
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return [min, max];
}

/** Exact 2D oriented-box overlap, suitable for rotated furniture footprints. */
export function footprintsOverlap(a: OrientedFootprint, b: OrientedFootprint, epsilon = 1e-6): boolean {
  const ac = corners(a), bc = corners(b);
  for (const axis of [...axes(a), ...axes(b)]) {
    const [amin, amax] = projection(ac, axis);
    const [bmin, bmax] = projection(bc, axis);
    if (amax <= bmin + epsilon || bmax <= amin + epsilon) return false;
  }
  return true;
}

/** Expand visible bounds to include functional clearances such as door/chair pull-out space. */
export function clearanceFootprint(
  footprint: OrientedFootprint,
  clearance: PlacementProfile['clearanceM'],
): OrientedFootprint {
  if (!clearance) return footprint;
  const left = Math.max(0, clearance.left ?? 0);
  const right = Math.max(0, clearance.right ?? 0);
  const front = Math.max(0, clearance.front ?? 0);
  const back = Math.max(0, clearance.back ?? 0);
  const [[ux, uz], [vx, vz]] = axes(footprint);
  const shiftX = (right - left) / 2;
  const shiftZ = (front - back) / 2;
  return {
    ...footprint,
    center: [
      footprint.center[0] + ux * shiftX + vx * shiftZ,
      footprint.center[1] + uz * shiftX + vz * shiftZ,
    ],
    halfSize: [
      footprint.halfSize[0] + (left + right) / 2,
      footprint.halfSize[1] + (front + back) / 2,
    ],
  };
}

export interface PlacementCollision {
  obstacleId?: string;
  obstacleKind?: SemanticObjectKind;
  clearanceOnly: boolean;
}

/**
 * Returns collisions for both visible geometry and its functional clearance zone.
 * Kinds explicitly allowed by the profile are ignored (e.g. a rug beneath a sofa).
 */
export function placementCollisions(
  footprint: OrientedFootprint,
  obstacles: readonly OrientedFootprint[],
  profile: PlacementProfile,
): PlacementCollision[] {
  const allowed = new Set(profile.allowOverlapWith ?? []);
  const expanded = clearanceFootprint(footprint, profile.clearanceM);
  const out: PlacementCollision[] = [];
  for (const obstacle of obstacles) {
    if (obstacle.id && footprint.id && obstacle.id === footprint.id) continue;
    if (obstacle.kind && allowed.has(obstacle.kind)) continue;
    const visible = footprintsOverlap(footprint, obstacle);
    const clearance = visible || footprintsOverlap(expanded, obstacle);
    if (clearance) out.push({
      obstacleId: obstacle.id,
      obstacleKind: obstacle.kind,
      clearanceOnly: !visible,
    });
  }
  return out;
}

function shapeRotationY(shape: Shape): number {
  if (shape.rotation) return shape.rotation[1] ?? 0;
  if (shape.quaternion) {
    const [x, y, z, w] = shape.quaternion;
    return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
  }
  return 0;
}

/**
 * Places the centre of an object flush to a wall face. The object's local +Z
 * points away from the wall, making wall-hosted furniture deterministic.
 */
export function wallPlacementCandidate(
  wall: Shape,
  pointAlongWall: number,
  objectDepthM: number,
  distanceM = 0,
): PlacementCandidate | null {
  if (wall.type !== 'wall' || !Array.isArray(wall.args)) return null;
  const length = Number(wall.args[0]) || 0;
  const thickness = Number(wall.args[2]) || 0.2;
  if (length <= 0) return null;
  const t = Math.max(-0.5, Math.min(0.5, pointAlongWall));
  const angle = shapeRotationY(wall);
  const dx = Math.cos(angle), dz = -Math.sin(angle);
  const nx = Math.sin(angle), nz = Math.cos(angle);
  return {
    type: 'wall',
    host: 'wall',
    position: [
      wall.position[0] + dx * (length * t) + nx * (thickness / 2 + objectDepthM / 2),
      wall.position[1],
      wall.position[2] + dz * (length * t) + nz * (thickness / 2 + objectDepthM / 2),
    ],
    rotationY: angle,
    distanceM,
    sourceId: wall.id,
  };
}
