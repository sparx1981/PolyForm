import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../../types';
import { doorMotion } from '../presentation/doors';
import type { Collider } from './playerPhysics';

/**
 * Doors in Walk Mode: look at one and press E to open or close it. A closed door blocks the
 * way; an open one (or one swinging open) doesn't. The main collision world leaves doors out
 * (see collidables.ts), so closed doors get their own small collider, rebuilt whenever one is
 * opened or shut - far cheaper than rebuilding the whole model's.
 */

/** How far away a door can be opened from, in metres. */
export const DOOR_REACH = 2.5;


/** Whether a door can be opened in Walk Mode (an archway has nothing to open, so it stays walk-through). */
export function isOpenableDoor(shape: Shape): boolean {
  return shape.type === 'door' && !shape.hidden && doorMotion(shape.archStyle) !== 'none';
}

function doorFrame(shape: Shape) {
  const [w = 0.9, h = 2.1, d = 0.15] = Array.isArray(shape.args) ? (shape.args as number[]) : [];
  const q = shape.quaternion
    ? new THREE.Quaternion(...shape.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation || [0, 0, 0])));
  return { width: w || 0.9, height: h || 2.1, depth: d || 0.15, position: new THREE.Vector3(...shape.position), quaternion: q };
}

/** A solid panel filling each closed door's opening, merged into one collider (null if every door is open). */
export function buildClosedDoorCollider(shapes: Shape[], openIds: ReadonlySet<string>): MeshBVH | null {
  const boxes: THREE.BufferGeometry[] = [];
  for (const s of shapes) {
    if (!isOpenableDoor(s) || openIds.has(s.id)) continue;
    const f = doorFrame(s);
    const box = new THREE.BoxGeometry(f.width, f.height, Math.min(Math.max(f.depth, 0.04), 0.12)).toNonIndexed();
    box.deleteAttribute('normal');
    box.deleteAttribute('uv');
    box.applyMatrix4(new THREE.Matrix4().compose(f.position, f.quaternion, new THREE.Vector3(1, 1, 1)));
    boxes.push(box);
  }
  if (!boxes.length) return null;
  const merged = boxes.length === 1 ? boxes[0] : BufferGeometryUtils.mergeGeometries(boxes, false);
  return merged ? new MeshBVH(merged) : null;
}

/** The openable door straight ahead of `ray` within reach, or null. Walls in between aren't checked: reach is short. */
export function doorInView(ray: THREE.Ray, shapes: Shape[], reach = DOOR_REACH): Shape | null {
  let best: Shape | null = null;
  let bestDist = reach;
  const local = new THREE.Ray();
  const hit = new THREE.Vector3();
  for (const s of shapes) {
    if (!isOpenableDoor(s)) continue;
    const f = doorFrame(s);
    // Into the door's own frame, where its opening is a box round the origin.
    const inv = f.quaternion.clone().invert();
    local.origin.copy(ray.origin).sub(f.position).applyQuaternion(inv);
    local.direction.copy(ray.direction).applyQuaternion(inv);
    const half = new THREE.Vector3(f.width / 2, f.height / 2, Math.max(f.depth, 0.2) / 2);
    if (!local.intersectBox(new THREE.Box3(half.clone().negate(), half), hit)) continue;
    const dist = hit.distanceTo(local.origin);
    if (dist < bestDist) { bestDist = dist; best = s; }
  }
  return best;
}

/** One collider made of several (the model, plus the closed doors). */
export function combineColliders(main: Collider, extra: Collider | null): Collider {
  if (!extra) return main;
  return {
    shapecast: ((callbacks: Parameters<MeshBVH['shapecast']>[0]) => {
      const a = main.shapecast(callbacks);
      const b = extra.shapecast(callbacks);
      return a || b;
    }) as MeshBVH['shapecast'],
    raycastFirst: ((ray: THREE.Ray, side?: THREE.Side, near?: number, far?: number) => {
      const a = main.raycastFirst(ray, side, near, far);
      const b = extra.raycastFirst(ray, side, near, far);
      if (!a) return b;
      if (!b) return a;
      return a.distance <= b.distance ? a : b;
    }) as MeshBVH['raycastFirst'],
  };
}
