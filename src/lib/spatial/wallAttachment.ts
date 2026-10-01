import * as THREE from 'three';
import type { Shape } from '../../types';
import type { SpatialRoom } from './rooms';
import { pointInPolygonOrNear } from '../interiors/smartFurnish';

/** Project onto the visible/room-facing wall side, respecting Euler and quaternion rotations.
 * Both sides of an internal partition can be interior faces; choose the side nearest the pointer. */
export function wallAttachmentPoint(wall: Shape, target: THREE.Vector3, interior: boolean, rooms: readonly SpatialRoom[]): THREE.Vector3 {
  const q = wall.quaternion ? new THREE.Quaternion(...wall.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(wall.rotation ?? [0, 0, 0])));
  const run = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const centre = new THREE.Vector3(...wall.position);
  const along = THREE.MathUtils.clamp(target.clone().sub(centre).dot(run), -Number(wall.args[0]) / 2, Number(wall.args[0]) / 2);
  centre.addScaledVector(run, along); centre.y = target.y;
  if (!interior) return centre;
  const half = Number(wall.args[2] ?? 0.2) / 2;
  const candidates = [-1, 1].map(side => ({
    point: centre.clone().addScaledVector(normal, side * half),
    probe: centre.clone().addScaledVector(normal, side * (half + 0.12)),
  }));
  const adjacent = rooms.filter(room => room.boundaryWallIds.includes(wall.id) && Math.abs(room.elevation - target.y) < 0.3);
  const inward = candidates.filter(candidate => adjacent.some(room => pointInPolygonOrNear([candidate.probe.x, candidate.probe.z], room.boundary, 0.02)));
  return (inward.length ? inward : candidates).sort((a, b) => a.point.distanceToSquared(target) - b.point.distanceToSquared(target))[0].point;
}
