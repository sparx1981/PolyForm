/**
 * PolyForm geometry kernel — topological insertion. §6.2 Phases 1a and 1b.
 *
 * Phase 1a resolves point intersections (R1, R2). Phase 1b resolves colinear
 * overlap (R2b). They are separate passes for a reason that is easy to lose:
 * a segment-intersection solver given two COLINEAR segments divides by a
 * vanishing denominator and returns an arbitrary point on the shared span, so
 * colinear pairs must be filtered out of 1a before it runs, not cleaned up
 * afterwards.
 *
 * The single most important behaviour in this file is that a retrace — an
 * edge drawn exactly over an existing one — creates nothing and still marks
 * the graph as changed. Skipping derivation when no edge was created is the
 * obvious optimisation and it silently breaks retrace-to-heal.
 */

import type { EdgeId, Graph, Tolerances, Vec3, VertexId } from './types';
import {
  addEdge, addVertex, adjacentEdges, edgePoints, findEdgeBetween, getEdge,
  getVertex, removeEdge,
} from './topology';
import {
  add, areSegmentsColinear, distance, dot, scale, segmentIntersection3D, sub,
  tryNormalize,
} from './math';
import { SpatialIndex, boundsFromPoints, expandBounds } from './spatialIndex';

export interface InsertContext {
  readonly graph: Graph;
  readonly tolerances: Tolerances;
  /** Index over edges, kept in step by this module. */
  readonly index: SpatialIndex<EdgeId>;
}

export interface InsertResult {
  /** Edges that now exist for the requested span. May be existing ones. */
  readonly edges: EdgeId[];
  /**
   * Every edge created, split, subdivided or overdrawn this transaction.
   *
   * Set even when nothing was created. A retrace discards every duplicate and
   * still must derive, or a deleted face never comes back. §6.2 Phase 1b
   */
  readonly touched: Set<EdgeId>;
  readonly createdVertices: VertexId[];
  /** True when the span was already fully occupied — a pure retrace. */
  readonly wasOverdraw: boolean;
}

export function createEdgeIndex(g: Graph, cellSize = 1): SpatialIndex<EdgeId> {
  const idx = new SpatialIndex<EdgeId>(cellSize);
  for (const e of g.edges.values()) idx.insert(e.id, boundsFromPoints(edgePoints(g, e)));
  return idx;
}

const reindex = (ctx: InsertContext, id: EdgeId): void => {
  const e = ctx.graph.edges.get(id);
  if (!e) {
    ctx.index.remove(id);
    return;
  }
  ctx.index.insert(id, boundsFromPoints(edgePoints(ctx.graph, e)));
};

// ---------------------------------------------------------------------------
// Vertex resolution (R1)
// ---------------------------------------------------------------------------

/**
 * Finds an existing vertex within tolerance, or creates one. When the point
 * lands on the interior of an existing edge, that edge is split.
 */
export function resolveVertex(
  ctx: InsertContext,
  point: Vec3,
  touched: Set<EdgeId>,
  created: VertexId[],
): VertexId {
  const { graph: g, tolerances: tol } = ctx;

  // Existing vertex within merge tolerance wins — no near-duplicates. R1
  let best: VertexId | null = null;
  let bestDist = tol.VERTEX_MERGE_TOLERANCE;
  for (const [id, v] of g.vertices) {
    const d = distance(v.position, point);
    if (d <= bestDist) {
      // Ties broken by lowest id so the result is deterministic. §10.3
      if (best === null || d < bestDist || id < best) {
        best = id;
        bestDist = d;
      }
    }
  }
  if (best !== null) return best;

  // On the interior of an existing edge? Split it there.
  const near = ctx.index.queryBounds(
    expandBounds({ min: point, max: point }, tol.VERTEX_MERGE_TOLERANCE),
  );
  for (const eid of near) {
    const e = g.edges.get(eid);
    if (!e) continue;
    const [p0, p1] = edgePoints(g, e);
    const dir = sub(p1, p0);
    const lenSq = dot(dir, dir);
    if (lenSq === 0) continue;
    const t = dot(sub(point, p0), dir) / lenSq;
    if (t <= 0 || t >= 1) continue;
    const projected = add(p0, scale(dir, t));
    if (distance(projected, point) > tol.VERTEX_MERGE_TOLERANCE) continue;

    const v = addVertex(g, point, 'split');
    created.push(v.id);
    splitEdgeAtVertex(ctx, eid, v.id, touched);
    return v.id;
  }

  const v = addVertex(g, point, 'user');
  created.push(v.id);
  return v.id;
}

