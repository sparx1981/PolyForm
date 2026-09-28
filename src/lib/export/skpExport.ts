import * as THREE from 'three';
import { create, METRES_TO_INCHES, type ComponentDefinitionBuilder, type Matrix3x3, type Point3, type SkpBuilder } from 'openskp';
import type { FaceId, Graph } from '../geometry/types';
import { loopPoints } from '../geometry/topology';
import type { ExportItem } from './modelExport';

/**
 * PolyForm — save the model as a real SketchUp file.
 *
 * Written with OpenSKP's `.skp` writer (SketchUp 2013-2020 format; newer SketchUp opens it
 * as is). How the model maps onto SketchUp:
 *   - drawn geometry (Line, Rectangle, Push/Pull ...) becomes loose faces, one SketchUp face per
 *     PolyForm face, holes included;
 *   - each other object (a wall, a roof, a terrain, a plant) becomes a group named after it;
 *   - batched trees and timber become one component each, placed once per copy, so a garden of
 *     two hundred trees stores one tree;
 *   - colours and transparency travel as named materials (textures don't yet).
 * Triangle meshes are stitched back into flat faces where their triangles share a plane, so
 * a wall arrives as six faces, not twelve triangles; surfaces that were shaded smooth (a dome,
 * a trunk) keep their edges soft, as SketchUp does for curved surfaces.
 *
 * Units and axes: PolyForm works in metres with y up; SketchUp in inches with z up.
 */

export interface SkpExportResult {
  bytes: Uint8Array;
  /** SketchUp faces written. */
  faces: number;
  /** Faces that couldn't be written (degenerate slivers). */
  skipped: number;
}

const K = METRES_TO_INCHES;

/** PolyForm world (metres, y up) to SketchUp (inches, z up). */
export const toSkpPoint = (x: number, y: number, z: number): Point3 => [round(x * K), round(-z * K), round(y * K)];

const round = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r; // no -0 in the file
};

/**
 * The 3x3 part of a PolyForm world matrix, re-expressed in SketchUp's axes (row-major, acting
 * on column vectors, as OpenSKP expects). With A the axis change: A * M * A^-1.
 */
