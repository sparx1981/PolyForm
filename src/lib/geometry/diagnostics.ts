/**
 * PolyForm geometry kernel — model diagnostics. §18, §3
 *
 * Reports conditions that are legal but usually unintended. Nothing here
 * mutates the model: a stray edge is often deliberate construction geometry,
 * and deleting it because a report noticed it would be worse than the report
 * not existing.
 *
 * The one behaviour that matters for usability: a cycle that JUST misses
 * coplanarity must produce a visible hint, not silence. "Why didn't a surface
 * appear?" is the single most common confusion in derived-face modelling. §3
 */

import type { Diagnostic, EdgeId, Graph, Tolerances, Vec3, VertexId } from './types';
import { classifyEdge, edgePoints, getVertex } from './topology';
import { bestFitPlane, coplanarity, distanceToPlane } from './math';

export interface DiagnosticReport {
  readonly diagnostics: Diagnostic[];
  readonly counts: {
    strayEdges: number;
    nonManifoldEdges: number;
    nonManifoldVertices: number;
    nearCoplanarCycles: number;
    isolatedVertices: number;
  };
}

/**
 * Finds closed cycles in the edge graph, up to `maxLength` edges.
 *
 * Bounded DFS rather than the planar traversal in cycles.ts: that one needs a
 * plane basis, and here we are specifically looking for loops that FAILED to
 * be planar. Deduplicated by edge set, so each loop is reported once.
 */
export function findClosedCycles(
  g: Graph,
  maxLength = 8,
  maxCycles = 500,
): { vertices: VertexId[]; edges: EdgeId[] }[] {
  const found: { vertices: VertexId[]; edges: EdgeId[] }[] = [];
  const seen = new Set<string>();

  const walk = (
    start: VertexId,
    current: VertexId,
    pathV: VertexId[],
    pathE: EdgeId[],
    visited: Set<VertexId>,
  ): void => {
    if (found.length >= maxCycles) return;
    if (pathE.length >= maxLength) return;

    const v = g.vertices.get(current);
    if (!v) return;

    for (const eid of [...v.edges].sort((a, b) => a - b)) {
      if (pathE.includes(eid)) continue;
      const e = g.edges.get(eid);
      if (!e) continue;
      const next = e.v0 === current ? e.v1 : e.v0;

      if (next === start && pathE.length >= 2) {
        const key = [...pathE, eid].sort((a, b) => a - b).join(',');
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ vertices: [...pathV], edges: [...pathE, eid] });
        }
        continue;
      }
      // Only walk forward to higher ids, so each cycle is discovered once
      // from its lowest vertex rather than once per starting point.
      if (visited.has(next) || next < start) continue;
      visited.add(next);
      walk(start, next, [...pathV, next], [...pathE, eid], visited);
      visited.delete(next);
    }
  };

  for (const [id] of [...g.vertices].sort((a, b) => a[0] - b[0])) {
    if (found.length >= maxCycles) break;
    walk(id, id, [id], [], new Set([id]));
  }
  return found;
}

/**
 * Near-coplanar detection.
 *
 * The condition is: a CLOSED LOOP exists and missed COPLANARITY_TOLERANCE by
 * a small margin. Testing a vertex neighbourhood instead is a different
 * question and gets both answers wrong — a near-planar square is never
 * flagged, and a corner where three axes meet is falsely flagged.
 *
 * When this fires the user has drawn something that looks closed and got no
 * surface, with no explanation. Silence is the worst possible response. §3
 */
export function findNearCoplanar(
  g: Graph,
  tol: Tolerances,
  hintFactor = 1000,
): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const cycle of findClosedCycles(g)) {
    if (cycle.vertices.length < 4) continue; // a triangle is always planar

    // Already bounds a face? Then nothing failed.
    const boundsFace = cycle.edges.some((eid) => (g.edges.get(eid)?.uses.length ?? 0) > 0);
    if (boundsFace) continue;

    const points = cycle.vertices.map((v) => getVertex(g, v).position);
    const r = coplanarity(points, tol.COPLANARITY_TOLERANCE);
    if (r.coplanar) continue;
    // Only NEAR misses. A deliberately folded loop is not a mistake.
    if (r.deviation > tol.COPLANARITY_TOLERANCE * hintFactor) continue;

    out.push({
      kind: 'near-coplanar',
      message:
        `These edges are ${r.deviation.toExponential(2)} from lying on one plane ` +
        `(tolerance ${tol.COPLANARITY_TOLERANCE.toExponential(1)}), so no surface was created.`,
      vertices: [...cycle.vertices].sort((a, b) => a - b),
      edges: [...cycle.edges].sort((a, b) => a - b),
    });
  }
  return out;
}

/**
 * Best-fit plane through a set of points, plus the worst deviation.
 * Exposed so the UI can offer auto-flatten on a specific loop. §3
 */
export function planarityOf(points: readonly Vec3[]): {
  plane: ReturnType<typeof bestFitPlane>;
  deviation: number;
} {
  const plane = bestFitPlane(points);
  if (!plane) return { plane: null, deviation: Infinity };
  let deviation = 0;
  for (const p of points) {
    const d = distanceToPlane(p, plane);
    if (d > deviation) deviation = d;
  }
  return { plane, deviation };
}

