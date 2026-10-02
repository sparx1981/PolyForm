import * as THREE from 'three';
import { CENTER, MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/**
 * Past this many triangles an imported mesh is too heavy for the extras that suit ordinary shapes: it casts no shadow
 * (a second pass over every triangle) and draws no edge lines (finding them takes a long, memory-hungry pass).
 */
export const HEAVY_TRIANGLES = 400_000;

/** How many triangles a custom shape's stored mesh holds, read without building it. */
export function customTriangleCount(data: any): number {
  if (!data) return 0;
  const index = data.data?.index?.array?.length ?? data.indices?.length;
  if (typeof index === 'number' && index > 0) return Math.floor(index / 3);
  const positions = data.data?.attributes?.position?.array?.length ?? data.positions?.length;
  return typeof positions === 'number' ? Math.floor(positions / 9) : 0;
}

/**
 * A custom shape counts as heavy when its own mesh is huge, or when it is one piece of an import that is huge as a whole
 * (a big SketchUp model arrives as many shapes, which together are as costly as one big one).
 */
export const isHeavyCustomShape = (shape: { type?: string; geometryData?: unknown; customData?: any }): boolean =>
  shape.type === 'custom' &&
  ((shape.customData?.skpImport?.triangles ?? 0) > HEAVY_TRIANGLES || customTriangleCount(shape.geometryData) > HEAVY_TRIANGLES);

const heavyGeometries = new WeakSet<THREE.BufferGeometry>();
let installed = false;

/**
 * Picking (hover, click, snapping) tests the pointer ray against every triangle of a mesh, which for millions of
 * triangles stalls the page on every mouse move. A heavy geometry is therefore only pickable through a bounding
 * volume tree, and not at all until that tree exists.
 */
function installHeavyRaycast(): void {
  if (installed) return;
  installed = true;
  const original = THREE.Mesh.prototype.raycast;
  THREE.Mesh.prototype.raycast = function (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    const geometry = this.geometry as THREE.BufferGeometry;
    if (geometry && heavyGeometries.has(geometry)) {
      if (geometry.boundsTree) acceleratedRaycast.call(this, raycaster, intersects);
      return;
    }
    original.call(this, raycaster, intersects);
  };
}

/**
 * Makes a heavy geometry pickable without freezing the page: picking is off until a bounding volume tree has been built
 * (shortly after the geometry is first shown), then fast. Returns a function that undoes it.
 */
export function prepareHeavyGeometry(geometry: THREE.BufferGeometry): () => void {
  installHeavyRaycast();
  heavyGeometries.add(geometry);
  const timer = setTimeout(() => {
    try {
      geometry.boundsTree = new MeshBVH(geometry, { strategy: CENTER, indirect: true });
    } catch (err) {
      console.warn('[heavyMesh] Could not build a picking tree; the model stays unpickable', err);
    }
  }, 150);
  return () => {
    clearTimeout(timer);
    heavyGeometries.delete(geometry);
    geometry.boundsTree = undefined;
  };
}
