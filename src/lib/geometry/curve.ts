/**
 * PolyForm geometry kernel — analytic curves. §5.5, §5.7
 *
 * An arc is an ordered run of straight edges PLUS the analytic parameters
 * that generated them. Never store an arc as bare segments: radius, centre
 * and tangency are needed for offset, follow-me, dimensioning, and for
 * regenerating at a different segment count.
 *
 * Two rules here are easy to get wrong and expensive to debug:
 *
 *  - End vertices are BOUND, not computed. Evaluating C + R*u at the end
 *    angles lands a fraction of a unit from the vertex the user snapped to;
 *    the resulting cycle then misses COPLANARITY_TOLERANCE and a curve that
 *    visibly meets its neighbour refuses to close a face.
 *
 *  - Demotion is metadata-only. A demoted stub keeps its vertices exactly
 *    where they are; only the Curve wrapper is dropped. A demotion that moves
 *    geometry shows up as a visible kink at the joint.
 */

import type {
  Curve, CurveId, EdgeId, Graph, Tolerances, Vec3, VertexId,
} from './types';
import {
  add, cross, distance, dot, length, lengthSq, normalize, planeBasis, scale,
  sub, tryNormalize,
} from './math';
import { getEdge, getVertex, removeEdge } from './topology';
import { insertEdge, type InsertContext } from './insert';

export interface ArcSpec {
  readonly centre: Vec3;
  /** Unit length. Defines the arc's plane and its sweep direction. */
  readonly normal: Vec3;
  readonly radius: number;
  readonly startAngle: number;
  /** Signed, radians. */
  readonly sweep: number;
  readonly segments: number;
}

export const DEFAULT_SEGMENTS = 12;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Mode A: centre, a start point on the arc, and a swept angle. §5.1 */
export function arcFromCentreStartSweep(
  centre: Vec3,
  start: Vec3,
  sweep: number,
  normal: Vec3,
  segments = DEFAULT_SEGMENTS,
): ArcSpec | null {
  const r = distance(centre, start);
  if (!(r > 0)) return null;
  const n = tryNormalize(normal);
  if (!n) return null;
  const basis = planeBasis({ point: centre, normal: n });
  const d = sub(start, centre);
  const startAngle = Math.atan2(dot(d, basis.v), dot(d, basis.u));
  return { centre, normal: n, radius: r, startAngle, sweep, segments };
}

/**
 * Mode B: chord plus bulge. The default mode, and where most users live. §5.2
 *
 * `bulge` is the perpendicular distance from the chord's midpoint to the
 * arc's apex, signed along `bulgeDirection`.
 */
export function arcFromChordBulge(
  p0: Vec3,
  p1: Vec3,
  bulge: number,
  bulgeDirection: Vec3,
  segments = DEFAULT_SEGMENTS,
): ArcSpec | null {
  const chord = sub(p1, p0);
  const chordLen = length(chord);
  if (!(chordLen > 0)) return null;
  if (Math.abs(bulge) < 1e-12) return null; // straight: the caller emits a line

  const bd = tryNormalize(bulgeDirection);
  if (!bd) return null;

  const half = chordLen / 2;
  const h = bulge;
  const radius = (h * h + half * half) / (2 * Math.abs(h));
  if (!Number.isFinite(radius) || radius <= 0) return null;

  const mid = add(p0, scale(chord, 0.5));
  const apex = add(mid, scale(bd, h));
  const toCentre = tryNormalize(sub(mid, apex));
  if (!toCentre) return null;
  const centre = add(apex, scale(toCentre, radius));

  const normal = tryNormalize(cross(chord, bd));
  if (!normal) return null;

  const basis = planeBasis({ point: centre, normal });
  const a0 = sub(p0, centre);
  const a1 = sub(p1, centre);
  const startAngle = Math.atan2(dot(a0, basis.v), dot(a0, basis.u));
  const endAngle = Math.atan2(dot(a1, basis.v), dot(a1, basis.u));

  // Choose the sweep that passes through the apex, so a major arc stays major.
  let sweep = endAngle - startAngle;
  while (sweep <= -Math.PI * 2) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  const midAngle = startAngle + sweep / 2;
  const midPoint = add(
    centre,
    add(scale(basis.u, radius * Math.cos(midAngle)), scale(basis.v, radius * Math.sin(midAngle))),
  );
  if (distance(midPoint, apex) > distance(midPoint, add(mid, scale(bd, -h)))) {
    sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
  }

  return { centre, normal, radius, startAngle, sweep, segments };
}

