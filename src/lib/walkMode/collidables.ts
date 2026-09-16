import * as THREE from 'three';
import type { Shape } from '../../types';

/**
 * Walk Mode's single source of truth for "is this shape something the
 * player can't walk through". Deny-list, not allow-list: any drawn or
 * generated object - basic shapes, drawn/poly geometry, floor slabs,
 * architecture, landscape, timber framing - collides by default, so
 * whatever the user draws is something they can walk into, stand on, or
 * jump onto without it needing its own entry here first. Only things
 * that would make walking through the model actively worse are excluded:
 * doors (you'd otherwise have to open every one), small plants/shrubs
 * (walking around every bush would be tedious - full trees still block),
 * scale-reference figures (decorative, not real geometry), and dimension
 * annotations (not geometry at all).
 */
const WALK_THROUGH_SHAPE_TYPES = new Set<string>([
  'door',
  'bush',
  'scale_figure',
  'measurement',
]);

export function isWalkCollidable(shape: Shape): boolean {
  if (shape.hidden) return false;
  return !WALK_THROUGH_SHAPE_TYPES.has(shape.type);
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