export function toSkpMatrix3(m: THREE.Matrix4): Matrix3x3 {
  const e = m.elements; // column-major
  const M = [
    [e[0], e[4], e[8]],
    [e[1], e[5], e[9]],
    [e[2], e[6], e[10]],
  ];
  // A maps (x, y, z) to (x, -z, y); A^-1 maps (x, y, z) to (x, z, -y).
  const A = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const Ai = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const mul = (P: number[][], Q: number[][]) =>
    P.map((row, i) => Q[0].map((_, j) => row.reduce((s, _v, k) => s + P[i][k] * Q[k][j], 0)));
  const R = mul(mul(A, M), Ai);
  return R.flat().map(v => round(v)) as Matrix3x3;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

interface MaterialSpec { name: string; rgb: [number, number, number]; opacity: number }

function materialSpec(m: THREE.Material | undefined): MaterialSpec {
  const color = (m as THREE.Material & { color?: THREE.Color })?.color;
  const hex = color ? color.getHex() : 0xffffff;
  const rgb: [number, number, number] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const opacity = m?.transparent ? Math.max(0, Math.min(1, m.opacity)) : 1;
  const hexName = `#${hex.toString(16).padStart(6, '0')}`;
  return { name: m?.name?.trim() || hexName, rgb, opacity };
}

class MaterialTable {
  private byKey = new Map<string, number>();
  private names = new Set<string>();
  constructor(private builder: SkpBuilder) {}

  handle(m: THREE.Material | undefined): number {
    const spec = materialSpec(m);
    const key = `${spec.name}|${spec.rgb.join(',')}|${spec.opacity}`;
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    let name = spec.name;
    for (let i = 2; this.names.has(name); i++) name = `${spec.name} (${i})`;
    this.names.add(name);
    const h = this.builder.addMaterial(name, spec.rgb, spec.opacity);
    this.byKey.set(key, h);
    return h;
  }
}

// ---------------------------------------------------------------------------
// Faces from a triangle mesh
// ---------------------------------------------------------------------------

/** One SketchUp face to write: an outer loop, its holes, and the triangles to fall back on. */
export interface SkpFace {
  outer: Point3[];
  holes: Point3[][];
  triangles: Point3[][];
  materialIndex: number;
  curved: boolean;
}

const POINT_TOLERANCE = 1e-4; // metres: vertices closer than 0.1 mm are the same vertex
const PLANE_COS = 1 - 1e-6;   // normals this close are the same plane
const PLANE_DIST = 1e-5;      // metres off the plane still counts as on it
const SMOOTH_COS = Math.cos(THREE.MathUtils.degToRad(1)); // shading normal further off than this = curved

/**
 * The flat faces of a triangle mesh, in SketchUp coordinates. Triangles that touch along an
 * edge and share a plane and a material merge into one face; anything that won't merge
 * cleanly stays as its triangles.
 */
export function facesFromMesh(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): SkpFace[] {
  const pos = geometry.getAttribute('position');
  if (!pos) return [];
  const nrm = geometry.getAttribute('normal');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const flip = matrix.determinant() < 0; // a mirrored placement turns every triangle over

  // Welded vertices in world space.
  const points: THREE.Vector3[] = [];
  const idOfKey = new Map<string, number>();
  const idOfIndex = new Int32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const key = `${Math.round(v.x / POINT_TOLERANCE)},${Math.round(v.y / POINT_TOLERANCE)},${Math.round(v.z / POINT_TOLERANCE)}`;
    let id = idOfKey.get(key);
    if (id === undefined) { id = points.length; points.push(v.clone()); idOfKey.set(key, id); }
    idOfIndex[i] = id;
  }

  // Triangles, with their material and whether they were shaded smooth.
  const index = geometry.getIndex();
  const cornerCount = index ? index.count : pos.count;
  const corner = (c: number) => (index ? index.getX(c) : c);
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: cornerCount, materialIndex: 0 }];

  interface Tri { v: [number, number, number]; normal: THREE.Vector3; mat: number; smooth: boolean }
  const tris: Tri[] = [];
  const seen = new Set<string>();
  const sn = new THREE.Vector3();
  for (const g of groups) {
    const end = Math.min(cornerCount, g.start + g.count);
    for (let c = g.start; c + 2 < end; c += 3) {
      const src = [corner(c), corner(c + 1), corner(c + 2)];
      let ids = src.map(i => idOfIndex[i]) as [number, number, number];
      if (flip) ids = [ids[0], ids[2], ids[1]];
      if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
      // A double-sided mesh stores each triangle twice, once per side: keep one.
      const key = [...ids].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      const n = new THREE.Vector3().subVectors(points[ids[1]], points[ids[0]])
        .cross(new THREE.Vector3().subVectors(points[ids[2]], points[ids[0]]));
      if (n.lengthSq() < 1e-16) continue;
      n.normalize();
      seen.add(key);
      let smooth = false;
      if (nrm) {
        for (const i of src) {
          sn.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
          if (Math.abs(sn.dot(n)) < SMOOTH_COS) { smooth = true; break; }
        }
      }
      tris.push({ v: ids, normal: n, mat: g.materialIndex ?? 0, smooth });
    }
  }

  // Which triangles use each undirected edge.
  const edgeKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const trisOfEdge = new Map<string, number[]>();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(t.v[k], t.v[(k + 1) % 3]);
      const list = trisOfEdge.get(key);
      if (list) list.push(ti); else trisOfEdge.set(key, [ti]);
    }
  });

  const toSkp = (id: number): Point3 => toSkpPoint(points[id].x, points[id].y, points[id].z);
  const triangleFace = (t: Tri): SkpFace => {
    const tri = t.v.map(toSkp);
    return { outer: tri, holes: [], triangles: [tri], materialIndex: t.mat, curved: t.smooth };
  };

  // Grow coplanar regions across shared edges.
  const region = new Int32Array(tris.length).fill(-1);
  const faces: SkpFace[] = [];
  for (let seed = 0; seed < tris.length; seed++) {
    if (region[seed] !== -1) continue;
    const s = tris[seed];
    const d = s.normal.dot(points[s.v[0]]);
    const members: number[] = [seed];
    region[seed] = seed;
    for (let q = 0; q < members.length; q++) {
      const t = tris[members[q]];
      for (let k = 0; k < 3; k++) {
        for (const ni of trisOfEdge.get(edgeKey(t.v[k], t.v[(k + 1) % 3]))!) {
          if (region[ni] !== -1) continue;
          const nt = tris[ni];
          if (nt.mat !== s.mat || nt.normal.dot(s.normal) < PLANE_COS) continue;
          if (nt.v.some(id => Math.abs(s.normal.dot(points[id]) - d) > PLANE_DIST)) continue;
          region[ni] = seed;
          members.push(ni);
        }
      }
    }

    const curved = members.some(i => tris[i].smooth);
    if (members.length === 1) { faces.push(triangleFace(s)); continue; }
    const loops = boundaryLoops(members.map(i => tris[i].v), s.normal, points);
    if (!loops) { members.forEach(i => faces.push(triangleFace(tris[i]))); continue; }
    faces.push({
      outer: loops.outer.map(toSkp),
      holes: loops.holes.map(h => h.map(toSkp)),
      triangles: members.map(i => tris[i].v.map(toSkp)),
      materialIndex: s.mat,
      curved,
    });
  }
  return faces;
}

