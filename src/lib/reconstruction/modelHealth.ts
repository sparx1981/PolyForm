import * as THREE from 'three';
import type { Shape } from '../../types';
import { placementCollisions, type OrientedFootprint } from '../spatial/placement';
import type { PlacementProfile, SemanticObjectKind } from '../semantics/componentTypes';

export type ModelHealthSeverity = 'error' | 'warning' | 'info';

export interface ModelHealthIssue {
  severity: ModelHealthSeverity;
  code:
    | 'wall-too-short'
    | 'duplicate-wall'
    | 'orphan-opening'
    | 'opening-too-wide'
    | 'furniture-collision'
    | 'furniture-clearance'
    | 'invalid-semantic-object';
  message: string;
  shapeIds: string[];
}

export interface ModelHealthReport {
  issues: ModelHealthIssue[];
  errors: number;
  warnings: number;
  info: number;
  healthy: boolean;
}

/** Turn about the vertical axis, from whichever of quaternion or rotation the object carries (the connector saves quaternions). */
function yawOf(shape: Shape): number {
  if (shape.quaternion) return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...shape.quaternion), 'YXZ').y;
  return shape.rotation?.[1] ?? 0;
}

/** Height range [bottom, top] a wall covers. */
function wallSpan(shape: Shape): [number, number] {
  const height = Array.isArray(shape.args) ? Number(shape.args[1]) || 2.8 : 2.8;
  return [shape.position[1] - height / 2, shape.position[1] + height / 2];
}

/** Whether two height ranges share more than a sliver (touching, as when a lamp stands on a table, does not count). */
function stacked([a0, a1]: [number, number], [b0, b1]: [number, number], tolerance = 0.05): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > tolerance;
}

function wallEnds(shape: Shape): [[number, number], [number, number]] | null {
  if (shape.type !== 'wall' || !Array.isArray(shape.args)) return null;
  const length = Number(shape.args[0]) || 0;
  const angle = yawOf(shape);
  const dx = Math.cos(angle) * length / 2;
  const dz = -Math.sin(angle) * length / 2;
  return [
    [shape.position[0] - dx, shape.position[2] - dz],
    [shape.position[0] + dx, shape.position[2] + dz],
  ];
}

function close(a: [number, number], b: [number, number], tolerance = 0.03) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
}

function wallsDuplicate(a: Shape, b: Shape): boolean {
  const ea = wallEnds(a), eb = wallEnds(b);
  if (!ea || !eb) return false;
  // Walls one above the other (storeys) share a plan line without being duplicates.
  if (!stacked(wallSpan(a), wallSpan(b), 0.3)) return false;
  return (close(ea[0], eb[0]) && close(ea[1], eb[1]))
    || (close(ea[0], eb[1]) && close(ea[1], eb[0]));
}

function openingWidth(shape: Shape): number {
  return Array.isArray(shape.args) ? Number(shape.args[0]) || 0 : 0;
}

function wallLength(shape: Shape): number {
  return Array.isArray(shape.args) ? Number(shape.args[0]) || 0 : 0;
}

function semantic(shape: Shape): any {
  return shape.customData?.semanticComponent;
}

function kindOf(shape: Shape): SemanticObjectKind | undefined {
  return semantic(shape)?.kind as SemanticObjectKind | undefined;
}

function profileOf(shape: Shape): PlacementProfile | undefined {
  return semantic(shape)?.placement as PlacementProfile | undefined;
}

function footprintOf(shape: Shape): OrientedFootprint | null {
  const data = semantic(shape);
  if (!data) return null;
  const params = data.params ?? {};
  const width = Number(params.width ?? (Array.isArray(shape.args) ? shape.args[0] : 0));
  const depth = Number(params.depth ?? (Array.isArray(shape.args) ? shape.args[2] : 0));
  if (!(width > 0) || !(depth > 0) || !Number.isFinite(width) || !Number.isFinite(depth)) return null;
  return {
    id: shape.id,
    kind: kindOf(shape),
    center: [shape.position[0], shape.position[2]],
    halfSize: [width / 2, depth / 2],
    rotationY: yawOf(shape),
  };
}