/**
 * Projects near-coplanar points onto their best-fit plane. §3
 *
 * Optional and off by default: it moves the user's geometry, so it belongs
 * behind a visible setting with a threshold the user can see, not as a silent
 * correction.
 */
export function autoFlatten(
  g: Graph,
  vertices: readonly VertexId[],
  maxDeviation: number,
): { flattened: boolean; deviation: number } {
  const points = vertices.map((v) => getVertex(g, v).position);
  const { plane, deviation } = planarityOf(points);
  if (!plane || deviation > maxDeviation) return { flattened: false, deviation };

  for (const vid of vertices) {
    const v = getVertex(g, vid);
    const d = distanceToPlane(v.position, plane);
    if (d === 0) continue;
    const signed =
      (v.position.x - plane.point.x) * plane.normal.x +
      (v.position.y - plane.point.y) * plane.normal.y +
      (v.position.z - plane.point.z) * plane.normal.z;
    v.position = {
      x: v.position.x - plane.normal.x * signed,
      y: v.position.y - plane.normal.y * signed,
      z: v.position.z - plane.normal.z * signed,
    };
  }
  return { flattened: true, deviation };
}

/** Edges that bound no face. Legal, and often deliberate. */
export function findStrayEdges(g: Graph): EdgeId[] {
  const out: EdgeId[] = [];
  for (const [id, e] of g.edges) if (e.uses.length === 0) out.push(id);
  return out.sort((a, b) => a - b);
}

/** Edges used by three or more faces. Legal; normal propagation stops here. §2.4 */
export function findNonManifoldEdges(g: Graph): EdgeId[] {
  const out: EdgeId[] = [];
  for (const [id, e] of g.edges) if (classifyEdge(e) === 'non-manifold') out.push(id);
  return out.sort((a, b) => a - b);
}

/**
 * Vertices where two faces meet at a point but share no edge — a pinch.
 *
 * Legal geometry, and every edge involved stays manifold: the VERTEX is the
 * non-manifold element, not any edge. Flag it because it is often
 * unintentional, but do not reject it. §6.2
 */
export function findNonManifoldVertices(g: Graph): VertexId[] {
  const out: VertexId[] = [];
  for (const [id, v] of g.vertices) {
    if (v.edges.length < 4) continue;
    // Group the attached faces; a pinch shows as 2+ groups sharing only this
    // vertex.
    const facesPerEdge = v.edges.map((eid) => {
      const e = g.edges.get(eid);
      if (!e) return new Set<number>();
      return new Set(e.uses.map((u) => g.loops.get(u.loop)?.face ?? -1));
    });
    const groups: Set<number>[] = [];
    for (const faces of facesPerEdge) {
      if (faces.size === 0) continue;
      const hit = groups.find((grp) => [...faces].some((f) => grp.has(f)));
      if (hit) for (const f of faces) hit.add(f);
      else groups.push(new Set(faces));
    }
    if (groups.length >= 2) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

export function findIsolatedVertices(g: Graph): VertexId[] {
  const out: VertexId[] = [];
  for (const [id, v] of g.vertices) if (v.edges.length === 0) out.push(id);
  return out.sort((a, b) => a - b);
}

/** Zero-length or near-zero edges that slipped past insertion. */
export function findDegenerateEdges(g: Graph, tol: Tolerances): EdgeId[] {
  const out: EdgeId[] = [];
  for (const [id, e] of g.edges) {
    const [a, b] = edgePoints(g, e);
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (d < tol.MIN_EDGE_LENGTH) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

/** Everything, in one pass, for the diagnostics panel. */
export function runDiagnostics(g: Graph, tol: Tolerances): DiagnosticReport {
  const diagnostics: Diagnostic[] = [];

  const stray = findStrayEdges(g);
  if (stray.length > 0) {
    diagnostics.push({
      kind: 'stray-edge',
      message: `${stray.length} edge(s) bound no face. Legal, and often deliberate construction geometry.`,
      edges: stray,
    });
  }

  const nonManifold = findNonManifoldEdges(g);
  if (nonManifold.length > 0) {
    diagnostics.push({
      kind: 'non-manifold-edge',
      message: `${nonManifold.length} edge(s) used by 3 or more faces. Normal propagation and smoothing stop here.`,
      edges: nonManifold,
    });
  }

  const pinches = findNonManifoldVertices(g);
  if (pinches.length > 0) {
    diagnostics.push({
      kind: 'non-manifold-vertex',
      message: `${pinches.length} vertex/vertices where faces meet at a point but share no edge.`,
      vertices: pinches,
    });
  }

  const degenerate = findDegenerateEdges(g, tol);
  if (degenerate.length > 0) {
    diagnostics.push({
      kind: 'degenerate-rejected',
      message: `${degenerate.length} edge(s) shorter than MIN_EDGE_LENGTH.`,
      edges: degenerate,
    });
  }

  const nearCoplanar = findNearCoplanar(g, tol);
  diagnostics.push(...nearCoplanar);

  return {
    diagnostics,
    counts: {
      strayEdges: stray.length,
      nonManifoldEdges: nonManifold.length,
      nonManifoldVertices: pinches.length,
      nearCoplanarCycles: nearCoplanar.length,
      isolatedVertices: findIsolatedVertices(g).length,
    },
  };
}