/** Mode C: three points the arc must pass through. §5.3 */
export function arcFromThreePoints(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  segments = DEFAULT_SEGMENTS,
): ArcSpec | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = tryNormalize(cross(ab, ac));
  if (!n) return null; // colinear: no circle

  // Circumcentre in 3D.
  const abLenSq = lengthSq(ab);
  const acLenSq = lengthSq(ac);
  const crossAB_AC = cross(ab, ac);
  const denom = 2 * lengthSq(crossAB_AC);
  if (!(denom > 0)) return null;

  const term1 = scale(cross(sub(scale(ac, abLenSq), scale(ab, acLenSq)), crossAB_AC), 1 / denom);
  const centre = add(a, term1);
  const radius = distance(centre, a);
  if (!(radius > 0)) return null;

  const basis = planeBasis({ point: centre, normal: n });
  const ang = (p: Vec3) => {
    const d = sub(p, centre);
    return Math.atan2(dot(d, basis.v), dot(d, basis.u));
  };
  const a0 = ang(a);
  const aB = ang(b);
  const a2 = ang(c);

  const norm = (x: number) => {
    let y = x;
    while (y < 0) y += Math.PI * 2;
    while (y >= Math.PI * 2) y -= Math.PI * 2;
    return y;
  };
  // Sweep must pass through b, which is what distinguishes the two arcs.
  const ccwToB = norm(aB - a0);
  const ccwToC = norm(a2 - a0);
  const sweep = ccwToB <= ccwToC ? ccwToC : ccwToC - Math.PI * 2;

  return { centre, normal: n, radius, startAngle: a0, sweep, segments };
}

// ---------------------------------------------------------------------------
// Tessellation
// ---------------------------------------------------------------------------

export function arcPointAt(spec: ArcSpec, t: number): Vec3 {
  const basis = planeBasis({ point: spec.centre, normal: spec.normal });
  const a = spec.startAngle + spec.sweep * t;
  return add(
    spec.centre,
    add(
      scale(basis.u, spec.radius * Math.cos(a)),
      scale(basis.v, spec.radius * Math.sin(a)),
    ),
  );
}

/**
 * Interior vertices come from the analytic parameters; the ends are BOUND to
 * the points the user snapped to, never recomputed. §5.5
 */
export function arcPoints(spec: ArcSpec, startAnchor?: Vec3, endAnchor?: Vec3): Vec3[] {
  const n = Math.max(2, Math.floor(spec.segments));
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) pts.push(arcPointAt(spec, i / n));
  if (startAnchor) pts[0] = startAnchor;
  if (endAnchor) pts[n] = endAnchor;
  return pts;
}

/** Maximum deviation of a chord from the true arc. */
export const sagitta = (radius: number, sweep: number): number =>
  radius * (1 - Math.cos(Math.abs(sweep) / 2));

/**
 * Should this piece stop being a curve?
 *
 * A flat angular cutoff is radius-blind: a 5-degree sweep at 50 m radius is a
 * 4.4 m run with obvious curvature. The sagitta says the thing we actually
 * mean — indistinguishable from a straight line at the model's own tolerance
 * — and scales correctly. The sweep floor is a cheap early-out. §5.7 Rule 4
 */
