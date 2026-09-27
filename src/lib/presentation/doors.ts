import * as THREE from 'three';
import { easeInOutCubic } from './classify';

/**
 * Doors that open when clicked in presentation mode and on the client page.
 *
 * A door is drawn as one merged geometry (frame, leaf, glass and handles together, in material
 * groups). To move the leaf, the geometry is split into the boxes it was merged from (each one a
 * separate connected piece) and each piece is sorted by where it sits: the outer 5 cm is frame,
 * everything inside is leaf. The frame stays in the door mesh; each leaf becomes a child mesh on
 * a hinge. Closing puts the original geometry back.
 */

export type DoorMotion = 'swing' | 'double' | 'slide' | 'slide-half' | 'pivot' | 'none';

export function doorMotion(style: string | undefined): DoorMotion {
  switch (style) {
    case 'double-french':
    case 'bifold':
      return 'double';
    case 'barn':
      return 'slide';
    case 'patio-sliding':
      return 'slide-half';
    case 'pivot':
      return 'pivot';
    default:
      return style?.startsWith('archway') ? 'none' : 'swing';
  }
}

const FRAME = 0.051;

interface Piece { tris: number[]; box: THREE.Box3 }

/** The separate pieces of a merged geometry (triangles joined by shared corners). */
export function pieces(geometry: THREE.BufferGeometry): Piece[] {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = (index ? index.count : pos.count) / 3;
  const vert = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const parent = new Int32Array(pos.count).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  // A box's faces don't share vertices (each has its own normals), so join vertices that sit at
  // the same place too: then each box is one piece.
  const at = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const other = at.get(key);
    if (other === undefined) at.set(key, i); else union(i, other);
  }
  for (let t = 0; t < triCount; t++) { union(vert(t, 0), vert(t, 1)); union(vert(t, 1), vert(t, 2)); }
  const byRoot = new Map<number, Piece>();
  const v = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const root = find(vert(t, 0));
    let p = byRoot.get(root);
    if (!p) { p = { tris: [], box: new THREE.Box3() }; byRoot.set(root, p); }
    p.tris.push(t);
    for (let k = 0; k < 3; k++) p.box.expandByPoint(v.fromBufferAttribute(pos, vert(t, k)));
  }
  return [...byRoot.values()];
}

/** True for a piece of the door frame (jambs, header, rails, tracks), which stays put: it reaches the opening's edge. */
export function isFramePiece(box: THREE.Box3, width: number, height: number): boolean {
  const size = box.getSize(new THREE.Vector3());
  if (box.min.x < -width / 2 + 0.02 || box.max.x > width / 2 - 0.02) return true;
  if (box.max.y > height / 2 - 0.02) return true;
  // Bottom tracks of sliding and folding doors: long, low, flat.
  if (box.min.y < -height / 2 + 0.03 && size.y < 0.05) return true;
  return false;
}

/** A new geometry from some triangles of `source`, keeping their material groups. */
function subset(source: THREE.BufferGeometry, tris: Set<number>, offset: THREE.Vector3): THREE.BufferGeometry {
  const index = source.index;
  const names = Object.keys(source.attributes).filter(n => n === 'position' || n === 'normal' || n === 'uv');
  const groups = source.groups.length ? source.groups : [{ start: 0, count: index ? index.count : source.attributes.position.count, materialIndex: 0 }];
  const out: Record<string, number[]> = Object.fromEntries(names.map(n => [n, []]));
  const outGroups: { start: number; count: number; materialIndex: number }[] = [];
  let written = 0;
  for (const g of groups) {
    const start = written;
    for (let i = g.start; i < g.start + g.count; i += 3) {
      const t = i / 3;
      if (!tris.has(t)) continue;
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(i + k) : i + k;
        for (const n of names) {
          const a = source.attributes[n] as THREE.BufferAttribute;
          for (let c = 0; c < a.itemSize; c++) out[n].push(a.getComponent(vi, c));
        }
        const p = out.position;
        p[p.length - 3] -= offset.x; p[p.length - 2] -= offset.y; p[p.length - 1] -= offset.z;
      }
      written += 3;
    }
    if (written > start) outGroups.push({ start, count: written - start, materialIndex: g.materialIndex ?? 0 });
  }
  const geo = new THREE.BufferGeometry();
  for (const n of names) geo.setAttribute(n, new THREE.Float32BufferAttribute(out[n], (source.attributes[n] as THREE.BufferAttribute).itemSize));
  outGroups.forEach(g => geo.addGroup(g.start, g.count, g.materialIndex));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

interface Leaf {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  /** 'swing': turn about the hinge by up to `amount` radians; 'slide': move along x by `amount` metres. */
  kind: 'swing' | 'slide';
  amount: number;
}

interface OpenDoor {
  mesh: THREE.Mesh;
  original: THREE.BufferGeometry;
  frame: THREE.BufferGeometry;
  leaves: Leaf[];
  t: number;
  target: 0 | 1;
}

const AUX = 'presentationAux';
const SWING = THREE.MathUtils.degToRad(95);