/** Replaces an edge with two, preserving curve membership and flags. R2 */
export function splitEdgeAtVertex(
  ctx: InsertContext,
  eid: EdgeId,
  at: VertexId,
  touched: Set<EdgeId>,
): [EdgeId, EdgeId] | null {
  const g = ctx.graph;
  const e = g.edges.get(eid);
  if (!e) return null;
  if (e.v0 === at || e.v1 === at) return null;

  const { v0, v1, smooth, hidden, curve } = e;
  const hadFaces = e.uses.length > 0;

  removeEdge(g, eid);
  ctx.index.remove(eid);

  const a = addEdge(g, v0, at);
  const b = addEdge(g, at, v1);
  for (const part of [a, b]) {
    part.smooth = smooth;
    part.hidden = hidden;
    part.curve = curve;
  }
  if (curve !== null) {
    const c = g.curves.get(curve);
    if (c) {
      // Splice in place, preserving traversal order and orientation.
      // Appending would leave curve.edges unordered, and every arc operation
      // downstream — splitting, Ns re-solve, tangency — walks that order.
      const at = c.edges.indexOf(eid);
      const halves = a.v0 === v0 || a.v1 === v0 ? [a.id, b.id] : [b.id, a.id];
      if (at >= 0) c.edges.splice(at, 1, ...halves);
      else c.edges.push(...halves);
    }
  }

  reindex(ctx, a.id);
  reindex(ctx, b.id);
  touched.add(a.id);
  touched.add(b.id);

  // Faces that used the original edge are now invalid; derivation rebuilds
  // them from the sub-edges. Phase 6 owns that — this only records the change.
  if (hadFaces) touched.add(a.id);

  return [a.id, b.id];
}

// ---------------------------------------------------------------------------
// Phase 1b — colinear overlap (R2b)
// ---------------------------------------------------------------------------

interface OverlapPartner {
  readonly edge: EdgeId;
  readonly t0: number;
  readonly t1: number;
}

/**
 * Resolves the span between two vertices against every colinear edge that
 * overlaps it, subdividing at each interior endpoint and keeping the EXISTING
 * edge wherever both occupy the same span.
 *
 * Keeping the existing edge is not arbitrary. It already carries curve
 * membership, smooth and hidden flags, and EdgeUses that live faces reference.
 * Swapping in a fresh duplicate silently orphans all of it.
 */