/**
 * The outline (and holes) of a connected set of coplanar triangles, found by cancelling every
 * edge two triangles share. Null when the outline isn't a simple set of loops (a vertex where
 * the region pinches, a T-junction), in which case the caller keeps the triangles.
 */
function boundaryLoops(
  tris: [number, number, number][],
  normal: THREE.Vector3,
  points: THREE.Vector3[],
): { outer: number[]; holes: number[][] } | null {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const kk = key(t[k], t[(k + 1) % 3]);
    count.set(kk, (count.get(kk) ?? 0) + 1);
  }
  const next = new Map<number, number>();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    const c = count.get(key(a, b))!;
    if (c > 2) return null;
    if (c === 1) {
      if (next.has(a)) return null; // pinch vertex
      next.set(a, b);
    }
  }

  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let cur = start;
    while (!used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      const n = next.get(cur);
      if (n === undefined) return null;
      cur = n;
    }
    if (cur !== start) return null;
    const simplified = dropCollinear(loop, points);
    if (simplified.length < 3) return null;
    loops.push(simplified);
  }

  // Outer loops wind counter-clockwise about the face normal (positive area), holes clockwise.
  const areas = loops.map(l => signedAreaAbout(l, normal, points));
  const outers = areas.filter(a => a > 0).length;
  if (outers !== 1) return null;
  const outerIdx = areas.findIndex(a => a > 0);
  return { outer: loops[outerIdx], holes: loops.filter((_, i) => i !== outerIdx) };
}

function dropCollinear(loop: number[], points: THREE.Vector3[]): number[] {
  const out: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < loop.length; i++) {
    const p = points[loop[(i + loop.length - 1) % loop.length]];
    const c = points[loop[i]];
    const n = points[loop[(i + 1) % loop.length]];
    a.subVectors(c, p); b.subVectors(n, c);
    if (a.clone().cross(b).length() > 1e-6 * a.length() * b.length()) out.push(loop[i]);
  }
  return out;
}

function signedAreaAbout(loop: number[], normal: THREE.Vector3, points: THREE.Vector3[]): number {
  const sum = new THREE.Vector3();
  for (let i = 0; i < loop.length; i++) {
    sum.add(points[loop[i]].clone().cross(points[loop[(i + 1) % loop.length]]));
  }
  return sum.dot(normal) / 2;
}

