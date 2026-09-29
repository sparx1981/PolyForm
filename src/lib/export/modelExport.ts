import * as THREE from 'three';
import type { FaceId } from '../geometry/types';

/**
 * PolyForm — what goes into an exported file.
 *
 * The viewport's scene holds far more than the model: the grid, sky, lights and their gizmos,
 * tool previews, shadow-only stand-ins, grass blades, birds and rain. An export wants the model
 * alone, each piece exactly where it sits in the world, and each piece once. This file finds
 * those pieces; the format writers (glTF, STL, SketchUp) take it from there.
 *
 * What counts as the model:
 *   - drawn geometry (Line, Rectangle, Push/Pull ...), marked `isKernelGeometry`;
 *   - every object built from a shape, marked `isShape` or carrying the shape's `id`, together
 *     with everything drawn inside it (a wall's panels, a tree's branches);
 *   - batched trees (`plantIds`) and the timber frame (`presentationTimber`), one per instance.
 * What doesn't: anything hidden, light gizmos, grass and wildflowers, wireframe highlights,
 * shadow-only stand-ins, fat edge lines and screen-space text.
 */

export interface ExportItem {
  /** The shape this piece belongs to (null for drawn geometry and batched meshes). */
  ownerId: string | null;
  /** A readable name for the piece. */
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** Where each copy sits in the world: one for a plain mesh, one per instance for a batch. */
  matrices: THREE.Matrix4[];
  /** True for batched meshes (trees, timber): the same geometry placed many times. */
  instanced: boolean;
  /** Drawn geometry: which kernel face each triangle belongs to. */
  kernelFaceOfTriangle?: readonly FaceId[];
  /** Copies of the same component share this (see tools/kernelGroups.ts). */
  componentKey?: string;
}

type Tag = 'model' | 'kernel' | 'excluded' | null;

function tagOf(o: THREE.Object3D): Tag {
  const u = o.userData ?? {};
  if (u.isGrass || u.isFlowers || u.type === 'light' || u.isSectionCap) return 'excluded';
  if (u.isKernelGeometry) return 'kernel';
  if (u.isShape || typeof u.id === 'string' || Array.isArray(u.plantIds) || Array.isArray(u.presentationTimber)) return 'model';
  return null;
}

/** The nearest mark on the object or above it, and the shape id that goes with it. */
function ownerOf(o: THREE.Object3D): { tag: Tag; ownerId: string | null } {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const tag = tagOf(p);
    if (tag) return { tag, ownerId: typeof p.userData?.id === 'string' ? p.userData.id : null };
  }
  return { tag: null, ownerId: null };
}

/** Whether an object is part of the model (a shape, drawn geometry or a batch), not a helper. */
export function isModelObject(o: THREE.Object3D): boolean {
  const { tag } = ownerOf(o);
  return tag === 'model' || tag === 'kernel';
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function materialIsDrawable(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.some(m => {
    const mm = m as THREE.Material & { wireframe?: boolean; isLineMaterial?: boolean };
    return m.visible !== false && m.colorWrite !== false && !mm.wireframe && !mm.isLineMaterial;
  });
}

/** An instance squashed to nothing (how a batch hides one copy) isn't there. */
const isCollapsed = (m: THREE.Matrix4) => Math.abs(m.determinant()) < 1e-12;

/**
 * Every piece of the model under `root`, in world space. Each mesh appears once, with its own
 * world matrix - never its local position applied on top of the world one.
 */
export function collectModelItems(
  root: THREE.Object3D,
  nameOf?: (id: string) => string | undefined,
  componentOf?: (id: string) => string | undefined,
): ExportItem[] {
  root.updateMatrixWorld(true);
  const items: ExportItem[] = [];

  root.traverse(obj => {
    const mesh = obj as THREE.Mesh & { isInstancedMesh?: boolean; isLineSegments2?: boolean; isLine2?: boolean };
    if (!mesh.isMesh || mesh.isLineSegments2 || mesh.isLine2) return;
    const geometry = mesh.geometry as THREE.BufferGeometry & { isInstancedBufferGeometry?: boolean };
    // Instanced geometry here is screen-space glyphs or sprites, not model surfaces.
    if (!geometry?.getAttribute('position') || geometry.isInstancedBufferGeometry) return;
    if (!materialIsDrawable(mesh.material) || !isShown(mesh)) return;

    const { tag, ownerId } = ownerOf(mesh);
    if (tag !== 'model' && tag !== 'kernel') return;

    const name = (ownerId && nameOf?.(ownerId)) || ownerId || mesh.name || (tag === 'kernel' ? 'Drawn geometry' : 'Object');

    if (mesh.isInstancedMesh) {
      const inst = mesh as unknown as THREE.InstancedMesh;
      const matrices: THREE.Matrix4[] = [];
      const local = new THREE.Matrix4();
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, local);
        const world = new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, local);
        if (!isCollapsed(world)) matrices.push(world);
      }
      const batchName = mesh.name || (mesh.userData.plantIds ? 'Plant' : mesh.userData.presentationTimber ? 'Timber' : name);
      if (matrices.length) items.push({ ownerId, name: batchName, geometry, material: mesh.material, matrices, instanced: true });
      return;
    }

    if (isCollapsed(mesh.matrixWorld)) return;
    items.push({
      ownerId, name, geometry, material: mesh.material,
      matrices: [mesh.matrixWorld.clone()],
      instanced: false,
      kernelFaceOfTriangle: tag === 'kernel' ? mesh.userData.faceOfTriangle : undefined,
      componentKey: ownerId ? componentOf?.(ownerId) : undefined,
    });
  });

  return items;
}

/**
 * A fresh scene holding just the model, ready for the glTF and STL exporters. Geometry and
 * materials are shared with the viewport, not copied, and each copy carries its world
 * placement as its own (so nothing is transformed twice).
 */
export function buildExportScene(items: readonly ExportItem[]): THREE.Scene {
  const out = new THREE.Scene();
  for (const item of items) {
    item.matrices.forEach((matrix, i) => {
      const mesh = new THREE.Mesh(item.geometry, item.material);
      mesh.name = item.matrices.length > 1 ? `${item.name} ${i + 1}` : item.name;
      matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      out.add(mesh);
    });
  }
  out.updateMatrixWorld(true);
  return out;
}

/** A file name from the model's name, safe on every OS. */
export function exportFileName(modelName: string | null | undefined, extension: string): string {
  const base = (modelName || 'Model').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Model';
  return `${base}.${extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Some browsers start the download after click() returns; give them a moment.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
