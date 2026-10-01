import * as THREE from 'three';
import type { Shape } from '../../types';
import {
  buildPose, buildSchedule, categoryOf, explodeLift, isCuttable, isShell, levelFor, lookAt, storeyElevations,
  type BuildSlot, type Look, type PresentCategory,
} from './classify';
import { floorPlans } from './floorPlans';
import { plantHeight, plantSpread } from './plants';
import { pencilDrawing, pencilDrawCount, pencilMaterial, pencilSeconds, type PencilDrawing } from './pencil';
import type { PresentationState } from './store';

/**
 * Presentation effects applied straight to the rendered three.js scene: exploded view, section
 * cuts with solid (poché) caps, x-ray, the build-up animation, the look stages (sketch, white
 * massing model, detailed model, built) and evening light. Nothing here touches the model's data,
 * so leaving presentation mode puts every object back exactly as it was.
 *
 * Objects are found by the `userData.isShape` / `userData.isKernelGeometry` marks the viewport
 * already puts on each shape's root. React may rewrite a root's position at any time (an edit, a
 * re-render); each frame an entry notices that and takes the new value as its base.
 */

interface Entry {
  instance?: { mesh: THREE.InstancedMesh; index: number };
  instanceWrote?: THREE.Matrix4;
  spread: THREE.Vector3;
  obj: THREE.Object3D;
  key: string;
  category: PresentCategory;
  level: number;
  /** A tree or plant (drawn as a pencil outline until the Built stage). */
  plant: boolean;
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
  /** X-ray drops a door's or window's glass faces: the mesh shows `dropped` until restored. */
  glassFree?: { original: THREE.BufferGeometry; dropped: THREE.BufferGeometry };
}

interface LightRecord {
  intensity: number;
  color: THREE.Color | null;
  wrote: number;
}

const AUX = 'presentationAux';
const EPS = 1e-4;

const PAPER = new THREE.Color('#f1ebdf');
const CARD = new THREE.Color('#ffffff');
const PAPER_SKY = new THREE.Color('#e9e4d9');
const CARD_SKY = new THREE.Color('#eceae5');
const DUSK_SKY = new THREE.Color('#1e2a40');
const SUNSET = new THREE.Color('#ff9a57');

/** Sketch shows roof form, including flat decks and gable infill, before trim and tiles. */
function isBasicRoof(shape: Shape | undefined): boolean {
  if (!shape) return false;
  return !shape.tags?.includes('roof-part') || Boolean(shape.tags?.some(tag => tag === 'roof-deck' || tag === 'roof-pediment'));
}