export class DoorOpener {
  private doors = new Map<THREE.Mesh, OpenDoor>();

  isOpen(mesh: THREE.Mesh) {
    return this.doors.get(mesh)?.target === 1;
  }

  /** Opens a closed door or closes an open one. `viewer` is the camera position (doors open away from it). */
  toggle(mesh: THREE.Mesh, size: { width: number; height: number }, style: string | undefined, viewer: THREE.Vector3) {
    const existing = this.doors.get(mesh);
    if (existing) { existing.target = existing.target === 1 ? 0 : 1; return; }
    const motion = doorMotion(style);
    if (motion === 'none') return;
    const built = this.split(mesh, size, motion, viewer);
    if (built) this.doors.set(mesh, built);
  }

  private split(mesh: THREE.Mesh, { width, height }: { width: number; height: number }, motion: DoorMotion, viewer: THREE.Vector3): OpenDoor | null {
    const original = mesh.geometry;
    const all = pieces(original);
    const frameTris = new Set<number>();
    const leafSets: { tris: Set<number>; hingeX: number; kind: 'swing' | 'slide'; sign: number; amount: number }[] = [];
    const inner = width / 2 - FRAME;
    // Doors open away from whoever is looking: the side of the door the camera is on.
    const local = mesh.worldToLocal(viewer.clone());
    const away = local.z > 0 ? 1 : -1;
    const left = { tris: new Set<number>(), hingeX: -inner, kind: 'swing' as const, sign: away, amount: SWING };
    const right = { tris: new Set<number>(), hingeX: inner, kind: 'swing' as const, sign: -away, amount: SWING };
    const panel = { tris: new Set<number>(), hingeX: 0, kind: 'slide' as const, sign: 1, amount: 0 };
    for (const p of all) {
      if (isFramePiece(p.box, width, height)) { p.tris.forEach(t => frameTris.add(t)); continue; }
      const cx = p.box.getCenter(new THREE.Vector3()).x;
      const target = motion === 'double' ? (cx < 0 ? left : right)
        : motion === 'slide-half' ? (cx > 0 ? panel : null)
        : motion === 'slide' ? panel
        : left;
      if (target) p.tris.forEach(t => target.tris.add(t));
      else p.tris.forEach(t => frameTris.add(t));
    }
    if (motion === 'double') leafSets.push(left, right);
    else if (motion === 'slide') leafSets.push({ ...panel, amount: inner * 2 * 0.96 });
    else if (motion === 'slide-half') leafSets.push({ ...panel, amount: -inner * 0.96 });
    else if (motion === 'pivot') leafSets.push({ ...left, hingeX: -inner + 0.12 });
    else leafSets.push(left);
    const usable = leafSets.filter(l => l.tris.size);
    if (!usable.length) return null;

    const frame = subset(original, frameTris, new THREE.Vector3());
    const leaves: Leaf[] = usable.map(l => {
      const hinge = new THREE.Vector3(l.hingeX, 0, 0);
      const geo = subset(original, l.tris, l.kind === 'swing' ? hinge : new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.userData[AUX] = true;
      if (l.kind === 'swing') pivot.position.copy(hinge);
      const leafMesh = new THREE.Mesh(geo, mesh.material);
      leafMesh.userData[AUX] = true;
      leafMesh.castShadow = mesh.castShadow;
      leafMesh.receiveShadow = mesh.receiveShadow;
      pivot.add(leafMesh);
      mesh.add(pivot);
      return { pivot, mesh: leafMesh, kind: l.kind, amount: l.kind === 'swing' ? l.amount * l.sign : l.amount };
    });
    mesh.geometry = frame;
    return { mesh, original, frame, leaves, t: 0, target: 1 };
  }

  /** Moves doors towards open or shut; `dt` in seconds. */
  update(dt: number) {
    for (const [mesh, d] of this.doors) {
      // The viewport rebuilt the door (an edit): forget our split and start again closed.
      if (mesh.geometry !== d.frame) { this.drop(d, false); continue; }
      const step = dt / 0.9;
      d.t = d.target === 1 ? Math.min(1, d.t + step) : Math.max(0, d.t - step);
      const e = easeInOutCubic(d.t);
      for (const l of d.leaves) {
        l.mesh.material = mesh.material;
        if (l.kind === 'swing') l.pivot.rotation.y = l.amount * e;
        else l.pivot.position.x = l.amount * e;
      }
      if (d.t === 0 && d.target === 0) this.drop(d, true);
    }
  }

  private drop(d: OpenDoor, restore: boolean) {
    for (const l of d.leaves) { l.pivot.removeFromParent(); l.mesh.geometry.dispose(); }
    if (restore && d.mesh.geometry === d.frame) d.mesh.geometry = d.original;
    d.frame.dispose();
    this.doors.delete(d.mesh);
  }

  /** Every door shut at once and put back as it was. */
  dispose() {
    for (const d of [...this.doors.values()]) {
      if (d.mesh.geometry === d.frame) d.mesh.geometry = d.original;
      this.drop(d, false);
    }
  }
}
