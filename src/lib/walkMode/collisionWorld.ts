import * as THREE from 'three';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';
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

function bakeInstancedMesh(mesh: THREE.InstancedMesh): THREE.BufferGeometry[] {
  const baked: THREE.BufferGeometry[] = [];
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, instanceMatrix);
    worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
    const geom = mesh.geometry.clone();
    // Position only - collision doesn't need normals/UVs (spec §9 memory note).
    for (const key of Object.keys(geom.attributes)) {
      if (key !== 'position') geom.deleteAttribute(key);
    }
    geom.applyMatrix4(worldMatrix);
    baked.push(geom);
  }
  return baked;
}

/**
 * Builds a single merged, world-space, position-only geometry from every
 * collidable mesh plus (optionally) a floor quad, and a MeshBVH over it
 * (spec §7.2). Regular meshes go through three-mesh-bvh's own
 * StaticGeometryGenerator; InstancedMesh objects (e.g. timber framing) are
 * baked by hand first since StaticGeometryGenerator does not expand
 * per-instance transforms on its own.
 */
export function buildCollisionWorld(
  scene: THREE.Object3D,
  shapes: Shape[],
  floorEnabled: boolean
): CollisionWorld | null {
  const start = performance.now();
  const shapesById = new Map(shapes.map((s) => [s.id, s]));
  const meshes = collectCollidableMeshes(scene, shapesById);

  const regularMeshes: THREE.Mesh[] = [];
  const bakedInstancedGeoms: THREE.BufferGeometry[] = [];
  for (const obj of meshes) {
    if ((obj as THREE.InstancedMesh).isInstancedMesh) {
      bakedInstancedGeoms.push(...bakeInstancedMesh(obj as THREE.InstancedMesh));
    } else {
      regularMeshes.push(obj as THREE.Mesh);
    }
  }

  const geometries: THREE.BufferGeometry[] = [];

  if (regularMeshes.length > 0) {
    const generator = new StaticGeometryGenerator(regularMeshes);
    generator.attributes = ['position'];
    const generated = generator.generate();
    if (generated.attributes.position && generated.attributes.position.count > 0) {
      geometries.push(generated);
    }
  }
  geometries.push(...bakedInstancedGeoms);

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
  for (const key of Object.keys(geom.attributes)) {
    if (key !== 'position') geom.deleteAttribute(key);
  }
  return geom;
}

export function disposeCollisionWorld(world: CollisionWorld | null): void {
  if (!world) return;
  world.geometry.dispose();
}