export function shouldDemote(spec: ArcSpec, tol: Tolerances, edgeCount: number): boolean {
  if (edgeCount < 2) return true;
  if (Math.abs(spec.sweep) < tol.MIN_ARC_SWEEP) return true;
  return sagitta(spec.radius, spec.sweep) < tol.VERTEX_MERGE_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Creating a curve in the graph
// ---------------------------------------------------------------------------

export interface CreateArcResult {
  readonly curveId: CurveId | null;
  readonly edges: EdgeId[];
  readonly touched: Set<EdgeId>;
  /** True when the arc degenerated and plain edges were emitted instead. */
  readonly demoted: boolean;
}

/**
 * Inserts an arc as a run of edges wrapped in a Curve.
 *
 * Each segment goes through insertEdge, so an arc splits faces and merges
 * with existing geometry exactly as hand-drawn lines do — the segments are
 * ordinary edges, and that is the point.
 */
export function createArc(
  ctx: InsertContext,
  spec: ArcSpec,
  opts: { startAnchor?: Vec3; endAnchor?: Vec3 } = {},
): CreateArcResult {
  const touched = new Set<EdgeId>();
  const points = arcPoints(spec, opts.startAnchor, opts.endAnchor);
  const edges: EdgeId[] = [];

  for (let i = 0; i + 1 < points.length; i++) {
    const r = insertEdge(ctx, points[i]!, points[i + 1]!);
    for (const t of r.touched) touched.add(t);
    for (const e of r.edges) edges.push(e);
  }

  if (edges.length === 0) {
    return { curveId: null, edges, touched, demoted: true };
  }

  if (shouldDemote(spec, ctx.tolerances, edges.length)) {
    // Metadata-only: vertices stay exactly where they are.
    return { curveId: null, edges, touched, demoted: true };
  }

  const id = ctx.graph.nextId.curve++ as CurveId;
  const curve: Curve = {
    id,
    kind: 'arc',
    edges: [...edges],
    centre: spec.centre,
    normal: spec.normal,
    radius: spec.radius,
    startAngle: spec.startAngle,
    sweep: spec.sweep,
    segments: Math.max(2, Math.floor(spec.segments)),
    startTruncated: false,
    endTruncated: false,
  };
  ctx.graph.curves.set(id, curve);

  for (const eid of edges) {
    const e = ctx.graph.edges.get(eid);
    if (!e) continue;
    e.curve = id;
  }
  // Interior edges are smoothed so adjacent faces shade as one surface. The
  // edges still exist — they are simply not drawn. §5.5
  applySmoothing(ctx.graph, id);

  return { curveId: id, edges, touched, demoted: false };
}

/** Marks interior curve edges smooth and the two ends hard. */
export function applySmoothing(g: Graph, id: CurveId): void {
  const curve = g.curves.get(id);
  if (!curve) return;
  curve.edges.forEach((eid, i) => {
    const e = g.edges.get(eid);
    if (!e) return;
    e.smooth = i > 0 && i < curve.edges.length - 1;
  });
}

// ---------------------------------------------------------------------------
// Ordering and traversal
// ---------------------------------------------------------------------------

/** Ordered vertices along a curve, start to end. */
export function curveVertices(g: Graph, id: CurveId): VertexId[] {
  const curve = g.curves.get(id);
  if (!curve || curve.edges.length === 0) return [];

  const first = g.edges.get(curve.edges[0]!);
  if (!first) return [];

  // Orient from whichever endpoint of the first edge is not shared with the
  // second, so the walk starts at the true beginning.
  let current: VertexId = first.v0;
  if (curve.edges.length > 1) {
    const second = g.edges.get(curve.edges[1]!);
    if (second && (second.v0 === first.v0 || second.v1 === first.v0)) current = first.v1;
  }

  const out: VertexId[] = [current];
  for (const eid of curve.edges) {
    const e = g.edges.get(eid);
    if (!e) break;
    current = e.v0 === current ? e.v1 : e.v0;
    out.push(current);
  }
  return out;
}

// ---------------------------------------------------------------------------
// §5.7 Splitting
// ---------------------------------------------------------------------------

export interface SplitCurveResult {
  readonly curves: CurveId[];
  readonly demoted: EdgeId[];
}

/**
 * Divides a curve at a vertex lying on it.
 *
 * Splits into TWO Curve entities, each inheriting centre, normal and radius
 * with recomputed startAngle and sweep. Never explodes to loose edges: that
 * would silently destroy the analytic data offset and follow-me depend on,
 * and it is not recoverable. §5.7 Rule 2
 *
 * When the split point does not sit on the true circle — a mid-segment cut —
 * the affected side is flagged truncated, which disables Ns re-solve because
 * regenerating would move the cut vertex and break the join. §5.7 Rule 3
 */
export function splitCurve(
  g: Graph,
  id: CurveId,
  at: VertexId,
  tol: Tolerances,
): SplitCurveResult {
  const curve = g.curves.get(id);
  if (!curve) return { curves: [], demoted: [] };

  const verts = curveVertices(g, id);
  const index = verts.indexOf(at);
  if (index <= 0 || index >= verts.length - 1) {
    // At an end, or not on the curve at all: nothing to divide.
    return { curves: [id], demoted: [] };
  }

  const firstEdges = curve.edges.slice(0, index);
  const secondEdges = curve.edges.slice(index);

  // Is the cut on the true circle, or inside a chord?
  const cutPoint = getVertex(g, at).position;
  const radial = Math.abs(distance(cutPoint, curve.centre) - curve.radius);
  const onCircle = radial <= tol.VERTEX_MERGE_TOLERANCE;

  const basis = planeBasis({ point: curve.centre, normal: curve.normal });
  const angleOf = (v: VertexId) => {
    const d = sub(getVertex(g, v).position, curve.centre);
    return Math.atan2(dot(d, basis.v), dot(d, basis.u));
  };

  const startA = curve.startAngle;
  const endA = curve.startAngle + curve.sweep;
  let cutA = angleOf(at);
  // Bring the cut angle into the swept interval.
  const dir = Math.sign(curve.sweep) || 1;
  while (dir > 0 && cutA < startA) cutA += Math.PI * 2;
  while (dir < 0 && cutA > startA) cutA -= Math.PI * 2;

  g.curves.delete(id);
  const out: CurveId[] = [];
  const demoted: EdgeId[] = [];

  const make = (
    edges: EdgeId[],
    a0: number,
    a1: number,
    truncStart: boolean,
    truncEnd: boolean,
  ) => {
    const spec: ArcSpec = {
      centre: curve.centre,
      normal: curve.normal,
      radius: curve.radius,
      startAngle: a0,
      sweep: a1 - a0,
      segments: edges.length,
    };
    if (shouldDemote(spec, tol, edges.length)) {
      // A one-segment "arc" is a line carrying misleading metadata. §5.7 R4
      for (const eid of edges) {
        const e = g.edges.get(eid);
        if (e) { e.curve = null; e.smooth = false; }
        demoted.push(eid);
      }
      return;
    }
    const nid = g.nextId.curve++ as CurveId;
    g.curves.set(nid, {
      id: nid,
      kind: 'arc',
      edges,
      centre: curve.centre,
      normal: curve.normal,
      radius: curve.radius,
      startAngle: a0,
      sweep: a1 - a0,
      segments: edges.length,
      startTruncated: truncStart,
      endTruncated: truncEnd,
    });
    for (const eid of edges) {
      const e = g.edges.get(eid);
      if (e) e.curve = nid;
    }
    applySmoothing(g, nid);
    out.push(nid);
  };

  make(firstEdges, startA, cutA, curve.startTruncated, !onCircle);
  make(secondEdges, cutA, endA, !onCircle, curve.endTruncated);

  return { curves: out, demoted };
}

// ---------------------------------------------------------------------------
// Segment-count re-solve
// ---------------------------------------------------------------------------

export interface ResolveResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly curveId?: CurveId;
  readonly touched?: Set<EdgeId>;
}