function rootsOf(scene: THREE.Object3D) {
  const roots: { obj: THREE.Object3D; id: string | null; batched?: boolean; instance?: { mesh: THREE.InstancedMesh; index: number } }[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o.userData?.[AUX]) return;
    if ((o as THREE.InstancedMesh).isInstancedMesh && o.userData.presentationTimber) {
      const mesh = o as THREE.InstancedMesh;
      (o.userData.presentationTimber as string[]).forEach((id, index) => {
        if (index < mesh.count) roots.push({ obj: mesh, id, instance: { mesh, index } });
      });
      return;
    }
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

/** True for a material that is already faint, like window glass or a helper overlay. */
function isFaint(m: THREE.Material): boolean {
  return m.transparent && m.opacity < 0.5;
}

/** A copy of `geometry` without the faces drawn with the given materials (its groups' materialIndex). */
function withoutMaterials(geometry: THREE.BufferGeometry, drop: Set<number>): THREE.BufferGeometry | null {
  if (!geometry.groups.length) return null;
  const source = geometry.index ? geometry.index.array : null;
  const total = geometry.index ? geometry.index.count : geometry.attributes.position.count;
  const out: number[] = [];
  for (const g of geometry.groups) {
    if (drop.has(g.materialIndex ?? 0)) continue;
    const end = Math.min(g.start + g.count, total);
    for (let i = g.start; i < end; i++) out.push(source ? source[i] : i);
  }
  const clone = geometry.clone();
  clone.setIndex(out);
  clone.clearGroups();
  return clone;
}

/** Glass and other see-through surfaces. */
function isGlassy(material: THREE.Material | THREE.Material[]): boolean {
  const all = Array.isArray(material) ? material : [material];
  return all.every(m => m.transparent && m.opacity < 0.9);
}

const auxify = <T extends THREE.Object3D>(o: T): T => {
  o.userData[AUX] = true;
  o.raycast = () => {};
  return o;
};

export class PresentationEngine {
  private entries = new Map<string, Entry>();
  private shapes = new Map<string, Shape>();
  private shapeList: Shape[] = [];
  private elevations: number[] = [];
  private schedule = new Map<string, BuildSlot>();
  private explodeNow = 0;
  private stageNow = 3;
  private duskNow = 0;
  private materialMode = '';
  private materials = new Map<THREE.Mesh, MaterialRecord>();
  private cutClones = new Map<THREE.Material, THREE.Material>();
  private aux: THREE.Object3D[] = [];
  private edgeCache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private frame = 0;
  private sinceCollect = 0;
  private sinceMaterials = 0;
  private touched = false;
  private treeSketch: THREE.Group | null = null;
  /** How much of the Sketch stage's pencil drawing has been drawn so far (0-1). */
  private sketchT = 1;
  private inSketch = false;
  private sketchLines: { line: THREE.LineSegments; drawing: PencilDrawing; rank: number; start: number; span: number }[] = [];
  private sketchEdgeCache = new Map<THREE.BufferGeometry, PencilDrawing>();
  private sketchScheduleDirty = false;
  private sketchControlled = false;
  private hiddenEdges = new Map<THREE.Object3D, boolean>();
  private roomLights: THREE.Group | null = null;
  private lights = new Map<THREE.Light, LightRecord>();
  private envIntensity: number | null = null;
  private hiddenGrass = new Map<THREE.Object3D, boolean>();
  private background: { original: THREE.Scene['background'] } | null = null;
  private readonly backdrop = new THREE.Color();
  /** The colour the page shows behind the canvas (set by the driver). */
  pageColour = new THREE.Color('#ffffff');

  readonly plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2);
  private readonly planes = [this.plane];
  private readonly emergencePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly emergencePlanes = [this.emergencePlane];
  private readonly emergenceCutPlanes = [this.emergencePlane, this.plane];
  private modelBox: THREE.Box3 | null = null;
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
  // The architectural model: card-white, matte.
  // A little self-light keeps the card white in shade, like a real model under studio light.
  private readonly clay = new THREE.MeshStandardMaterial({ color: CARD.clone(), roughness: 0.92, metalness: 0, emissive: CARD.clone(), emissiveIntensity: 0.28, transparent: true });
  private readonly groundClay = new THREE.MeshStandardMaterial({ color: '#efeae1', roughness: 1, metalness: 0, emissive: '#efeae1', emissiveIntensity: 0.2 });
  private readonly glass = new THREE.MeshStandardMaterial({
    color: '#dfe8ec', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false,
  });
  private readonly hidden = new THREE.MeshBasicMaterial({ visible: false });
  private readonly clayOver = new THREE.MeshStandardMaterial({
    color: CARD.clone(), roughness: 0.92, metalness: 0, transparent: true, opacity: 1, depthWrite: false,
    emissive: CARD.clone(), emissiveIntensity: 0.28,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  private readonly pencilInk = pencilMaterial('#4d463e');
  private readonly pencil = this.pencilInk.material;
  /** A second, fainter and slightly offset pass over each line, so the drawing looks hand-made. */
  private readonly pencilSoftInk = pencilMaterial('#6b6258',true);
  private readonly pencilSoft = this.pencilSoftInk.material;
  private readonly treePencil = new THREE.LineBasicMaterial({ color: '#6b6258', transparent: true, opacity: 0.9, depthWrite: false });

  constructor(private scene: THREE.Scene) {}

  /** Re-reads the model after it changes: new shapes join, deleted ones drop out. */
  sync(shapes: Shape[]) {
    this.shapeList = shapes;
    this.shapes = new Map(shapes.map(s => [s.id, s]));
    this.elevations = storeyElevations(shapes);
    this.collect();
    this.disposeTreeSketch();
    this.disposeRoomLights();
  }

  private collect() {
    // Measure rest poses, never last frame's exploded/hidden positions.
    this.restoreTransforms();
    this.scene.updateMatrixWorld();
    const seen = new Set<string>();
    for (const root of rootsOf(this.scene)) {
      const { id, batched = false, instance } = root;
      const key = instance ? `${root.obj.uuid}:${id}` : root.obj.uuid;
      seen.add(key);
      const existing = this.entries.get(key);
      const obj = instance ? (existing?.obj ?? new THREE.Object3D()) : root.obj;
      if (instance) {
        const matrix = new THREE.Matrix4();
        instance.mesh.getMatrixAt(instance.index, matrix);
        matrix.decompose(obj.position, obj.quaternion, obj.scale);
        obj.parent = instance.mesh;
        obj.updateMatrixWorld(true);
      }
      const shape = id ? this.shapes.get(id) : undefined;
      const category = batched ? 'landscape' : categoryOf(shape);
      const plant = batched || shape?.type === 'tree' || shape?.type === 'bush';
      if (instance && !instance.mesh.geometry.boundingBox) instance.mesh.geometry.computeBoundingBox();
      const box = instance ? instance.mesh.geometry.boundingBox!.clone().applyMatrix4(obj.matrixWorld)
        : category === 'terrain' || batched ? new THREE.Box3() : new THREE.Box3().setFromObject(obj);
      const level = box.isEmpty() ? 0 : levelFor(category === 'slab' ? box.max.y : box.min.y, this.elevations);
      const parent = obj.parent ?? this.scene;
      const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      const up = new THREE.Vector3(0, 1, 0).applyMatrix4(inv).sub(new THREE.Vector3(0, 0, 0).applyMatrix4(inv));
      const lift = explodeLift(category, level, Math.max(1, this.elevations.length));
      if (existing) {
        Object.assign(existing, { category, level, up, box, lift, plant, instance });
        existing.base.copy(obj.position);
        existing.baseScale.copy(obj.scale);
        existing.baseVisible = obj.visible;
        continue;
      }
      // A plant that has just finished loading: redraw the pencil trees at its real size.
      if (plant) this.disposeTreeSketch();
      this.entries.set(key, {
        obj, key, category, level, up, box, lift, batched, plant, instance, spread: new THREE.Vector3(),
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
    const building = this.bounds();
    this.modelBox = building;
    const centre = building?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    for (const e of this.entries.values()) {
      const timber = ['frame', 'floorFrame', 'roofFrame'].includes(e.category);
      e.spread.set(0, 0, 0);
      if (!timber) continue;
      const c = e.box.getCenter(new THREE.Vector3());
      // Separate members from each other and from the enclosing wall/roof skin.
      const world = new THREE.Vector3((c.x - centre.x) * 0.4, e.category === 'roofFrame' ? -0.8 : 0.35, (c.z - centre.z) * 0.4);
      const inv = new THREE.Matrix4().copy((e.obj.parent ?? this.scene).matrixWorld).invert();
      e.spread.copy(world.applyMatrix4(inv).sub(new THREE.Vector3().applyMatrix4(inv)));
    }
  }

  /** Extent of the building (not the ground or garden), for the cut sliders. */
  bounds(): THREE.Box3 | null {
    const box = new THREE.Box3();
    for (const e of this.entries.values()) if (isCuttable(e.category) && !e.box.isEmpty()) box.union(e.box);
    if (box.isEmpty()) for (const e of this.entries.values()) if (e.category !== 'terrain') box.union(e.box);
    return box.isEmpty() ? null : box;
  }

  get storeys() { return this.elevations.length; }

  /** The stage the model is showing right now (it eases towards the one asked for). */
  get stage() { return this.stageNow; }

  /** Applies `state` for this frame. `dt` in seconds; `camera` turns the pencil trees to face it. */
  update(state: PresentationState, dt: number, camera?: THREE.Camera) {
    this.frame++;
    this.sinceCollect += dt;
    if (state.active && this.sinceCollect > 1) { this.sinceCollect = 0; this.collect(); }

    const ease = (now: number, target: number, rate: number, snap: number) => {
      const next = now + (target - now) * (1 - Math.exp(-dt * rate));
      return Math.abs(target - next) < snap ? target : next;
    };
    this.explodeNow = ease(this.explodeNow, state.active ? state.explode : 0, 5, 0.001);
    // Start a fresh sheet immediately, rather than briefly flashing the complete
    // model while the old Built state eases down to Sketch.
    if (state.active && state.stage < 0.02 && !this.inSketch) this.stageNow = 0;
    this.stageNow = ease(this.stageNow, state.active ? state.stage : 3, 7, 0.004);
    this.duskNow = ease(this.duskNow, state.active && state.dusk ? 1 : 0, 1.6, 0.003);
    const look = lookAt(this.stageNow);
    this.advanceSketch(state, dt);

    const build = state.active ? state.build : 1;
    const moving = this.explodeNow > 0 || build < 1 || !look.furniture || !look.plants;
    if (moving || this.touched) {
      for (const e of this.entries.values()) this.pose(e, build, look);
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
    const lookKey = look.mode === 'built' ? '' : `${look.mode}${look.glass ? 'g' : ''}${look.pencil > 0 ? 'p' : ''}`;
    const mode = state.active ? `${xray ? 'x' : ''}${cutOn ? 'c' : ''}${lookKey}` : '';
    if (mode !== this.materialMode) {
      this.restoreMaterials();
      this.materialMode = mode;
      if (mode) this.applyMaterials(xray, cutOn, look);
    } else if (mode && (this.sinceMaterials += dt) > 0.5) {
      this.sinceMaterials = 0;
      // Plants, fences and textures finish loading after the fact; catch their meshes too.
      this.applyMaterials(xray, cutOn, look);
    }

    // Per-frame looks: shared materials, so no re-assignment needed.
    // Solid volumes rise through the line drawing, matching the Sketch → Massing reveal.
    // Pencil edges keep the complete design visible while the white surfaces emerge.
    const emerging = state.active && look.surfaceOpacity < 1 && this.modelBox;
    if (emerging) this.emergencePlane.constant = this.modelBox!.min.y + (this.modelBox!.max.y - this.modelBox!.min.y) * look.surfaceOpacity;
    const clayPlanes = emerging ? (cutOn ? this.emergenceCutPlanes : this.emergencePlanes) : cutOn ? this.planes : null;
    if (this.clay.clippingPlanes !== clayPlanes) { this.clay.clippingPlanes = clayPlanes; this.clay.needsUpdate = true; }
    this.clay.color.copy(PAPER).lerp(CARD, look.whiteness);
    this.clay.emissive.copy(this.clay.color);
    this.clay.opacity = look.surfaceOpacity;
    this.clay.depthWrite = look.surfaceOpacity >= 0.99;
    for (const [mesh, rec] of this.materials) {
      if (rec.applied === this.clay) mesh.castShadow = rec.castShadow && look.surfaceOpacity >= 0.99;
    }
    this.clayOver.color.copy(this.clay.color);
    this.clayOver.emissive.copy(this.clay.color);
    this.clayOver.opacity = look.clayOver;
    this.pencil.opacity = look.pencil;
    this.pencilSoft.opacity = look.pencil * 0.45;
    this.pencilInk.roughness.value = look.pencilRoughness;
    this.pencilSoftInk.roughness.value = look.pencilRoughness;
    this.pencilInk.progress.value = this.pencilSoftInk.progress.value = this.sketchT;
    this.updateSourceEdges(state.active && look.pencil > 0);
    this.drawSketch();

    // Trees are pencilled in last, once the building has been drawn.
    const treesIn = this.sketchT >= 1 ? 1 : Math.min(1, Math.max(0, (this.sketchT - 0.85) / 0.15));
    this.updateTreeSketch(state.active ? look.treeSketch * treesIn : 0, look, camera);
    this.updateGrass(state.active && !look.plants);
    this.updateBackground(state.active, look, xray);
    this.updateDusk();
  }

  private pose(e: Entry, build: number, look: Look) {
    const o = e.obj;
    if (e.wrotePos && !o.position.equals(e.wrotePos)) e.base.copy(o.position);
    if (e.wroteScale && !o.scale.equals(e.wroteScale)) e.baseScale.copy(o.scale);
    if (e.wroteVisible !== null && o.visible !== e.wroteVisible) e.baseVisible = o.visible;

    const p = buildPose(this.schedule.get(e.key), build, e.category);
    if (e.batched) { p.drop = 0; p.scale = 1; }
    // Fittings and the timber frame show from the Detailed stage on, as before.
    const shape = this.shapes.get(e.instance ? this.instanceId(e) : String(e.obj.userData.id));
    const detail = e.category === 'other' || e.category === 'opening' || e.category === 'floorFrame' || e.category === 'frame' || e.category === 'roofFrame' || (shape?.tags?.includes('roof-part') && !isBasicRoof(shape));
    const byStage = e.plant ? look.plants : detail ? look.furniture : true;
    const dy = e.lift * this.explodeNow + p.drop;
    o.position.copy(e.base);
    if (Math.abs(dy) > EPS) o.position.addScaledVector(e.up, dy);
    o.position.addScaledVector(e.spread, this.explodeNow);
    o.scale.copy(e.baseScale).multiplyScalar(p.scale);
    o.visible = e.baseVisible && p.visible && byStage;
    e.wrotePos = (e.wrotePos ?? new THREE.Vector3()).copy(o.position);
    e.wroteScale = (e.wroteScale ?? new THREE.Vector3()).copy(o.scale);
    e.wroteVisible = o.visible;
    this.writeInstance(e);
  }

  private writeInstance(e: Entry) {
    if (!e.instance) return;
    const { mesh, index } = e.instance;
    if (mesh.userData.presentationTimber?.[index] !== this.instanceId(e)) return;
    e.obj.updateMatrix();
    const matrix = e.obj.matrix;
    if (!e.obj.visible) matrix.elements.fill(0, 0, 12);
    mesh.setMatrixAt(index, matrix);
    // GPU instance matrices use Float32 values. Keep the same precision for equality checks.
    e.instanceWrote ??= new THREE.Matrix4();
    mesh.getMatrixAt(index, e.instanceWrote);
    mesh.instanceMatrix.needsUpdate = true;
    // Instances travel beyond their rest bounds during build/explode.
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
  }

  private instanceId(e: Entry) { return e.key.slice(e.key.indexOf(':') + 1); }

  private restoreEntry(e: Entry) {
    const o = e.obj;
    if (e.instance && e.instanceWrote) {
      const current = new THREE.Matrix4();
      e.instance.mesh.getMatrixAt(e.instance.index, current);
      if (!current.equals(e.instanceWrote)) {
        // React has rebuilt/moved this instance since our last frame. Preserve that edit.
        current.decompose(o.position, o.quaternion, o.scale);
        e.base.copy(o.position);
        e.baseScale.copy(o.scale);
        e.wrotePos = null;
        e.wroteScale = null;
      }
    }
    if (e.wrotePos && o.position.equals(e.wrotePos)) o.position.copy(e.base);
    if (e.wroteScale && o.scale.equals(e.wroteScale)) o.scale.copy(e.baseScale);
    if (e.wroteVisible !== null && o.visible === e.wroteVisible) o.visible = e.baseVisible;
    e.wrotePos = null;
    e.wroteScale = null;
    e.wroteVisible = null;
    this.writeInstance(e);
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

  private edgesFor(geometry: THREE.BufferGeometry) {
    let edges = this.edgeCache.get(geometry);
    if (!edges) { edges = new THREE.EdgesGeometry(geometry, 30); this.edgeCache.set(geometry, edges); }
    return edges;
  }

  private applyMaterials(xray: boolean, cut: boolean, look: Look) {
    const clip = cut ? this.planes : null;
    for (const m of [this.ghost, this.ghostSlab, this.edgeMat, this.clay, this.groundClay, this.glass, this.clayOver, this.pencil, this.pencilSoft]) {
      if (m.clippingPlanes !== clip) { m.clippingPlanes = clip; m.needsUpdate = true; }
    }
    this.capMat.clippingPlanes = this.planes;

    for (const e of this.entries.values()) {
      const ghosted = xray && isShell(e.category);
      const clipped = cut && isCuttable(e.category);
      const modelLook = look.mode === 'clay';
      if (!ghosted && !clipped && look.mode === 'built') continue;
      meshesOf(e.instance?.mesh ?? e.obj, mesh => {
        const rec = this.materials.get(mesh);
        if (rec && mesh.material === rec.applied) return;
        // Hit targets and hidden helpers draw nothing; they must stay that way.
        if (!rec && !drawsSomething(mesh.material)) return;
        // New mesh, or React swapped its material since: (re)apply over what's there now.
        const original = mesh.material;
        const glassy = isGlassy(original) && !mesh.userData?.isWater;
        // Already-faint surfaces (window glass, overlays) would read as solid panels once every
        // shell surface is drawn as ghost, so x-ray leaves them out.
        if (ghosted && !rec && glassy && !mesh.userData?.isWater) return;
        let glassFree: MaterialRecord['glassFree'];
        if (ghosted && Array.isArray(original) && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
          const faint = new Set<number>();
          original.forEach((m, i) => { if (isFaint(m)) faint.add(i); });
          const dropped = faint.size ? withoutMaterials(mesh.geometry, faint) : null;
          if (dropped) { glassFree = { original: mesh.geometry, dropped }; mesh.geometry = dropped; }
        }
        const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh;
        let applied: THREE.Material | THREE.Material[];
        // A ghost or model material is one material, never an array: every face looks the same,
        // and the ambient occlusion pass reads `material.transparent`, which an array doesn't have.
        if (ghosted) applied = e.category === 'slab' ? this.ghostSlab : this.ghost;
        // Glass in windows and doors appears with the detailed model; other see-through bits
        // (overlays, helpers) stay out of the model until it's built.
        else if (modelLook) applied = glassy ? (look.glass && e.category === 'opening' ? this.glass : this.hidden) : e.category === 'terrain' ? this.groundClay : this.clay;
        else if (clipped) applied = Array.isArray(original) ? original.map(m => this.cutClone(m)) : this.cutClone(original);
        else applied = original;
        this.materials.set(mesh, { original, applied, castShadow: rec?.castShadow ?? mesh.castShadow, glassFree: rec?.glassFree ?? glassFree });
        mesh.material = applied;
        if (ghosted || applied === this.hidden || applied === this.glass) mesh.castShadow = false;
        if (rec) return;

        const small = mesh.geometry.attributes.position.count < 20000;
        if (ghosted && !instanced && small) this.addAux(mesh, new THREE.LineSegments(this.edgesFor(mesh.geometry), this.edgeMat));
        // Pencil outlines over the model.
        if (!ghosted && modelLook && look.pencil > 0 && !glassy && !instanced && (small || (e.category === 'roof' && isBasicRoof(this.shapes.get(String(e.obj.userData.id))))) && e.category !== 'terrain') {
          this.addSketchLines(mesh, e);
        }
        // Detailed → Built: the real materials show through a fading model layer.
        if (!ghosted && look.mode === 'fade' && !glassy && !instanced) {
          const over = new THREE.Mesh(mesh.geometry, this.clayOver);
          over.renderOrder = mesh.renderOrder + 1;
          this.addAux(mesh, over);
        }
        // Solid cut faces: the back faces seen through the cut read as the wall's section.
        if (clipped && !ghosted && !instanced && applied !== this.hidden && applied !== this.glass) {
          const cap = new THREE.Mesh(mesh.geometry, this.capMat);
          cap.renderOrder = mesh.renderOrder;
          this.addAux(mesh, cap);
        }
      });
    }
  }

  /** The stage timeline waits at Sketch until the drawing is finished. */
  holdsSketch(stage: number): boolean {
    return stage < 0.02 && (this.stageNow > 0.05 || this.sketchT < 1);
  }

  private advanceSketch(state: PresentationState, dt: number) {
    if (!state.active) { this.sketchT = 1; this.inSketch = false; return; }
    if (this.stageNow < 0.02 && !this.inSketch) { this.inSketch = true; this.sketchT = 0; this.sketchControlled = state.stagePlaying || state.stagePlaybackStarted; }
    else if (this.stageNow > 0.05) { this.inSketch = false; this.sketchT = 1; }
    if (state.stagePlaying) this.sketchControlled = true;
    if (this.inSketch && (!this.sketchControlled || state.stagePlaying)) {
      this.sketchT = Math.min(1, this.sketchT + dt / pencilSeconds(this.sketchLines.reduce((n,s)=>n+s.drawing.strokes,0)));
    }
  }

  /** Reveals each part's pencil lines in build order, so the design is drawn stroke by stroke. */
  private drawSketch() {
    if (this.sketchScheduleDirty) {
      this.sketchScheduleDirty = false;
      this.sketchLines.sort((a,b)=>a.rank-b.rank);
      const total = this.sketchLines.reduce((n,s)=>n+s.drawing.duration,0) || 1;
      let cursor = 0;
      for (const s of this.sketchLines) {
        s.start = cursor / total * 0.85; s.span = s.drawing.duration / total * 0.85;
        const times = s.line.geometry.attributes.pencilTime;
        const source = s.drawing.geometry.attributes.pencilTime;
        for(let i=0;i<times.count;i++) times.setX(i,s.start+source.getX(i)/s.drawing.duration*s.span);
        times.needsUpdate = true; cursor += s.drawing.duration;
      }
    }
    for (const s of this.sketchLines) {
      const f = this.sketchT >= 1 ? 1 : Math.min(1, Math.max(0, (this.sketchT - s.start) / Math.max(1e-8, s.span)));
      s.line.geometry.setDrawRange(0, f >= 1 ? Infinity : pencilDrawCount(s.drawing.ends,f*s.drawing.duration));
    }
  }

  /** The part's edges, ordered bottom-up so a pencil would plausibly travel through them. */
  private sketchEdgesFor(geometry: THREE.BufferGeometry) {
    let sorted = this.sketchEdgeCache.get(geometry);
    if (sorted) return sorted;
    sorted = pencilDrawing(this.edgesFor(geometry));
    this.sketchEdgeCache.set(geometry, sorted);
    return sorted;
  }

  private addSketchLines(mesh: THREE.Mesh, e: Entry) {
    if (!['slab','wall','roof','kernel','stair'].includes(e.category)) return;
    if (e.category === 'roof' && !isBasicRoof(this.shapes.get(String(e.obj.userData.id)))) return;
    const drawing = this.sketchEdgesFor(mesh.geometry);
    const geometry = drawing.geometry.clone();
    const slot = this.schedule.get(e.key) ?? { start: 0, span: 1 };
    const main = new THREE.LineSegments(geometry, this.pencil);
    const soft = new THREE.LineSegments(geometry, this.pencilSoft);
    this.addAux(mesh, main);
    this.addAux(mesh, soft);
    this.sketchLines.push({ line: main, drawing, rank: slot.start, start: 0, span: 1 });
    this.sketchScheduleDirty = true;
  }

  private updateSourceEdges(hide: boolean) {
    if (!hide) {
      for (const [line,visible] of this.hiddenEdges) line.visible = visible;
      this.hiddenEdges.clear(); return;
    }
    for (const e of this.entries.values()) e.obj.traverse(line => {
      if (!(line as THREE.Line).isLine || line.userData[AUX]) return;
      if (!this.hiddenEdges.has(line)) this.hiddenEdges.set(line,line.visible);
      line.visible = false;
    });
  }

  private addAux(parent: THREE.Object3D, child: THREE.Object3D) {
    parent.add(auxify(child));
    this.aux.push(child);
  }

  private restoreMaterials() {
    for (const [mesh, rec] of this.materials) {
      if (mesh.material === rec.applied) mesh.material = rec.original;
      if (rec.glassFree) {
        if (mesh.geometry === rec.glassFree.dropped) mesh.geometry = rec.glassFree.original;
        rec.glassFree.dropped.dispose();
      }
      mesh.castShadow = rec.castShadow;
    }
    this.materials.clear();
    for (const s of this.sketchLines) s.line.geometry.dispose();
    for (const a of this.aux) a.removeFromParent();
    this.aux = [];
    this.sketchLines = [];
  }

  // --- Pencil trees (Sketch to Detailed) -------------------------------------------------------

  /** The drawn size of each tree and plant, by shape id, from the meshes (batched ones included). */
  private plantBoxes(): Map<string, THREE.Box3> {
    const out = new Map<string, THREE.Box3>();
    const grow = (id: string, box: THREE.Box3) => {
      const had = out.get(id);
      if (had) had.union(box); else out.set(id, box.clone());
    };
    this.scene.updateMatrixWorld();
    const m = new THREE.Matrix4(), b = new THREE.Box3();
    for (const e of this.entries.values()) {
      if (!e.plant) continue;
      if (!e.batched) {
        const id = String(e.obj.userData.id);
        // Measure where it sits at rest, whatever the build-up or explode is doing to it.
        const was = e.obj.visible;
        e.obj.visible = true;
        grow(id, new THREE.Box3().setFromObject(e.obj));
        e.obj.visible = was;
        continue;
      }
      const mesh = e.obj as THREE.InstancedMesh;
      const ids = mesh.userData.plantIds as string[] | undefined;
      if (!ids || !mesh.geometry) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      for (let i = 0; i < Math.min(ids.length, mesh.count); i++) {
        mesh.getMatrixAt(i, m);
        m.premultiply(mesh.matrixWorld);
        grow(ids[i], b.copy(mesh.geometry.boundingBox!).applyMatrix4(m));
      }
    }
    return out;
  }

  private buildTreeSketch() {
    const group = auxify(new THREE.Group());
    const boxes = this.plantBoxes();
    let seed = 1;
    for (const s of this.shapeList) {
      if (s.hidden || (s.type !== 'tree' && s.type !== 'bush')) continue;
      const tree = s.type === 'tree';
      const box = boxes.get(s.id);
      let ground = s.position[1], r: number, cy: number;
      if (box && !box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        ground = box.min.y;
        r = Math.max(0.2, Math.min(size.x, size.z) * 0.46);
        // The canopy sits in the top of the tree; a bush is all canopy.
        cy = tree ? Math.max(r, size.y - r * 1.05) : size.y / 2;
        if (!tree) r = Math.max(r, size.y * 0.45);
      } else {
        const h = plantHeight(s) || (tree ? 6 : 1);
        const spread = plantSpread(s) || (tree ? 4 : 1.2);
        r = tree ? Math.min(spread / 2, h * 0.38) : spread / 2;
        cy = tree ? h - r * 0.95 : r * 0.8;
      }
      const g = auxify(new THREE.Group());
      g.position.set(s.position[0], ground + cy, s.position[2]);
      // Two slightly different hand-drawn loops read as a pencil line.
      for (let pass = 0; pass < 2; pass++) {
        const pts: THREE.Vector3[] = [];
        const k = seed++ * 1.7 + pass * 0.9;
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          const rr = r * (1 + 0.07 * Math.sin(5 * a + k) + 0.05 * Math.sin(9 * a + 2 * k) + pass * 0.02);
          pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0));
        }
        g.add(auxify(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.treePencil)));
      }
      if (tree && cy > r) {
        const trunk = [new THREE.Vector3(0, -r, 0), new THREE.Vector3(0.03 * r, -cy, 0)];
        g.add(auxify(new THREE.Line(new THREE.BufferGeometry().setFromPoints(trunk), this.treePencil)));
      }
      group.add(g);
    }
    this.scene.add(group);
    this.treeSketch = group;
  }

  private updateTreeSketch(opacity: number, look: Look, camera?: THREE.Camera) {
    if (opacity <= 0.001) {
      if (this.treeSketch) this.treeSketch.visible = false;
      return;
    }
    if (!this.treeSketch) this.buildTreeSketch();
    const group = this.treeSketch!;
    group.visible = true;
    this.treePencil.opacity = opacity * (look.pencil > 0 ? 0.9 : 0.7);
    if (camera) for (const g of group.children) g.quaternion.copy(camera.quaternion);
  }

  private disposeTreeSketch() {
    if (!this.treeSketch) return;
    this.treeSketch.traverse(o => (o as THREE.Line).geometry?.dispose?.());
    this.treeSketch.removeFromParent();
    this.treeSketch = null;
  }

  private updateGrass(hide: boolean) {
    if (hide) {
      this.scene.traverse(o => {
        if (o.userData?.isGrass && !this.hiddenGrass.has(o)) { this.hiddenGrass.set(o, o.visible); o.visible = false; }
      });
    } else if (this.hiddenGrass.size) {
      for (const [o, v] of this.hiddenGrass) o.visible = v;
      this.hiddenGrass.clear();
    }
  }

  // --- Backdrop: paper for the model stages, the page colour under x-ray, dusk sky ----------------

  private updateBackground(active: boolean, look: Look, xray: boolean) {
    const want = active && (look.paper > 0 || this.duskNow > 0 || xray);
    if (!want) {
      if (this.background) {
        if (this.scene.background === this.backdrop) this.scene.background = this.background.original;
        this.background = null;
      }
      return;
    }
    if (!this.background) this.background = { original: this.scene.background };
    const original = this.background.original;
    const c = this.backdrop;
    if (original && (original as THREE.Color).isColor) c.copy(original as THREE.Color);
    else if (original) c.set('#a9bccf');
    else c.copy(this.pageColour);
    const paper = PAPER_SKY.clone().lerp(CARD_SKY, look.whiteness);
    c.lerp(paper, look.paper).lerp(DUSK_SKY, this.duskNow * 0.92);
    this.scene.background = c;
  }

  // --- Evening light -----------------------------------------------------------------------------

  private buildRoomLights() {
    const group = auxify(new THREE.Group());
    const plans = floorPlans(this.shapeList, [], 300);
    let n = 0;
    for (const p of plans) {
      for (const r of p.rooms) {
        if (n++ >= 16) break;
        const light = new THREE.PointLight('#ffc07a', 0, Math.max(r.size[0], r.size[1]) * 1.4 + 2, 2);
        light.position.set(r.at[0], p.elevation + 2.1, r.at[1]);
        light.userData.baseIntensity = Math.min(40, 6 + r.areaM2 * 0.6);
        group.add(auxify(light));
      }
    }
    this.scene.add(group);
    this.roomLights = group;
  }

  private disposeRoomLights() {
    this.roomLights?.removeFromParent();
    this.roomLights = null;
  }

  private updateDusk() {
    const d = this.duskNow;
    if (d <= 0) {
      if (!this.lights.size && this.envIntensity === null && !this.roomLights) return;
      for (const [light, rec] of this.lights) {
        if (light.intensity === rec.wrote) light.intensity = rec.intensity;
        if (rec.color) light.color.copy(rec.color);
      }
      this.lights.clear();
      if (this.envIntensity !== null) { (this.scene as any).environmentIntensity = this.envIntensity; this.envIntensity = null; }
      this.disposeRoomLights();
      return;
    }
    this.scene.traverse(o => {
      const light = o as THREE.Light;
      if (!light.isLight || o.userData?.[AUX]) return;
      const kind = (light as THREE.DirectionalLight).isDirectionalLight ? 'sun'
        : (light as THREE.AmbientLight).isAmbientLight || (light as THREE.HemisphereLight).isHemisphereLight ? 'fill' : null;
      if (!kind) return;
      let rec = this.lights.get(light);
      if (!rec) {
        rec = { intensity: light.intensity, color: kind === 'sun' ? light.color.clone() : null, wrote: light.intensity };
        this.lights.set(light, rec);
      } else if (light.intensity !== rec.wrote) rec.intensity = light.intensity;
      const factor = kind === 'sun' ? 0.12 : 0.35;
      light.intensity = rec.intensity * (1 + (factor - 1) * d);
      rec.wrote = light.intensity;
      if (rec.color) light.color.copy(rec.color).lerp(SUNSET, d);
    });
    const scene = this.scene as any;
    if (this.envIntensity === null) this.envIntensity = scene.environmentIntensity ?? 1;
    scene.environmentIntensity = this.envIntensity! * (1 - 0.75 * d);
    if (!this.roomLights && this.elevations.length) this.buildRoomLights();
    this.roomLights?.children.forEach(l => { (l as THREE.PointLight).intensity = d * (l.userData.baseIntensity as number); });
  }

  /** Puts everything back and frees what the effects made. */
  dispose() {
    this.restoreTransforms();
    this.restoreMaterials();
    this.materialMode = '';
    this.duskNow = 0;
    this.updateDusk();
    this.updateGrass(false);
    this.updateBackground(false, lookAt(3), false);
    this.disposeTreeSketch();
    this.cutClones.forEach(c => c.dispose());
    this.cutClones.clear();
    this.edgeCache.forEach(g => g.dispose());
    this.updateSourceEdges(false);
    this.sketchEdgeCache.forEach(g => g.geometry.dispose());
    this.sketchEdgeCache.clear();
    for (const material of [this.ghost,this.ghostSlab,this.edgeMat,this.capMat,this.clay,this.groundClay,this.glass,this.hidden,this.clayOver,this.pencil,this.pencilSoft,this.treePencil]) material.dispose();
    this.edgeCache.clear();
    this.entries.clear();
    this.explodeNow = 0;
    this.stageNow = 3;
  }
}
