import * as THREE from 'three';
import { isModelObject } from './export/modelExport';

/** Very dense meshes (terrain, plants) are clipped but not filled. */
const CAP_VERTEX_LIMIT = 300000;

/** How the model's edge lines look on the cut-away side of a section. Unset = same as the kept side. */
export interface SectionXray {
  color?: string;
  opacity?: number;
}

type LineLike = THREE.Object3D & {
  material: THREE.Material & { color?: THREE.Color; opacity?: number; linewidth?: number; resolution?: THREE.Vector2 };
  isLine?: boolean; isLineSegments?: boolean; isLine2?: boolean; isLineSegments2?: boolean;
};

const isLineObject = (o: THREE.Object3D): o is LineLike => {
  const l = o as LineLike;
  return !!(l.isLine || l.isLineSegments || l.isLine2 || l.isLineSegments2) && !Array.isArray(l.material);
};

/** Edge lines that belong to the model: under a model object, or under a group marked `sectionXray`. */
function isModelLine(o: THREE.Object3D): boolean {
  if (isModelObject(o)) return true;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData?.sectionXray) return true;
  return false;
}

/**
 * Cuts a scene's model with a section plane (see tools/sectionPlanes.ts): the model's
 * materials clip against the plane, and every cut object gets a solid fill where it's sliced -
 * its back faces, seen through the cut, drawn dark (the same trick presentation mode's cuts
 * use). Helpers, the grid, the sky and the section planes themselves are never cut.
 *
 * Edge lines are cut too: on the kept side they look as usual, and on the cut-away side each
 * line is drawn again as a faint "x-ray" ghost, in the colour and opacity given to `apply`.
 *
 * `apply` is safe to call repeatedly (SectionCutter calls it every few frames, so objects
 * added or redrawn while a section is active are cut too); `clear` puts everything back.
 */
export class SectionCut {
  readonly capMaterial = new THREE.MeshBasicMaterial({ color: '#2b2f36', side: THREE.BackSide });
  private readonly clipped = new Set<THREE.Material>();
  private readonly caps = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly ghosts = new Map<THREE.Object3D, LineLike>();
  private ghostPlane: THREE.Plane | null = null;
  private ghostSource: THREE.Plane | null = null;

  apply(scene: THREE.Object3D, plane: THREE.Plane, xray: SectionXray = {}): void {
    if (this.capMaterial.clippingPlanes?.[0] !== plane) {
      this.capMaterial.clippingPlanes = [plane];
      this.capMaterial.needsUpdate = true;
    }
    if (this.ghostSource !== plane) {
      this.ghostSource = plane;
      this.ghostPlane = new THREE.Plane(plane.normal.clone().negate(), -plane.constant);
    }
    const seen = new Set<THREE.Mesh>();
    const lines: LineLike[] = [];
    scene.traverse(obj => {
      if (obj.userData.isSectionGhost) return;
      if (isLineObject(obj) && isModelLine(obj)) { lines.push(obj); return; }
      const mesh = obj as THREE.Mesh & { isLine2?: boolean; isLineSegments2?: boolean };
      if (!mesh.isMesh || mesh.isLine2 || mesh.isLineSegments2 || mesh.userData.isSectionCap || !isModelObject(mesh)) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of materials) {
        if (!m || (m.clippingPlanes?.length === 1 && m.clippingPlanes[0] === plane)) continue;
        m.clippingPlanes = [plane];
        m.clipShadows = true;
        m.needsUpdate = true;
        this.clipped.add(m);
      }
      const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (instanced || (geometry.getAttribute('position')?.count ?? 0) > CAP_VERTEX_LIMIT) return;
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
    this.applyLines(lines, plane, xray);
  }

  /** Edge lines: clipped to the kept side, plus a restyled ghost clipped to the cut-away side. */
  private applyLines(lines: LineLike[], plane: THREE.Plane, xray: SectionXray): void {
    const live = new Set<THREE.Object3D>(lines);
    for (const src of lines) {
      const material = src.material;
      if (!(material.clippingPlanes?.length === 1 && material.clippingPlanes[0] === plane)) {
        material.clippingPlanes = [plane];
        material.needsUpdate = true;
        this.clipped.add(material);
      }
      let ghost = this.ghosts.get(src);
      if (ghost && (ghost.parent !== src.parent || !src.parent)) { ghost.removeFromParent(); ghost = undefined; }
      if (!ghost) {
        if (!src.parent) continue;
        ghost = src.clone(false) as LineLike;
        ghost.material = material.clone() as LineLike['material'];
        ghost.userData = { isSectionGhost: true, isSectionCap: true }; // never picked, exported or cut again
        ghost.raycast = () => {};
        ghost.castShadow = false;
        ghost.receiveShadow = false;
        ghost.material.clippingPlanes = [this.ghostPlane!];
        ghost.material.needsUpdate = true;
        src.parent.add(ghost);
        this.ghosts.set(src, ghost);
      }
      const gm = ghost.material;
      gm.depthWrite = false;
      const opacity = xray.opacity ?? material.opacity ?? 1;
      gm.opacity = opacity;
      gm.transparent = opacity < 1;
      if (material.color && gm.color) gm.color.set(xray.color ?? material.color.getHex());
      if (material.linewidth !== undefined) gm.linewidth = material.linewidth;
      if (material.resolution && gm.resolution) gm.resolution.copy(material.resolution);
      ghost.renderOrder = src.renderOrder;
      ghost.visible = opacity > 0 && src.visible;
    }
    for (const [src, ghost] of this.ghosts) {
      if (!live.has(src)) {
        ghost.removeFromParent();
        (ghost.material as THREE.Material).dispose();
        this.ghosts.delete(src);
      }
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
    for (const ghost of this.ghosts.values()) {
      ghost.removeFromParent();
      (ghost.material as THREE.Material).dispose();
    }
    this.ghosts.clear();
    this.ghostSource = null;
  }
}
