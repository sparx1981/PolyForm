import * as THREE from 'three';
import type { Shape } from '../../types';
import {
  buildPose, buildSchedule, categoryOf, explodeLift, isCuttable, isShell, levelFor, storeyElevations,
  type BuildSlot, type PresentCategory,
} from './classify';
import type { PresentationState } from './store';

/**
 * Presentation effects applied straight to the rendered three.js scene: exploded view, section
 * cuts with solid (poché) caps, x-ray and the build-up animation. Nothing here touches the model's
 * data, so leaving presentation mode puts every object back exactly as it was.
 *
 * Objects are found by the `userData.isShape` / `userData.isKernelGeometry` marks the viewport
 * already puts on each shape's root. React may rewrite a root's position at any time (an edit, a
 * re-render); each frame an entry notices that and takes the new value as its base.
 */

interface Entry {
  obj: THREE.Object3D;
  key: string;
  category: PresentCategory;
  level: number;
  base: THREE.Vector3;
  baseScale: THREE.Vector3;
  baseVisible: boolean;
  /** Last values this engine wrote, to spot outside changes. */
  wrotePos: THREE.Vector3 | null;
  wroteScale: THREE.Vector3 | null;
  wroteVisible: boolean | null;
  /** Batched trees: many plants in one mesh, so they can only be shown or hidden, never moved or scaled. */
  batched: boolean;
  /** One metre of world "up" in the parent's space. */
  up: THREE.Vector3;
  box: THREE.Box3;
  lift: number;
}

interface MaterialRecord {
  original: THREE.Material | THREE.Material[];
  applied: THREE.Material | THREE.Material[];
  castShadow: boolean;
}

const AUX = 'presentationAux';
const EPS = 1e-4;

function rootsOf(scene: THREE.Object3D) {
  const roots: { obj: THREE.Object3D; id: string | null; batched?: boolean }[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o.userData?.[AUX]) return;
    if (o.userData?.presentationVegetation) { roots.push({ obj: o, id: null, batched: true }); return; }
    if (o.userData?.isShape) { roots.push({ obj: o, id: String(o.userData.id) }); return; }
    if (o.userData?.isKernelGeometry) { roots.push({ obj: o, id: null }); return; }
    for (const c of o.children) walk(c);
  };
  walk(scene);
  return roots;
}

function meshesOf(root: THREE.Object3D, visit: (m: THREE.Mesh) => void) {
  root.traverse(o => {
    if (o.userData?.[AUX]) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(o as any).isLine && m.geometry?.attributes?.position) visit(m);
  });
}

/** False for materials that are there only to be clicked or to write depth, never seen. */
function drawsSomething(material: THREE.Material | THREE.Material[]): boolean {
  const all = Array.isArray(material) ? material : [material];
  return all.some(m => m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity < 0.02));
}

export class PresentationEngine {
  private entries = new Map<string, Entry>();
  private shapes = new Map<string, Shape>();
  private elevations: number[] = [];
  private schedule = new Map<string, BuildSlot>();
  private explodeNow = 0;
  private materialMode = '';
  private materials = new Map<THREE.Mesh, MaterialRecord>();
  private cutClones = new Map<THREE.Material, THREE.Material>();
  private aux: THREE.Object3D[] = [];
  private edgeCache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private frame = 0;
  private touched = false;

