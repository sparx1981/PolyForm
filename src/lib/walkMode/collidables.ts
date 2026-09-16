import * as THREE from 'three';
import type { Shape } from '../../types';

/**
 * Walk Mode's single source of truth for "is this shape something the
 * player can't walk through" - kept as one exported allow-list (rather
 * than scattered checks) so the product decision in the spec (§6.1) stays
 * easy to find and change later.
 */
const SOLID_SHAPE_TYPES = new Set<string>([
  // Architecture
  'wall', 'window', 'step', 'staircase', 'roof',
  // Landscape
  'terrain', 'fence', 'railing', 'lamp', 'bench', 'rock',
]);

/** Doors are deliberately excluded - see collidables.test.ts and the spec's §6.1 table. */
export function isWalkCollidable(shape: Shape): boolean {
  if (shape.hidden) return false;
  if (SOLID_SHAPE_TYPES.has(shape.type)) return true;
  // Timber frame members (studs, plates, headers, joists, rafters) are
  // generated as their own shapes that don't necessarily carry one of the
  // types above, but are still real structural geometry.
  if (shape.timberFrame || shape.timberMemberData) return true;
  return false;
}

export interface CollectedMesh {
  mesh: THREE.Mesh;
}

/**
 * Walks the whole scene graph once, collecting the actual renderable
 * meshes for every shape the player should collide with. Shape meshes are
 * tagged with `userData.isShape`/`userData.id` on the group/mesh that
 * corresponds 1:1 with a Shape (see Viewport.tsx's `meshProps`), so a mesh
 * qualifies if walking up its parent chain finds that tag pointing at a
 * collidable shape - this covers both a single mesh per shape and the
 * multi-mesh sub-face/instanced-timber-frame cases below.
 */
export function collectCollidableMeshes(
  scene: THREE.Object3D,
  shapesById: Map<string, Shape>
): THREE.Object3D[] {
  const collected: THREE.Object3D[] = [];

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) && !(obj as THREE.InstancedMesh).isInstancedMesh) return;
    if (!isVisibleThroughParents(obj)) return;

    const geom = (obj as THREE.Mesh).geometry;
    if (!geom || !geom.attributes?.position || geom.attributes.position.count === 0) return;

    const shape = findOwningShape(obj, shapesById);
    if (!shape) return;
    if (!isWalkCollidable(shape)) return;

    collected.push(obj);
  });

  return collected;
}

function isVisibleThroughParents(obj: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = obj;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

function findOwningShape(obj: THREE.Object3D, shapesById: Map<string, Shape>): Shape | null {
  let node: THREE.Object3D | null = obj;
  while (node) {
    const id = node.userData?.id;
    if (node.userData?.isShape && typeof id === 'string') {
      return shapesById.get(id) || null;
    }
    node = node.parent;
  }
  return null;
}