/** PolyForm's drawn faces, straight from the geometry engine: exact outlines and holes. */
export function facesFromKernel(graph: Graph, faceIds: Iterable<FaceId>, matrix: THREE.Matrix4): SkpFace[] {
  const out: SkpFace[] = [];
  const v = new THREE.Vector3();
  const convert = (p: { x: number; y: number; z: number }) => {
    v.set(p.x, p.y, p.z).applyMatrix4(matrix);
    return toSkpPoint(v.x, v.y, v.z);
  };
  for (const id of new Set(faceIds)) {
    const face = graph.faces.get(id);
    if (!face || face.attributes.hidden) continue;
    const outer = loopPoints(graph, face.outerLoop).map(convert);
    if (outer.length < 3) continue;
    out.push({
      outer,
      holes: face.innerLoops.map(l => loopPoints(graph, l).map(convert)).filter(h => h.length >= 3),
      triangles: [],
      materialIndex: 0,
      curved: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type FaceTarget = Pick<SkpBuilder, 'addFace'> | Pick<ComponentDefinitionBuilder, 'addFace'>;

function materialAt(material: THREE.Material | THREE.Material[], index: number): THREE.Material | undefined {
  return Array.isArray(material) ? material[index] ?? material[0] : material;
}

function writeFaces(
  target: FaceTarget,
  faces: SkpFace[],
  material: THREE.Material | THREE.Material[],
  materials: MaterialTable,
  tally: { faces: number; skipped: number },
): void {
  for (const f of faces) {
    const handle = materials.handle(materialAt(material, f.materialIndex));
    const options = {
      material: handle,
      backMaterial: handle,
      softEdges: f.curved,
      smoothEdges: f.curved,
      ...(f.holes.length ? { holes: f.holes } : {}),
    };
    try {
      target.addFace(f.outer, options);
      tally.faces++;
      continue;
    } catch {
      // Fall through to the triangles this face was made from.
    }
    if (!f.triangles.length) { tally.skipped++; continue; }
    for (const tri of f.triangles) {
      try {
        target.addFace(tri, { material: handle, backMaterial: handle, softEdges: true, smoothEdges: f.curved });
        tally.faces++;
      } catch {
        tally.skipped++;
      }
    }
  }
}

const IDENTITY = new THREE.Matrix4();

/**
 * The model as `.skp` bytes. `graph` is the geometry engine's graph, for exact drawn faces;
 * without it drawn geometry is written from its triangles like everything else.
 */
export function buildSkp(items: readonly ExportItem[], graph?: Graph): SkpExportResult {
  const builder = create();
  const materials = new MaterialTable(builder);
  const tally = { faces: 0, skipped: 0 };

  // SketchUp's file wants every material first, then every definition, then what's placed at
  // the top level - so work out all the faces up front.
  const components: { item: ExportItem; faces: SkpFace[] }[] = [];
  const groups = new Map<string, { name: string; parts: { item: ExportItem; faces: SkpFace[] }[] }>();
  const loose: { item: ExportItem; faces: SkpFace[] }[] = [];

  items.forEach((item, i) => {
    if (item.instanced) {
      components.push({ item, faces: facesFromMesh(item.geometry, IDENTITY) });
      return;
    }
    const matrix = item.matrices[0];
    if (item.kernelFaceOfTriangle && graph) {
      loose.push({ item, faces: facesFromKernel(graph, item.kernelFaceOfTriangle, matrix) });
      return;
    }
    const faces = facesFromMesh(item.geometry, matrix);
    const key = item.ownerId ?? `#${i}`;
    const group = groups.get(key) ?? { name: item.name, parts: [] };
    group.parts.push({ item, faces });
    groups.set(key, group);
  });

  // Materials first.
  const register = (item: ExportItem, faces: SkpFace[]) => faces.forEach(f => materials.handle(materialAt(item.material, f.materialIndex)));
  components.forEach(c => register(c.item, c.faces));
  groups.forEach(g => g.parts.forEach(p => register(p.item, p.faces)));
  loose.forEach(l => register(l.item, l.faces));

  // Then definitions: components for batches, a group per object.
  const placed: { def: ComponentDefinitionBuilder; item: ExportItem }[] = [];
  const names = new Set<string>();
  const uniqueName = (base: string) => {
    let name = base || 'Component';
    for (let i = 2; names.has(name); i++) name = `${base} (${i})`;
    names.add(name);
    return name;
  };
  for (const c of components) {
    if (!c.faces.length) continue;
    const def = builder.addComponentDefinition(uniqueName(c.item.name), d => writeFaces(d, c.faces, c.item.material, materials, tally));
    placed.push({ def, item: c.item });
  }
  groups.forEach(g => {
    if (!g.parts.some(p => p.faces.length)) return;
    builder.addGroup(d => g.parts.forEach(p => writeFaces(d, p.faces, p.item.material, materials, tally)), { name: g.name });
  });

  // Then the top level: a copy of each batch member, and the drawn geometry.
  const pos = new THREE.Vector3();
  for (const { def, item } of placed) {
    for (const m of item.matrices) {
      pos.setFromMatrixPosition(m);
      builder.addInstance(def, { translation: toSkpPoint(pos.x, pos.y, pos.z), matrix3x3: toSkpMatrix3(m) });
    }
  }
  loose.forEach(l => writeFaces(builder, l.faces, l.item.material, materials, tally));

  return { bytes: builder.toBytes(), ...tally };
}
