import * as THREE from 'three';

export interface AxisDefinition {
  dir: THREE.Vector3;
  color: string;
  label: string;
}

export const ORTHO_AXES: AxisDefinition[] = [
  { dir: new THREE.Vector3(1, 0, 0), color: '#DA212C', label: 'X Axis (Red)' },
  { dir: new THREE.Vector3(0, 1, 0), color: '#006638', label: 'Y Axis (Green)' },
  { dir: new THREE.Vector3(0, 0, 1), color: '#0063A3', label: 'Z Axis (Blue)' },
];

/**
 * Projects a 3D point onto an infinite line defined by an origin point and a unit direction vector.
 */
export function projectPointOntoLine(
  point: THREE.Vector3,
  lineOrigin: THREE.Vector3,
  lineDir: THREE.Vector3
): THREE.Vector3 {
  const normDir = lineDir.clone().normalize();
  const diff = new THREE.Vector3().subVectors(point, lineOrigin);
  const t = diff.dot(normDir);
  return new THREE.Vector3().copy(lineOrigin).addScaledVector(normDir, t);
}

/**
 * Finds an orthogonal tracking projection from a reference point along standard coordinate axes.
 */
export function findOrthoTrackingProjection(
  referencePoint: THREE.Vector3,
  currentPoint: THREE.Vector3,
  distanceThreshold: number = 0.20
): { projectedPoint: THREE.Vector3; direction: THREE.Vector3; color: string; label: string } | null {
  let closestMatch: { projectedPoint: THREE.Vector3; direction: THREE.Vector3; color: string; label: string; dist: number } | null = null;

  for (const axis of ORTHO_AXES) {
    const projected = projectPointOntoLine(currentPoint, referencePoint, axis.dir);
    const dist = projected.distanceTo(currentPoint);
    if (dist <= distanceThreshold) {
      if (!closestMatch || dist < closestMatch.dist) {
        closestMatch = {
          projectedPoint: projected,
          direction: axis.dir.clone(),
          color: axis.color,
          label: axis.label,
          dist,
        };
      }
    }
  }

  return closestMatch ? {
    projectedPoint: closestMatch.projectedPoint,
    direction: closestMatch.direction,
    color: closestMatch.color,
    label: closestMatch.label,
  } : null;
}

/**
 * Finds a perpendicular alignment ray relative to an existing wall or reference vector.
 */
export function findPerpendicularTrackingProjection(
  referencePoint: THREE.Vector3,
  currentPoint: THREE.Vector3,
  baseVector: THREE.Vector3,
  distanceThreshold: number = 0.20
): { projectedPoint: THREE.Vector3; direction: THREE.Vector3; color: string; label: string } | null {
  // Horizontal perpendicular in X-Z plane
  const perp = new THREE.Vector3(-baseVector.z, 0, baseVector.x);
  if (perp.lengthSq() < 1e-6) return null;
  perp.normalize();

  const projected = projectPointOntoLine(currentPoint, referencePoint, perp);
  const dist = projected.distanceTo(currentPoint);
  if (dist <= distanceThreshold) {
    return {
      projectedPoint: projected,
      direction: perp,
      color: '#FBAD26', // Gold perpendicular guide
      label: 'Perpendicular (90°)',
    };
  }

  return null;
}
