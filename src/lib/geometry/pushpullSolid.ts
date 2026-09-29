/**
 * PolyForm geometry kernel — push/pull on a face that is already part of a solid.
 *
 * The plain push/pull (pushpull.ts) builds a new cap and walls and leaves the face it started
 * from in place, which is right for a free-standing shape but wrong for a solid: pushing the top
 * of a box again would stack a second slab on the first, with the old top left inside as a
 * divider, and every push adds another seam. This is the solid-aware side of the tool:
 *
 *  - A CAP whose neighbours are all walls square to it (the top of a box, the end of a bar, a
 *    wall of a room) simply MOVES, and the walls stretch with it. Nothing new is made.
 *  - An EMBEDDED face (a rectangle drawn on a face of a solid) is CONSUMED: pushed out it grows
 *    a bump, pushed in it carves a recess, and the face itself is gone because it is no longer
 *    a boundary between solid and air.
 *
 * Anything else (a sheet, an open shape, a cap tied to sloping faces) is left to the ordinary
 * push/pull, and so is a push made with the copy modifier, which stacks on purpose (floors).
 */

import type { Edge, EdgeId, FaceId, Graph, Tolerances, Vec3, VertexId } from './types';
import { getVertex, loopEdgeIds } from './topology';
import { add, dot, normalize, scale, sub } from './math';
import { tessellateFace } from './tessellate';
import { derive, type DeriveOptions } from './derive';
import { verticesOf, edgesOf } from './grouptransform';
import { planeBasis } from './math';

/** Faces that share an edge with `faceId`, one per boundary edge (null where the edge is not shared by exactly two). */
function neighbourAcross(g: Graph, edge: Edge, faceId: FaceId): FaceId | null {
  if (edge.uses.length !== 2) return null;
  for (const use of edge.uses) {
    const loop = g.loops.get(use.loop);
    if (loop && loop.face !== faceId) return loop.face;
  }
  return null;
}

/** Is this face part of a closed, manifold surface? Every edge reached from it is used by exactly two faces. */
export function isOnClosedSolid(g: Graph, faceId: FaceId): boolean {
  if (!g.faces.has(faceId)) return false;
  const seen = new Set<FaceId>([faceId]);
  const queue: FaceId[] = [faceId];
  while (queue.length > 0) {
    const fid = queue.pop()!;
    const face = g.faces.get(fid);
    if (!face) return false;
    for (const lid of [face.outerLoop, ...face.innerLoops]) {
      for (const eid of loopEdgeIds(g, lid)) {
        const edge = g.edges.get(eid);
        if (!edge || edge.uses.length !== 2) return false;
        const other = neighbourAcross(g, edge, fid);
        if (other === null) return false;
        if (!seen.has(other)) { seen.add(other); queue.push(other); }
      }
    }
  }
  return true;
}

const isSquareTo = (a: Vec3, b: Vec3, tol: number) => Math.abs(dot(normalize(a), normalize(b))) < tol;
const isCoplanarWith = (g: Graph, a: FaceId, b: FaceId, tol: number) => {
  const fa = g.faces.get(a); const fb = g.faces.get(b);
  if (!fa || !fb) return false;
  const na = normalize(fa.plane.normal); const nb = normalize(fb.plane.normal);
  if (Math.abs(Math.abs(dot(na, nb)) - 1) > tol) return false;
  return Math.abs(dot(na, sub(fb.plane.point, fa.plane.point))) < tol;
};

export type CapKind = 'cap' | 'embedded' | 'other';

/** Which kind of face this is, for a solid-aware push. Only meaningful when the face is on a closed solid. */
export function classifyPushFace(g: Graph, faceId: FaceId, tolerances: Tolerances): CapKind {
  const face = g.faces.get(faceId);
  if (!face || !isOnClosedSolid(g, faceId)) return 'other';
  const n = face.plane.normal;
  let coplanar = false;
  let square = true;
  for (const lid of [face.outerLoop, ...face.innerLoops]) {
    for (const eid of loopEdgeIds(g, lid)) {
      const edge = g.edges.get(eid);
      const other = edge ? neighbourAcross(g, edge, faceId) : null;
      const nf = other === null ? undefined : g.faces.get(other);
      if (!nf || other === null) return 'other';
      if (isCoplanarWith(g, faceId, other, tolerances.COPLANARITY_TOLERANCE)) coplanar = true;
      else if (!isSquareTo(nf.plane.normal, n, 1e-3)) square = false;
    }
  }
  if (coplanar) return 'embedded';
  return square ? 'cap' : 'other';
}

