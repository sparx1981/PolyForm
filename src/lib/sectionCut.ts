import * as THREE from 'three';
import { isModelObject } from './export/modelExport';

/** Very dense meshes (terrain, plants) are clipped but not filled. */
const CAP_VERTEX_LIMIT = 300000;

/**
 * Cuts a scene's model with a section plane (see tools/sectionPlanes.ts): the model's
 * materials clip against the plane, and every cut object gets a solid fill where it's sliced -
 * its back faces, seen through the cut, drawn dark (the same trick presentation mode's cuts
 * use). Helpers, the grid, the sky and the section planes themselves are never cut.
 *
 * `apply` is safe to call repeatedly (SectionCutter calls it every few frames, so objects
 * added or redrawn while a section is active are cut too); `clear` puts everything back.
 */
export class SectionCut {
  readonly capMaterial = new THREE.MeshBasicMaterial({ color: '#2b2f36', side: THREE.BackSide });
  private readonly clipped = new Set<THREE.Material>();
  private readonly caps = new Map<THREE.Mesh, THREE.Mesh>();

  /**
   * `layerOf` names the layer a mesh belongs to (see tools/sectionPlanes.ts) and `exempt` the
   * layers to leave alone; a mesh in an exempt layer is not clipped and gets no fill.
   */
  apply(scene: THREE.Object3D, plane: THREE.Plane, layerOf?: (mesh: THREE.Mesh) => string | null, exempt?: ReadonlySet<string>): void {
    if (this.capMaterial.clippingPlanes?.[0] !== plane) {
      this.capMaterial.clippingPlanes = [plane];
      this.capMaterial.needsUpdate = true;
    }
    const seen = new Set<THREE.Mesh>();
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh & { isLine2?: boolean; isLineSegments2?: boolean };
      if (!mesh.isMesh || mesh.isLine2 || mesh.isLineSegments2 || mesh.userData.isSectionCap) return;
      // The map overlay is flat and marks itself; everything else must be part of the model.
      const overlay = mesh.userData.sectionLayer === 'overlay';
      if (!overlay && !isModelObject(mesh)) return;
      const layer = overlay ? 'overlay' : layerOf?.(mesh) ?? null;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (layer && exempt?.has(layer)) {
        // Left alone: put back anything an earlier cut did to it.
        for (const m of materials) {
          if (m && this.clipped.has(m)) { m.clippingPlanes = null; m.needsUpdate = true; this.clipped.delete(m); }
        }
        return;
      }
      for (const m of materials) {
        if (!m || (m.clippingPlanes?.length === 1 && m.clippingPlanes[0] === plane)) continue;
        m.clippingPlanes = [plane];
        m.clipShadows = true;
        m.needsUpdate = true;
        this.clipped.add(m);
      }
      const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (overlay || instanced || (geometry.getAttribute('position')?.count ?? 0) > CAP_VERTEX_LIMIT) return;
      seen.add(mesh);
      let cap = this.caps.get(mesh);
      if (!cap) {
        cap = new THREE.Mesh(geometry, this.capMaterial);
        cap.userData.isSectionCap = true;
        cap.raycast = () => {};
        cap.castShadow = false;
        cap.receiveShadow = false;
        this.caps.set(mesh, cap);
        mesh.add(cap);
      }
      if (cap.geometry !== geometry) cap.geometry = geometry;
      // Drawn after the object, so the fill wins over the object's own back faces.
      cap.renderOrder = mesh.renderOrder + 1;
    });
    // Objects that went away take their fill with them.
    for (const [mesh, cap] of this.caps) {
      if (!seen.has(mesh)) { cap.removeFromParent(); this.caps.delete(mesh); }
    }
  }

  clear(): void {
    for (const m of this.clipped) {
      m.clippingPlanes = null;
      m.needsUpdate = true;
    }
    this.clipped.clear();
    for (const cap of this.caps.values()) cap.removeFromParent();
    this.caps.clear();
  }
}
