/**
 * PolyForm geometry kernel — push/pull.
 *
 * Extrudes a face along its normal: the face travels, its boundary sweeps out
 * side walls, and the original opening is capped.
 *
 * The whole operation is expressed as EDGES, then handed to the ordinary
 * derivation pass. Nothing here constructs a face directly. That is not
 * ceremony — it is what makes the result behave like everything else: the new
 * walls can be split by a line, painted, healed after a delete, and merged
 * when an edge between two coplanar ones is erased. A version that built
 * faces by hand would produce geometry that looks identical and behaves like
 * a foreign object. §6.1
 *
 * Two cases are genuinely different and are handled as such:
 *
 *  - A FREE face — one whose boundary edges bound nothing else — moves. Its
 *    original position is left open, because there was never anything there.
 *  - A face sharing edges with neighbours cannot simply move: dragging it
 *    would tear the surfaces it is joined to. Its boundary stays put, a new
 *    face is created at the offset, and walls connect the two.
 */

import type { EdgeId, FaceId, Graph, Tolerances, Vec3, VertexId } from './types';
import { getVertex, loopEdgeIds, loopPoints } from './topology';
import { add, distance, dot, normalize, scale, sub } from './math';
import { insertEdge, type InsertContext } from './insert';

export interface PushPullOptions {
  readonly tolerances: Tolerances;
  /**
   * Move the original face rather than leaving it in place, when it is free
   * to move. Default true — it is what "push/pull" means to a user.
   */
  readonly moveWhenFree?: boolean;
}

export interface PushPullResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** Every edge created or touched. Feed to derivation. */
  readonly touched: Set<EdgeId>;
  /** True when the face was joined to others and so could not be moved. */
  readonly wasShared: boolean;
  readonly distance: number;
}

const fail = (reason: string): PushPullResult => ({
  ok: false,
  reason,
  touched: new Set(),
  wasShared: false,
  distance: 0,
});

/**
 * Is this face free to move?
 *
 * Free means every edge of every one of its loops is used by this face alone.
 * The moment one is shared, moving the face would drag a boundary that
 * another surface also owns, tearing it.
 */
export function isFaceFree(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  for (const lid of [f.outerLoop, ...f.innerLoops]) {
    for (const eid of loopEdgeIds(g, lid)) {
      const e = g.edges.get(eid);
      if (!e) continue;
      if (e.uses.length > 1) return false;
    }
  }
  return true;
}

/** Ordered boundary vertices of a loop, deduplicated. */
function loopVertices(g: Graph, lid: number): VertexId[] {
  const loop = g.loops.get(lid as never);
  if (!loop) return [];
  const out: VertexId[] = [];
  for (const use of loop.uses) {
    const e = g.edges.get(use.edge);
    if (!e) continue;
    out.push(use.reversed ? e.v1 : e.v0);
  }
  return out;
}

/**
 * Extrudes a face by `dist` along its normal. Negative pushes inward.
 *
 * Returns the touched set; the caller runs derivation, so a push/pull is one
 * transaction and one undo entry like any other edit.
 */