/** Distance along `dir` from the face's middle to the next face of the solid, or null if there is none. */
export function distanceToNextFace(g: Graph, faceId: FaceId, dir: Vec3): number | null {
  const mesh = tessellateFace(g, faceId);
  if (!mesh || mesh.indices.length < 3) return null;
  const p = (i: number): Vec3 => ({ x: mesh.positions[i * 3]!, y: mesh.positions[i * 3 + 1]!, z: mesh.positions[i * 3 + 2]! });
  // A point inside the face: the middle of its first triangle.
  const a = p(mesh.indices[0]!); const b = p(mesh.indices[1]!); const c = p(mesh.indices[2]!);
  const origin: Vec3 = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
  const d = normalize(dir);
  let best: number | null = null;
  for (const [fid] of g.faces) {
    if (fid === faceId) continue;
    const m = tessellateFace(g, fid);
    if (!m) continue;
    for (let t = 0; t < m.indices.length; t += 3) {
      const q = (k: number): Vec3 => ({ x: m.positions[m.indices[t + k]! * 3]!, y: m.positions[m.indices[t + k]! * 3 + 1]!, z: m.positions[m.indices[t + k]! * 3 + 2]! });
      const v0 = q(0), v1 = q(1), v2 = q(2);
      const e1 = sub(v1, v0), e2 = sub(v2, v0);
      const h: Vec3 = { x: d.y * e2.z - d.z * e2.y, y: d.z * e2.x - d.x * e2.z, z: d.x * e2.y - d.y * e2.x };
      const det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det;
      const s = sub(origin, v0);
      const u = f * dot(s, h);
      if (u < 0 || u > 1) continue;
      const qv: Vec3 = { x: s.y * e1.z - s.z * e1.y, y: s.z * e1.x - s.x * e1.z, z: s.x * e1.y - s.y * e1.x };
      const v = f * dot(d, qv);
      if (v < 0 || u + v > 1) continue;
      const tt = f * dot(e2, qv);
      if (tt > 1e-6 && (best === null || tt < best)) best = tt;
    }
  }
  return best;
}

/** The reason moveCap gives when the push would take a wall to nothing (or past it). */
export const COLLAPSE = 'the push would flatten a wall';

export interface MoveCapResult { readonly ok: boolean; readonly reason?: string; readonly touched: Set<EdgeId> }

/**
 * Moves a cap along its normal by `dist`, stretching the walls beside it. Refuses (changing
 * nothing) when any face at the cap's corners is not square to it, or when a wall would collapse.
 */
export function moveCap(g: Graph, faceId: FaceId, dist: number, tolerances: Tolerances, deriveOpts: DeriveOptions): MoveCapResult {
  const fail = (reason: string): MoveCapResult => ({ ok: false, reason, touched: new Set() });
  const face = g.faces.get(faceId);
  if (!face) return fail('face not found');
  if (classifyPushFace(g, faceId, tolerances) !== 'cap') return fail('not a cap');
  const n = normalize(face.plane.normal);
  const offset = scale(n, dist);
  const ring = verticesOf(g, [faceId]);

  for (const vid of ring) {
    const v = getVertex(g, vid);
    for (const eid of v.edges) {
      const edge = g.edges.get(eid);
      if (!edge) continue;
      // Every face that touches a corner must be this one or a wall square to it.
      for (const use of edge.uses) {
        const owner = g.loops.get(use.loop)?.face;
        if (owner === undefined || owner === faceId) continue;
        const of = g.faces.get(owner);
        if (!of || !isSquareTo(of.plane.normal, n, 1e-3)) return fail('a sloping face meets the cap');
      }
      // A rung (an edge along the push) must not run out of length.
      const farId: VertexId = edge.v0 === vid ? edge.v1 : edge.v0;
      if (ring.has(farId)) continue;
      const along = sub(getVertex(g, farId).position, v.position);
      const s = dot(along, n);
      const across = Math.hypot(along.x - n.x * s, along.y - n.y * s, along.z - n.z * s);
      if (across > tolerances.MIN_EDGE_LENGTH) continue; // not along the push
      const after = s - dist;
      if (s * after <= 0 || Math.abs(after) < tolerances.MIN_EDGE_LENGTH * 2) return fail(COLLAPSE);
    }
  }

  for (const vid of ring) {
    const v = getVertex(g, vid);
    v.position = add(v.position, offset);
  }
  // A circle's top ring moves as one: its curve follows.
  const ringEdges = edgesOf(g, [faceId]);
  const movedCurves = new Set<number>();
  for (const eid of ringEdges) {
    const cid = g.edges.get(eid)?.curve;
    if (cid === null || cid === undefined || movedCurves.has(cid)) continue;
    const curve = g.curves.get(cid);
    if (curve && curve.edges.every((e) => ringEdges.has(e))) {
      curve.centre = add(curve.centre, offset);
      movedCurves.add(cid);
    }
  }
  face.plane = { point: add(face.plane.point, offset), normal: face.plane.normal };
  face.basis = planeBasis(face.plane);

  const touched = new Set<EdgeId>();
  for (const vid of ring) for (const eid of getVertex(g, vid).edges) touched.add(eid);
  derive(g, touched, deriveOpts);
  return { ok: true, touched };
}