  readonly plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2);
  private readonly planes = [this.plane];
  // Unlit, so it looks the same whatever the lighting and needs no normals. Front faces only:
  // with both sides, a wall's layers (and the pieces it's cut into round its windows) stack up
  // into grey slabs instead of reading as glass.
  private readonly ghost = new THREE.MeshBasicMaterial({
    color: '#cfe0f5', transparent: true, opacity: 0.14, depthWrite: false,
  });
  private readonly ghostSlab = new THREE.MeshBasicMaterial({
    color: '#dbe3ec', transparent: true, opacity: 0.4, depthWrite: false,
  });
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: '#3b82f6', transparent: true, opacity: 0.55 });
  private readonly capMat = new THREE.MeshBasicMaterial({ color: '#2b2f36', side: THREE.BackSide });

  constructor(private scene: THREE.Scene) {}

  /** Re-reads the model after it changes: new shapes join, deleted ones drop out. */
  sync(shapes: Shape[]) {
    this.shapes = new Map(shapes.map(s => [s.id, s]));
    this.elevations = storeyElevations(shapes);
    this.collect();
  }

  private collect() {
    this.scene.updateMatrixWorld();
    const seen = new Set<string>();
    for (const { obj, id, batched = false } of rootsOf(this.scene)) {
      const key = obj.uuid;
      seen.add(key);
      const existing = this.entries.get(key);
      const category = batched ? 'landscape' : categoryOf(id ? this.shapes.get(id) : undefined);
      const box = category === 'terrain' || batched ? new THREE.Box3() : new THREE.Box3().setFromObject(obj);
      const level = box.isEmpty() ? 0 : levelFor(category === 'slab' ? box.max.y : box.min.y, this.elevations);
      const parent = obj.parent ?? this.scene;
      const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      const up = new THREE.Vector3(0, 1, 0).applyMatrix4(inv).sub(new THREE.Vector3(0, 0, 0).applyMatrix4(inv));
      const lift = explodeLift(category, level, Math.max(1, this.elevations.length));
      if (existing) {
        Object.assign(existing, { category, level, up, box, lift });
        continue;
      }
      this.entries.set(key, {
        obj, key, category, level, up, box, lift, batched,
        base: obj.position.clone(), baseScale: obj.scale.clone(), baseVisible: obj.visible,
        wrotePos: null, wroteScale: null, wroteVisible: null,
      });
    }
    for (const [key, e] of this.entries) {
      if (!seen.has(key)) { this.restoreEntry(e); this.entries.delete(key); }
    }
    this.schedule = buildSchedule([...this.entries.values()].map(e => {
      const c = e.box.isEmpty() ? e.obj.position : e.box.getCenter(new THREE.Vector3());
      return { key: e.key, category: e.category, level: e.level, x: c.x, z: c.z };
    }));
  }

  /** Extent of the building (not the ground or garden), for the cut sliders. */
  bounds(): THREE.Box3 | null {
    const box = new THREE.Box3();
    for (const e of this.entries.values()) if (isCuttable(e.category) && !e.box.isEmpty()) box.union(e.box);
    if (box.isEmpty()) for (const e of this.entries.values()) if (e.category !== 'terrain') box.union(e.box);
    return box.isEmpty() ? null : box;
  }

  get storeys() { return this.elevations.length; }

  /** Applies `state` for this frame. `dt` in seconds. */
  update(state: PresentationState, dt: number) {
    this.frame++;
    if (state.active && this.frame % 60 === 0) this.collect();

    const target = state.active ? state.explode : 0;
    const k = 1 - Math.exp(-dt * 5);
    this.explodeNow += (target - this.explodeNow) * k;
    if (Math.abs(target - this.explodeNow) < 0.001) this.explodeNow = target;

    const build = state.active ? state.build : 1;
    const moving = this.explodeNow > 0 || build < 1;
    if (moving || this.touched) {
      for (const e of this.entries.values()) this.pose(e, build);
      this.touched = moving;
      if (!moving) this.restoreTransforms();
    }

    const cutOn = state.active && state.cut !== 'off';
    const xray = state.active && state.xray;
    if (cutOn) {
      const n = state.cut === 'plan' ? [0, -1, 0] : state.cut === 'section-x' ? [-1, 0, 0] : [0, 0, -1];
      const sign = state.cutFlip ? -1 : 1;
      this.plane.normal.set(n[0] * sign, n[1] * sign, n[2] * sign);
      this.plane.constant = state.cutAt * sign;
    }
    const mode = `${xray ? 'x' : ''}${cutOn ? 'c' : ''}`;
    if (mode !== this.materialMode) {
      this.restoreMaterials();
      this.materialMode = mode;
      if (mode) this.applyMaterials(xray, cutOn);
    } else if (mode && this.frame % 30 === 0) {
      // Plants, fences and textures finish loading after the fact; catch their meshes too.
      this.applyMaterials(xray, cutOn);
    }
  }

  private pose(e: Entry, build: number) {
    const o = e.obj;
    if (e.wrotePos && !o.position.equals(e.wrotePos)) e.base.copy(o.position);
    if (e.wroteScale && !o.scale.equals(e.wroteScale)) e.baseScale.copy(o.scale);
    if (e.wroteVisible !== null && o.visible !== e.wroteVisible) e.baseVisible = o.visible;

    const p = buildPose(this.schedule.get(e.key), build, e.category);
    if (e.batched) { p.drop = 0; p.scale = 1; }
    const dy = e.lift * this.explodeNow + p.drop;
    o.position.copy(e.base);
    if (Math.abs(dy) > EPS) o.position.addScaledVector(e.up, dy);
    o.scale.copy(e.baseScale).multiplyScalar(p.scale);
    o.visible = e.baseVisible && p.visible;
    e.wrotePos = (e.wrotePos ?? new THREE.Vector3()).copy(o.position);
    e.wroteScale = (e.wroteScale ?? new THREE.Vector3()).copy(o.scale);
    e.wroteVisible = o.visible;
  }

  private restoreEntry(e: Entry) {
    const o = e.obj;
    if (e.wrotePos && o.position.equals(e.wrotePos)) o.position.copy(e.base);
    if (e.wroteScale && o.scale.equals(e.wroteScale)) o.scale.copy(e.baseScale);
    if (e.wroteVisible !== null && o.visible === e.wroteVisible) o.visible = e.baseVisible;
    e.wrotePos = null;
    e.wroteScale = null;
    e.wroteVisible = null;
  }

  private restoreTransforms() {
    for (const e of this.entries.values()) this.restoreEntry(e);
  }

  private cutClone(m: THREE.Material): THREE.Material {
    let c = this.cutClones.get(m);
    if (!c) {
      c = m.clone();
      c.clippingPlanes = this.planes;
      c.clipShadows = true;
      this.cutClones.set(m, c);
    }
    return c;
  }

  private applyMaterials(xray: boolean, cut: boolean) {
    this.ghost.clippingPlanes = cut ? this.planes : null;
    this.ghostSlab.clippingPlanes = cut ? this.planes : null;
    this.edgeMat.clippingPlanes = cut ? this.planes : null;
    this.capMat.clippingPlanes = this.planes;
    this.ghost.needsUpdate = this.ghostSlab.needsUpdate = this.edgeMat.needsUpdate = true;

    for (const e of this.entries.values()) {
      const ghosted = xray && isShell(e.category);
      const clipped = cut && isCuttable(e.category);
      if (!ghosted && !clipped) continue;
      meshesOf(e.obj, mesh => {
        const rec = this.materials.get(mesh);
        if (rec && mesh.material === rec.applied) return;
        // Hit targets and hidden helpers draw nothing; they must stay that way.
        if (!rec && !drawsSomething(mesh.material)) return;
        // New mesh, or React swapped its material since: (re)apply over what's there now.
        const original = mesh.material;
        const ghost = e.category === 'slab' ? this.ghostSlab : this.ghost;
        // A ghost is one material, never an array: every face looks the same, and the ambient
        // occlusion pass reads `material.transparent`, which an array doesn't have - it would
        // shade the see-through wall as if it were solid.
        const applied = ghosted ? ghost : Array.isArray(original) ? original.map(m => this.cutClone(m)) : this.cutClone(original);
        this.materials.set(mesh, { original, applied, castShadow: rec?.castShadow ?? mesh.castShadow });
        mesh.material = applied;
        if (ghosted) mesh.castShadow = false;
        if (rec) return;

        if (ghosted && !(mesh as THREE.InstancedMesh).isInstancedMesh && mesh.geometry.attributes.position.count < 6000) {
          let edges = this.edgeCache.get(mesh.geometry);
          if (!edges) { edges = new THREE.EdgesGeometry(mesh.geometry, 30); this.edgeCache.set(mesh.geometry, edges); }
          const lines = new THREE.LineSegments(edges, this.edgeMat);
          lines.userData[AUX] = true;
          lines.raycast = () => {};
          mesh.add(lines);
          this.aux.push(lines);
        }
        // Solid cut faces: the back faces seen through the cut read as the wall's section.
        if (clipped && !ghosted && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
          const cap = new THREE.Mesh(mesh.geometry, this.capMat);
          cap.userData[AUX] = true;
          cap.raycast = () => {};
          cap.renderOrder = mesh.renderOrder;
          mesh.add(cap);
          this.aux.push(cap);
        }
      });
    }
  }

  private restoreMaterials() {
    for (const [mesh, rec] of this.materials) {
      if (mesh.material === rec.applied) mesh.material = rec.original;
      mesh.castShadow = rec.castShadow;
    }
    this.materials.clear();
    for (const a of this.aux) a.removeFromParent();
    this.aux = [];
  }

  /** Puts everything back and frees what the effects made. */
  dispose() {
    this.restoreTransforms();
    this.restoreMaterials();
    this.materialMode = '';
    this.cutClones.forEach(c => c.dispose());
    this.cutClones.clear();
    this.edgeCache.forEach(g => g.dispose());
    this.edgeCache.clear();
    this.entries.clear();
    this.explodeNow = 0;
  }
}