function resolveOverlap(
  ctx: InsertContext,
  from: VertexId,
  to: VertexId,
  touched: Set<EdgeId>,
  createdVertices: VertexId[],
): { edges: EdgeId[]; wasOverdraw: boolean } | null {
  const { graph: g, tolerances: tol } = ctx;
  const a0 = getVertex(g, from).position;
  const a1 = getVertex(g, to).position;
  const dir = tryNormalize(sub(a1, a0));
  if (!dir) return null;

  const query = expandBounds(boundsFromPoints([a0, a1]), tol.VERTEX_MERGE_TOLERANCE);
  const partners: OverlapPartner[] = [];

  for (const eid of ctx.index.queryBounds(query)) {
    const e = g.edges.get(eid);
    if (!e) continue;
    const [b0, b1] = edgePoints(g, e);
    if (!areSegmentsColinear(a0, a1, b0, b1, tol.COLINEARITY_TOLERANCE, tol.VERTEX_MERGE_TOLERANCE)) {
      continue;
    }
    // Project onto the new span's 1D parameter.
    const t0 = dot(sub(b0, a0), dir);
    const t1 = dot(sub(b1, a0), dir);
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const span = distance(a0, a1);
    // Overlap must be a real interval, not a touch at a shared endpoint.
    if (hi <= tol.VERTEX_MERGE_TOLERANCE || lo >= span - tol.VERTEX_MERGE_TOLERANCE) continue;
    partners.push({ edge: eid, t0: lo, t1: hi });
  }

  if (partners.length === 0) return null;

  // Every interior cut point, from both the new span and its partners.
  const span = distance(a0, a1);
  const cuts = new Set<number>([0, span]);
  for (const p of partners) {
    if (p.t0 > tol.VERTEX_MERGE_TOLERANCE && p.t0 < span - tol.VERTEX_MERGE_TOLERANCE) cuts.add(p.t0);
    if (p.t1 > tol.VERTEX_MERGE_TOLERANCE && p.t1 < span - tol.VERTEX_MERGE_TOLERANCE) cuts.add(p.t1);
  }
  const ordered = [...cuts].sort((m, n) => m - n);

  // Subdivide the partners at our endpoints too, so shared spans line up.
  for (const p of partners) {
    for (const t of [0, span]) {
      if (t <= p.t0 + tol.VERTEX_MERGE_TOLERANCE || t >= p.t1 - tol.VERTEX_MERGE_TOLERANCE) continue;
      const point = add(a0, scale(dir, t));
      const v = resolveVertex(ctx, point, touched, createdVertices);
      const still = g.edges.get(p.edge);
      if (still) splitEdgeAtVertex(ctx, p.edge, v, touched);
    }
  }

  const out: EdgeId[] = [];
  let allExisting = true;

  for (let i = 0; i + 1 < ordered.length; i++) {
    const tA = ordered[i]!;
    const tB = ordered[i + 1]!;
    if (tB - tA <= tol.MIN_EDGE_LENGTH) continue;

    const pA = add(a0, scale(dir, tA));
    const pB = add(a0, scale(dir, tB));
    const vA = resolveVertex(ctx, pA, touched, createdVertices);
    const vB = resolveVertex(ctx, pB, touched, createdVertices);
    if (vA === vB) continue;

    const existing = findEdgeBetween(g, vA, vB);
    if (existing) {
      // Occupied by both: keep the existing edge, discard the new one.
      out.push(existing.id);
      touched.add(existing.id);
    } else {
      const fresh = addEdge(g, vA, vB);
      reindex(ctx, fresh.id);
      out.push(fresh.id);
      touched.add(fresh.id);
      allExisting = false;
    }
  }

  return { edges: out, wasOverdraw: allExisting };
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Inserts an edge between two points, applying R1, R2 and R2b.
 *
 * Returns every edge now covering the requested span, plus the touched set
 * derivation will consume. Faces are not created here — that is Phase 6.
 */
export function insertEdge(ctx: InsertContext, p0: Vec3, p1: Vec3): InsertResult {
  const { graph: g, tolerances: tol } = ctx;
  const touched = new Set<EdgeId>();
  const createdVertices: VertexId[] = [];

  if (distance(p0, p1) < tol.MIN_EDGE_LENGTH) {
    return { edges: [], touched, createdVertices, wasOverdraw: false };
  }

  const from = resolveVertex(ctx, p0, touched, createdVertices);
  const to = resolveVertex(ctx, p1, touched, createdVertices);
  if (from === to) return { edges: [], touched, createdVertices, wasOverdraw: false };

  // ---- Phase 1a: point intersections, colinear pairs excluded ----
  const a0 = getVertex(g, from).position;
  const a1 = getVertex(g, to).position;
  const query = expandBounds(boundsFromPoints([a0, a1]), tol.VERTEX_MERGE_TOLERANCE);
  const cutPoints: Vec3[] = [];

  for (const eid of ctx.index.queryBounds(query)) {
    const e = g.edges.get(eid);
    if (!e) continue;
    const [b0, b1] = edgePoints(g, e);
    // Colinear pairs are Phase 1b's job; intersect() would return garbage.
    if (areSegmentsColinear(a0, a1, b0, b1, tol.COLINEARITY_TOLERANCE, tol.VERTEX_MERGE_TOLERANCE)) {
      continue;
    }
    const hit = segmentIntersection3D(a0, a1, b0, b1, tol.VERTEX_MERGE_TOLERANCE);
    if (!hit) continue;
    cutPoints.push(hit.point);
    if (!hit.atEndpointB) {
      const v = resolveVertex(ctx, hit.point, touched, createdVertices);
      if (g.edges.has(eid)) splitEdgeAtVertex(ctx, eid, v, touched);
    }
  }

  // ---- Phase 1b: colinear overlap ----
  const overlap = resolveOverlap(ctx, from, to, touched, createdVertices);
  if (overlap) {
    return {
      edges: overlap.edges,
      touched,
      createdVertices,
      wasOverdraw: overlap.wasOverdraw,
    };
  }

  // ---- Build the new edge, subdivided at every crossing ----
  const dir = tryNormalize(sub(a1, a0));
  if (!dir) return { edges: [], touched, createdVertices, wasOverdraw: false };
  const span = distance(a0, a1);

  const params = new Set<number>([0, span]);
  for (const p of cutPoints) {
    const t = dot(sub(p, a0), dir);
    if (t > tol.VERTEX_MERGE_TOLERANCE && t < span - tol.VERTEX_MERGE_TOLERANCE) params.add(t);
  }
  const ordered = [...params].sort((m, n) => m - n);

  const edges: EdgeId[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const tA = ordered[i]!;
    const tB = ordered[i + 1]!;
    if (tB - tA <= tol.MIN_EDGE_LENGTH) continue;
    const vA = resolveVertex(ctx, add(a0, scale(dir, tA)), touched, createdVertices);
    const vB = resolveVertex(ctx, add(a0, scale(dir, tB)), touched, createdVertices);
    if (vA === vB) continue;

    const existing = findEdgeBetween(g, vA, vB);
    if (existing) {
      edges.push(existing.id);
      touched.add(existing.id);
      continue;
    }
    const fresh = addEdge(g, vA, vB);
    reindex(ctx, fresh.id);
    edges.push(fresh.id);
    touched.add(fresh.id);
  }

  return { edges, touched, createdVertices, wasOverdraw: false };
}

/**
 * Inserts a CLOSED RING of edges (a rectangle, circle, triangle, or any
 * other shape drawn as a single, complete boundary) as new, topologically
 * ISOLATED geometry — deliberately not the same crossing-and-splitting
 * behaviour `insertEdge` gives every other edge in this kernel.
 *
 * The two are meant to differ, not by oversight: `insertEdge` treats
 * crossing an existing edge as the user asking to connect into it — the
 * Line/Arc tool's whole reason for existing is to divide a surface or
 * extend into one. A rectangle, circle, or triangle drawn as a single
 * gesture is a different kind of action: the user drew a whole new
 * shape, not a cut into an existing one. Splitting it into whatever
 * unrelated geometry it happens to cross — silently producing extra
 * faces the user never asked for, exactly the "shapes are no longer the
 * drawn rectangles" regression this function exists to fix — was never
 * the intended behaviour for these tools, even though they used
 * `insertEdge` for a long time.
 *
 * What's KEPT, deliberately: each corner of the ring still resolves
 * through `resolveVertex`, so snapping the ring's own corner onto an
 * existing vertex (or splitting an edge it lands exactly on top of) still
 * works — that's the user explicitly connecting this new shape to
 * something, the same as any other deliberate snap, not an incidental
 * crossing partway along an edge.
 *
 * What's SKIPPED, deliberately: Phase 1a's mid-span crossing detection
 * against unrelated edges (segmentIntersection3D — see insertEdge's own
 * comment), and Phase 1b's colinear-overlap handling. Both exist so that
 * drawing a new edge over or through EXISTING geometry ties into it —
 * exactly the behaviour a brand-new, independent shape should not have.
 */
/**
 * Resolves a point to a vertex for insertIsolatedEdge — snapping ONLY onto
 * an already-existing vertex within tolerance, never onto the interior of
 * an existing edge.
 *
 * This is deliberately narrower than resolveVertex (R1), not a copy of it.
 * resolveVertex ALSO splits an edge it lands on the interior of — which is
 * itself a form of the sticky, crossing-related behaviour insertIsolatedEdge
 * exists to avoid. Two shapes of similar size and overlapping placement
 * (e.g. two circles of the same radius) routinely put some of one shape's
 * own corner points close enough to the OTHER shape's boundary to trigger
 * that split — reconnecting the two despite no genuine, deliberate
 * shared-vertex snap ever happening. Confirmed directly: two overlapping
 * circles, pushed/pulled with insertIsolatedEdge everywhere else, still
 * produced a spurious lens-shaped face at their overlap, because one
 * circle's own vertex landed on the other's edge interior and split it.
 *
 * A vertex-only snap still lets the user deliberately connect two shapes
 * (share a corner, or an entire edge, on purpose) — that's still a real,
 * pre-existing point to land on. It's specifically the "you happened to
 * cross partway along my edge" case that no longer counts as a connection.
 */
function resolveVertexOnly(
  ctx: InsertContext,
  point: Vec3,
  created: VertexId[],
): VertexId {
  const { graph: g, tolerances: tol } = ctx;

  let best: VertexId | null = null;
  let bestDist = tol.VERTEX_MERGE_TOLERANCE;
  for (const [id, v] of g.vertices) {
    const d = distance(v.position, point);
    if (d <= bestDist) {
      if (best === null || d < bestDist || id < best) {
        best = id;
        bestDist = d;
      }
    }
  }
  if (best !== null) return best;

  const v = addVertex(g, point, 'user');
  created.push(v.id);
  return v.id;
}

export function insertIsolatedEdge(ctx: InsertContext, p0: Vec3, p1: Vec3): InsertResult {
  const { graph: g, tolerances: tol } = ctx;
  const touched = new Set<EdgeId>();
  const createdVertices: VertexId[] = [];

  if (distance(p0, p1) < tol.MIN_EDGE_LENGTH) {
    return { edges: [], touched, createdVertices, wasOverdraw: false };
  }

  const from = resolveVertexOnly(ctx, p0, createdVertices);
  const to = resolveVertexOnly(ctx, p1, createdVertices);
  if (from === to) return { edges: [], touched, createdVertices, wasOverdraw: false };

  const existing = findEdgeBetween(g, from, to);
  if (existing) {
    touched.add(existing.id);
    return { edges: [existing.id], touched, createdVertices, wasOverdraw: true };
  }

  const fresh = addEdge(g, from, to);
  reindex(ctx, fresh.id);
  touched.add(fresh.id);
  return { edges: [fresh.id], touched, createdVertices, wasOverdraw: false };
}

/** Adjacency function for the plane index, sourced from the topology store. */
export const adjacencyFor = (g: Graph) => (edge: EdgeId): readonly EdgeId[] =>
  adjacentEdges(g, edge);

export { getEdge };
