import * as THREE from 'three';
import type { Shape } from '../types';

/** The stretch of a door or window that crosses one wall piece, in that wall's local frame. */
export interface WallOpeningSpan {
  /** Local x of the middle of the opening's full width (may be past the wall's ends). */
  localX: number;
  localY: number;
  /** The opening's full width measured along this wall (it may run on past either end). */
  width: number;
  /** Overlap with the wall piece along local x. */
  overlapMin: number;
  overlapMax: number;
  /** How far the opening is from this piece's centre plane where they overlap. */
  zAt: number;
}

/**
 * Where a door or window lands on a wall piece. The opening's width runs along its own
 * direction, which on a curved wall (many short straight pieces) is not this piece's, so an
 * opening wider than the piece it sits on crosses the neighbouring pieces too: this gives the
 * stretch of it that crosses `wall`. Returns null when the opening doesn't reach this piece.
 */
export function openingSpanOnWall(wall: Shape, opening: Shape): WallOpeningSpan | null {
  const args = Array.isArray(wall.args) ? wall.args : [3, 2.8, 0.2];
  const wallLength = args[0] || 3.0;
  const wallPos = new THREE.Vector3(...wall.position);
  // Walls from scripts may carry only `rotation`; without it every opening lands in the wrong place.
  const wallQuat = wall.quaternion
    ? new THREE.Quaternion(...wall.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(wall.rotation || [0, 0, 0])));
  const invWallQuat = wallQuat.clone().invert();

  const sPos = new THREE.Vector3(...opening.position);
  const sArgs = Array.isArray(opening.args) ? opening.args : [1, 1, 1];
  const sWidth = sArgs[0] || (opening.type === 'door' ? 0.9 : 1.2);
  const localPos = sPos.clone().sub(wallPos).applyQuaternion(invWallQuat);

  const openingQuat = opening.quaternion
    ? new THREE.Quaternion(...opening.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(opening.rotation || [0, 0, 0])));
  const along = new THREE.Vector3(1, 0, 0).applyQuaternion(openingQuat).multiplyScalar(sWidth / 2);
  const endA = sPos.clone().sub(along).sub(wallPos).applyQuaternion(invWallQuat);
  const endB = sPos.clone().add(along).sub(wallPos).applyQuaternion(invWallQuat);
  const [lo, hi] = endA.x <= endB.x ? [endA, endB] : [endB, endA];
  const fp = wall.wallMiterFootprint;
  const wallMin = fp ? Math.min(-wallLength / 2, ...fp.map(p => p[0])) : -wallLength / 2;
  const wallMax = fp ? Math.max(wallLength / 2, ...fp.map(p => p[0])) : wallLength / 2;
  const overlapMin = Math.max(lo.x, wallMin), overlapMax = Math.min(hi.x, wallMax);
  if (overlapMax - overlapMin <= 0.01) return null;
  const t = hi.x - lo.x > 1e-6 ? ((overlapMin + overlapMax) / 2 - lo.x) / (hi.x - lo.x) : 0.5;
  const zAt = lo.z + (hi.z - lo.z) * Math.min(1, Math.max(0, t));
  return { localX: (lo.x + hi.x) / 2, localY: localPos.y, width: hi.x - lo.x, overlapMin, overlapMax, zAt };
}

/** Whether a door or window cuts this wall piece: hosted on it, or passing through it. */
export function openingCutsWall(wall: Shape, opening: Shape, span: WallOpeningSpan): boolean {
  const args = Array.isArray(wall.args) ? wall.args : [3, 2.8, 0.2];
  const wallHeight = args[1] || 2.8;
  const wallThick = args[2] || 0.2;
  if (opening.hostWallId === wall.id) return true;
  return Math.abs(span.localY) <= wallHeight / 2 + 0.5 && Math.abs(span.zAt) <= wallThick / 2 + 0.35;
}