/**
 * Regenerates a curve at a new segment count.
 *
 * Refused on a truncated curve: regenerating would move the cut vertex and
 * break the connection to whatever edge caused the split. Grey the control
 * out and say why rather than failing silently. §5.7 Rule 3
 *
 * The shared end vertices do not move — same binding rule as construction.
 */
export function resolveSegments(
  ctx: InsertContext,
  id: CurveId,
  segments: number,
): ResolveResult {
  const g = ctx.graph;
  const curve = g.curves.get(id);
  if (!curve) return { ok: false, reason: 'curve not found' };
  if (curve.startTruncated || curve.endTruncated) {
    return {
      ok: false,
      reason:
        'This arc was cut mid-segment, so its end no longer lies on the true ' +
        'circle. Changing the segment count would move the cut point and break ' +
        'the join.',
    };
  }
  if (!Number.isInteger(segments) || segments < 2) {
    return { ok: false, reason: 'segment count must be an integer >= 2' };
  }

  const verts = curveVertices(g, id);
  if (verts.length < 2) return { ok: false, reason: 'curve is degenerate' };

  const startAnchor = getVertex(g, verts[0]!).position;
  const endAnchor = getVertex(g, verts[verts.length - 1]!).position;

  // Any interior vertex with other geometry attached would be orphaned by a
  // regeneration, so refuse rather than silently detaching it.
  for (let i = 1; i < verts.length - 1; i++) {
    const v = getVertex(g, verts[i]!);
    if (v.edges.length > 2) {
      return {
        ok: false,
        reason: 'Other geometry is attached partway along this arc.',
      };
    }
  }

  const oldEdges = [...curve.edges];
  const spec: ArcSpec = { ...curve, segments };

  for (const eid of oldEdges) {
    const e = g.edges.get(eid);
    if (!e) continue;
    e.curve = null;
  }
  for (const eid of oldEdges) {
    removeEdge(g, eid);
    ctx.index.remove(eid);
  }
  for (let i = 1; i < verts.length - 1; i++) {
    const v = g.vertices.get(verts[i]!);
    if (v && v.edges.length === 0) g.vertices.delete(verts[i]!);
  }
  g.curves.delete(id);

  const created = createArc(ctx, spec, { startAnchor, endAnchor });
  return created.curveId
    ? { ok: true, curveId: created.curveId, touched: created.touched }
    : { ok: false, reason: 'regenerated arc was degenerate' };
}

export { getEdge, normalize };
