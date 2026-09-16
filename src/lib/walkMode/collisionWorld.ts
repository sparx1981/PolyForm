import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../../types';
import { collectCollidableMeshes } from './collidables';

export interface CollisionWorld {
  bvh: MeshBVH;
  geometry: THREE.BufferGeometry;
  /** Bounds of the collidable shape geometry only - excludes the floor quad, per spec §7.2. */
  bounds: THREE.Box3;
  triangleCount: number;
  buildTimeMs: number;
}

/** Margin added around the shape bounds before clipping the floor quad to them (spec §6.1). */
const FLOOR_BOUNDS_MARGIN = 1;

/**
 * Bakes one mesh's geometry into a standalone, world-space, position-only,
 * NON-INDEXED BufferGeometry. Every geometry this module produces (regular
 * meshes, per-instance InstancedMesh copies, the floor quad) goes through
 * this same normalization so they can always be merged together
 * regardless of what any individual shape's geometry looked like -
 * `BufferGeometryUtils.mergeGeometries` requires every input to agree on
 * both attributes AND indexed-vs-not, and the collidable allow-list (walls,
 * stairs, roofs, terrain, procedurally generated timber framing, ...) mixes
 * indexed and non-indexed geometry freely. This used to go through
 * three-mesh-bvh's own StaticGeometryGenerator for non-instanced meshes,
 * which hits that exact same mismatch internally and throws.
 */
function bakeMeshGeometry(geometry: THREE.BufferGeometry, worldMatrix: THREE.Matrix4): THREE.BufferGeometry {
  let geom = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const key of Object.keys(geom.attributes)) {
    if (key !== 'position') geom.deleteAttribute(key);
  }
  geom.applyMatrix4(worldMatrix);
  return geom;
}

function bakeInstancedMesh(mesh: THREE.InstancedMesh): THREE.BufferGeometry[] {
  const baked: THREE.BufferGeometry[] = [];
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, instanceMatrix);
    worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
    baked.push(bakeMeshGeometry(mesh.geometry, worldMatrix));
  }
  return baked;
}

/**
 * Builds a single merged, world-space, position-only geometry from every
 * collidable mesh plus (optionally) a floor quad, and a MeshBVH over it
 * (spec §7.2).
 */
export function buildCollisionWorld(
  scene: THREE.Object3D,
  shapes: Shape[],
  floorEnabled: boolean
): CollisionWorld | null {
  const start = performance.now();
  const shapesById = new Map(shapes.map((s) => [s.id, s]));
  const meshes = collectCollidableMeshes(scene, shapesById);

  const geometries: THREE.BufferGeometry[] = [];
  for (const obj of meshes) {
    if ((obj as THREE.InstancedMesh).isInstancedMesh) {
      geometries.push(...bakeInstancedMesh(obj as THREE.InstancedMesh));
    } else {
      const mesh = obj as THREE.Mesh;
      mesh.updateWorldMatrix(true, false);
      const geom = bakeMeshGeometry(mesh.geometry, mesh.matrixWorld);
      if (geom.attributes.position && geom.attributes.position.count > 0) geometries.push(geom);
    }
  }

  if (geometries.length === 0 && !floorEnabled) {
    return null;
  }

  const bounds = new THREE.Box3();
  for (const geom of geometries) {
    geom.computeBoundingBox();
    if (geom.boundingBox) bounds.union(geom.boundingBox);
  }
  // No collidable shapes at all, but the floor is on - fall back to a
  // reasonable default footprint so the floor quad below isn't degenerate.
  if (geometries.length === 0) {
    bounds.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 0, 10));
  }

  if (floorEnabled) {
    const floorGeom = buildFloorQuad(bounds);
    geometries.push(floorGeom);
  }

  const merged =
    geometries.length === 1 ? geometries[0] : BufferGeometryUtils.mergeGeometries(geometries, false);
  if (!merged || !merged.attributes.position || merged.attributes.position.count === 0) {
    return null;
  }

  const bvh = new MeshBVH(merged);
  const triangleCount = merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;

  return {
    bvh,
    geometry: merged,
    bounds,
    triangleCount,
    buildTimeMs: performance.now() - start,
  };
}

/** A single quad at y=0, clipped to the shape bounds + margin - never the app's 2000x2000 fallback plane (spec §6.1). */
function buildFloorQuad(shapeBounds: THREE.Box3): THREE.BufferGeometry {
  const minX = shapeBounds.min.x - FLOOR_BOUNDS_MARGIN;
  const maxX = shapeBounds.max.x + FLOOR_BOUNDS_MARGIN;
  const minZ = shapeBounds.min.z - FLOOR_BOUNDS_MARGIN;
  const maxZ = shapeBounds.max.z + FLOOR_BOUNDS_MARGIN;
  const width = Math.max(maxX - minX, 2 * FLOOR_BOUNDS_MARGIN);
  const depth = Math.max(maxZ - minZ, 2 * FLOOR_BOUNDS_MARGIN);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const geom = new THREE.PlaneGeometry(width, depth);
  geom.rotateX(-Math.PI / 2);
  geom.translate(cx, 0, cz);
  // PlaneGeometry is indexed by default - normalize the same way every
  // other geometry here is (see bakeMeshGeometry) so it merges cleanly.
  return bakeMeshGeometry(geom, new THREE.Matrix4());
}

export function disposeCollisionWorld(world: CollisionWorld | null): void {
  if (!world) return;
  world.geometry.dispose();
}