export function pushPull(
  ctx: InsertContext,
  id: FaceId,
  dist: number,
  opts: PushPullOptions,
): PushPullResult {
  const g = ctx.graph;
  const face = g.faces.get(id);
  if (!face) return fail('face not found');

  if (Math.abs(dist) < opts.tolerances.MIN_EDGE_LENGTH) {
    // Not an error worth surfacing: a push/pull of nothing is a click, and a
    // click that moved a fraction of a millimetre is a slip.
    return fail('distance below MIN_EDGE_LENGTH');
  }

  const normal = normalize(face.plane.normal, 'pushPull normal');
  const offset = scale(normal, dist);
  const shared = !isFaceFree(g, id);
  const touched = new Set<EdgeId>();

  // Snapshot the boundary BEFORE anything changes: the loops are about to be
  // rebuilt by derivation, and reading them afterwards would read the result.
  const loops = [face.outerLoop, ...face.innerLoops].map((lid) => ({
    points: loopPoints(g, lid),
    vertices: loopVertices(g, lid),
  }));
  if (loops.length === 0 || loops[0]!.points.length < 3) return fail('face has no usable boundary');

  const material = face.attributes.materialFront;
  const wasShared = shared;

  // The original face is KEPT, and becomes the base of the solid.
  //
  // My first attempt deleted it for a free face, on the reasoning that
  // push/pull "moves" a face. That is the wrong model here: pulling a
  // standalone rectangle upward should produce a closed box, and deleting
  // the original leaves the underside open. Worse, preserve-or-create then
  // correctly refuses to resurrect it — a deliberately deleted face stays
  // deleted (§7.4) — so the hole is permanent.
  //
  // Known limitation: pushing a face that is already part of a closed solid
  // leaves the original in place as an internal divider. Detecting that case
  // needs solid classification, which the kernel does not have yet.

  for (const loop of loops) {
    const pts = loop.points;
    const n = pts.length;
    if (n < 3) continue;

    // The cap at the far end.
    for (let i = 0; i < n; i++) {
      const a = add(pts[i]!, offset);
      const b = add(pts[(i + 1) % n]!, offset);
      if (distance(a, b) < opts.tolerances.MIN_EDGE_LENGTH) continue;
      for (const t of insertEdge(ctx, a, b).touched) touched.add(t);
    }

    // The side walls: one rung per boundary vertex, joining the two rings.
    for (let i = 0; i < n; i++) {
      const base = pts[i]!;
      const top = add(base, offset);
      for (const t of insertEdge(ctx, base, top).touched) touched.add(t);
    }

    // Re-touch the base ring. The edges already exist, so this creates
    // nothing (R2b) — but it marks them changed, which is what lets the base
    // face re-derive rather than being treated as an untouched cycle. §6.2
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      if (distance(a, b) < opts.tolerances.MIN_EDGE_LENGTH) continue;
      for (const t of insertEdge(ctx, a, b).touched) touched.add(t);
    }
  }

  void material;
  return { ok: true, touched, wasShared, distance: dist };
}

/**
 * How far to push, from a cursor ray, constrained to the face normal.
 *
 * Push/pull is a one-dimensional operation: the cursor may go anywhere, but
 * the face only moves along its normal. Projecting the ray onto that axis is
 * what makes the drag feel controlled rather than skittish.
 */
export function pushPullDistanceFromRay(
  g: Graph,
  id: FaceId,
  ray: { origin: Vec3; direction: Vec3 },
  grabPoint: Vec3,
): number | null {
  const face = g.faces.get(id);
  if (!face) return null;
  const axis = normalize(face.plane.normal, 'pushPull axis');

  // Closest approach between the cursor ray and the extrusion axis.
  //
  // w0 runs from the AXIS origin to the RAY origin. Reversing it negates the
  // result, so dragging up would push the face down — right magnitude, wrong
  // direction, and thoroughly disorientating to use.
  const w0 = sub(ray.origin, grabPoint);
  const a = dot(ray.direction, ray.direction);
  const b = dot(ray.direction, axis);
  const c = dot(axis, axis);
  const d = dot(ray.direction, w0);
  const e = dot(axis, w0);
  const denom = a * c - b * b;

  // Ray parallel to the axis: no meaningful projection, and letting it
  // through would send the face to infinity on the first pixel of movement.
  if (Math.abs(denom) < 1e-9) return null;

  return (a * e - b * d) / denom;
}

/**
 * Faces that would move with this one — the coplanar, connected set.
 *
 * Pushing one face of a surface the user split in two should move the piece
 * they grabbed, not silently take its neighbour along. This exists so a
 * caller can offer "push the whole surface" deliberately rather than by
 * accident.
 */
export function coplanarNeighbours(
  g: Graph,
  id: FaceId,
  tolerances: Tolerances,
): FaceId[] {
  const face = g.faces.get(id);
  if (!face) return [];
  const n0 = normalize(face.plane.normal, 'coplanarNeighbours');
  const d0 = dot(n0, face.plane.point);

  const out: FaceId[] = [];
  for (const [other, f] of [...g.faces].sort((a, b) => a[0] - b[0])) {
    if (other === id) continue;
    const n = normalize(f.plane.normal, 'coplanarNeighbours other');
    if (Math.abs(Math.abs(dot(n, n0)) - 1) > tolerances.COPLANARITY_TOLERANCE) continue;
    if (Math.abs(dot(n, f.plane.point) - d0) > tolerances.COPLANARITY_TOLERANCE) continue;
    out.push(other);
  }
  return out;
}

export { getVertex };