/** Height range an item occupies, when it says how tall it is (its position is its base); undefined otherwise. */
function verticalSpan(shape: Shape): [number, number] | undefined {
  const params = semantic(shape)?.params ?? {};
  const height = Number(params.height ?? (Array.isArray(shape.args) ? shape.args[1] : NaN));
  if (!(height > 0) || !Number.isFinite(height)) return undefined;
  return [shape.position[1], shape.position[1] + height];
}

export function checkModelHealth(shapes: readonly Shape[]): ModelHealthReport {
  const visible = shapes.filter(shape => !shape.hidden);
  const issues: ModelHealthIssue[] = [];
  const walls = visible.filter(shape => shape.type === 'wall');

  for (const wall of walls) {
    if (wallLength(wall) < 0.2) {
      issues.push({
        severity: 'error',
        code: 'wall-too-short',
        message: 'Wall is shorter than 0.2 m and is likely accidental.',
        shapeIds: [wall.id],
      });
    }
  }

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      if (wallsDuplicate(walls[i], walls[j])) {
        issues.push({
          severity: 'error',
          code: 'duplicate-wall',
          message: 'Two walls occupy the same segment.',
          shapeIds: [walls[i].id, walls[j].id],
        });
      }
    }
  }

  const wallMap = new Map(walls.map(wall => [wall.id, wall]));
  for (const opening of visible.filter(shape => shape.type === 'door' || shape.type === 'window')) {
    if (!opening.hostWallId || !wallMap.has(opening.hostWallId)) {
      issues.push({
        severity: 'error',
        code: 'orphan-opening',
        message: `${opening.type === 'door' ? 'Door' : 'Window'} has no valid host wall.`,
        shapeIds: [opening.id],
      });
      continue;
    }
    const host = wallMap.get(opening.hostWallId)!;
    if (openingWidth(opening) > wallLength(host) - 0.1) {
      issues.push({
        severity: 'error',
        code: 'opening-too-wide',
        message: 'Opening is wider than its host wall.',
        shapeIds: [opening.id, host.id],
      });
    }
  }

  const semanticShapes = visible.filter(shape => semantic(shape));
  const footprints = semanticShapes
    .map(footprintOf)
    .filter((footprint): footprint is OrientedFootprint => footprint !== null);
  const footprintById = new Map(footprints.map(f => [f.id!, f]));
  const spanById = new Map(semanticShapes.map(shape => [shape.id, verticalSpan(shape)]));

  const seenCollisionPairs = new Set<string>();
  for (const shape of semanticShapes) {
    const profile = profileOf(shape);
    const footprint = footprintById.get(shape.id);
    if (!profile || !footprint) {
      issues.push({
        severity: 'warning',
        code: 'invalid-semantic-object',
        message: 'Semantic object is missing valid placement dimensions or rules.',
        shapeIds: [shape.id],
      });
      continue;
    }
    // Only things at the same height can be in the way: not another floor's furniture, nor what stands on top.
    const mine = verticalSpan(shape);
    const obstacles = footprints.filter(f => {
      if (f.id === shape.id) return false;
      const theirs = spanById.get(f.id!);
      return !(mine && theirs) || stacked(mine, theirs);
    });
    const collisions = placementCollisions(footprint, obstacles, profile);
    for (const collision of collisions) {
      if (!collision.obstacleId) continue;
      const pairKey = [shape.id, collision.obstacleId].sort().join('|');
      if (seenCollisionPairs.has(pairKey)) continue;
      seenCollisionPairs.add(pairKey);
      issues.push({
        severity: collision.clearanceOnly ? 'warning' : 'error',
        code: collision.clearanceOnly ? 'furniture-clearance' : 'furniture-collision',
        message: collision.clearanceOnly
          ? 'Furniture functional clearance overlaps another object.'
          : 'Furniture objects intersect.',
        shapeIds: [shape.id, collision.obstacleId],
      });
    }
  }

  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;
  const info = issues.length - errors - warnings;
  return { issues, errors, warnings, info, healthy: errors === 0 };
}
