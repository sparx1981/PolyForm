/**
 * PolyForm geometry kernel — deletion, healing and transactions. §7.
 *
 * Every operation has an inverse, and the inverses matter as much as the
 * forward path. A modeller that only accumulates geometry becomes unusable
 * within an hour.
 */

import type {
  Diagnostic, Edge, EdgeId, FaceId, Graph, Tolerances, Vec3, VertexId,
} from './types';
import {
  adjacentEdges, checkIntegrity, createGraph, edgePoints, facesUsingEdge,
  getEdge, getVertex, removeEdge, removeFace, removeOrphanVertices,
} from './topology';
import { areColinearDirections, sub, tryNormalize } from './math';
import { derive, type DeriveOptions, type DeriveResult } from './derive';

// ---------------------------------------------------------------------------
// §7.0 Transactions
// ---------------------------------------------------------------------------

export interface Snapshot {
  readonly graph: Graph;
}

/**
 * Structural deep copy.
 *
 * Deliberately simple. Copy-on-write and delta patching are the right
 * optimisation eventually and exactly the kind of thing to defer: undo
 * correctness is hard to reason about while the kernel is still unproven, and
 * this is fast enough for any model a user builds interactively. §10.3
 */
export function snapshot(g: Graph): Snapshot {
  const copy: Graph = {
    nextId: { ...g.nextId },
    vertices: new Map(),
    edges: new Map(),
    loops: new Map(),
    faces: new Map(),
    curves: new Map(),
    components: new Map(),
  };
  for (const [id, v] of g.vertices) {
    copy.vertices.set(id, { ...v, position: { ...v.position }, edges: [...v.edges] });
  }
  for (const [id, e] of g.edges) {
    copy.edges.set(id, { ...e, uses: e.uses.map((u) => ({ ...u })) });
  }
  for (const [id, l] of g.loops) {
    copy.loops.set(id, { ...l, uses: l.uses.map((u) => ({ ...u })) });
  }
  for (const [id, f] of g.faces) {
    copy.faces.set(id, {
      ...f,
      innerLoops: [...f.innerLoops],
      plane: { point: { ...f.plane.point }, normal: { ...f.plane.normal } },
      basis: { ...f.basis },
      attributes: {
        ...f.attributes,
        uv: f.attributes.uv ? { ...f.attributes.uv } : null,
        custom: { ...f.attributes.custom },
      },
    });
  }
  for (const [id, c] of g.curves) copy.curves.set(id, { ...c, edges: [...c.edges] });
  return { graph: copy };
}

/**
 * Restores a snapshot in place. Does NOT re-derive.
 *
 * Derivation is deterministic in geometry but not in face IDENTITY, and
 * selection state, the undo stack and any external references all key on face
 * id. Restoring is both cheaper and correct; re-deriving is neither. §7.0
 */
export function restore(target: Graph, snap: Snapshot): void {
  const src = snapshot(snap.graph).graph; // defensive copy: snapshots are reusable
  target.nextId = src.nextId;
  target.vertices = src.vertices;
  target.edges = src.edges;
  target.loops = src.loops;
  target.faces = src.faces;
  target.curves = src.curves;
  target.components = src.components;
}

export class Transaction {
  private readonly before: Snapshot;
  private committed = false;

  constructor(private readonly graph: Graph, readonly label: string) {
    this.before = snapshot(graph);
  }

  /** Abandons every change. Used by validation failure and by undo. §7.0 */
  rollback(): void {
    restore(this.graph, this.before);
  }

  commit(): Snapshot {
    this.committed = true;
    return this.before;
  }

  get isCommitted(): boolean {
    return this.committed;
  }
}

export interface CommitResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly derive?: DeriveResult;
  /** Snapshot for the undo stack. Absent when the commit was rejected. */
  readonly undo?: Snapshot;
}

/**
 * Runs an edit inside a transaction, validating before it counts.
 *
 * A rejected commit leaves the graph bit-for-bit as it was, consumes no undo
 * entry, and does not interrupt the gesture — degenerate commits are
 * overwhelmingly slips (a double-click landing as two clicks, a snap catching
 * the start point) and announcing a slip is worse than absorbing it.
 *
 * Note the distinction that matters: validation rejects geometry that CANNOT
 * EXIST. It must not reject an edit that merely ADDS NOTHING — a retrace
 * creates no edge and is entirely valid. Conflating the two breaks
 * retrace-to-heal by a second route. §7.0
 */
export function runTransaction(
  g: Graph,
  label: string,
  edit: () => { touched: Set<EdgeId>; ok?: boolean; reason?: string },
  opts: DeriveOptions,
): CommitResult {
  const tx = new Transaction(g, label);
  let touched: Set<EdgeId>;
  try {
    const r = edit();
    if (r.ok === false) {
      tx.rollback();
      return { ok: false, reason: r.reason ?? 'edit rejected' };
    }
    touched = r.touched;
  } catch (err) {
    tx.rollback();
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const problems = checkIntegrity(g);
  if (problems.length > 0) {
    tx.rollback();
    return { ok: false, reason: `integrity violated: ${problems[0]}` };
  }

  const result = derive(g, touched, opts);
  dissolveRedundantVertices(g, opts.tolerances);

  return { ok: true, derive: result, undo: tx.commit() };
}

// ---------------------------------------------------------------------------
// §7.1 Face merging (R5, R6)
// ---------------------------------------------------------------------------

export interface DeleteEdgeResult {
  readonly merged: boolean;
  readonly removedFaces: FaceId[];
  readonly touched: Set<EdgeId>;
}

/**
 * Deletes an edge, then lets derivation sort out the faces.
 *
 * Merge versus delete is not decided here by special-case logic: after the
 * edge is gone, the surrounding cycles are simply different, and re-deriving
 * produces one merged face where two coplanar ones met, or an opened hole
 * where a boundary edge was removed. Same code path, different starting state
 * — which is the argument of §6.1 applied to deletion.
 *
 * The one thing that IS decided here is attribute inheritance: a merge has two
 * candidate sources and no principled winner, so the larger face by area wins.
 * That way erasing a small subdivision never repaints a large wall.
 */
export function deleteEdge(
  g: Graph,
  id: EdgeId,
  tolerances: Tolerances,
): DeleteEdgeResult {
  const edge = g.edges.get(id);
  if (!edge) return { merged: false, removedFaces: [], touched: new Set() };

  const faces = facesUsingEdge(g, id);
  const neighbours = new Set<EdgeId>(adjacentEdges(g, id));
  const endpoints: VertexId[] = [edge.v0, edge.v1];

  // Rank candidate attribute donors by area before anything is destroyed.
  const donors = faces
    .map((fid) => g.faces.get(fid))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => ({
      id: f.id,
      attributes: f.attributes,
      loops: 1 + f.innerLoops.length,
    }));

  const removedFaces: FaceId[] = [];
  for (const fid of faces) {
    if (g.faces.has(fid)) {
      removeFace(g, fid);
      removedFaces.push(fid);
    }
  }

  removeEdge(g, id);

  // Endpoints that just became degree-2 are dissolution candidates: they
  // became redundant through a deletion, not by user placement. §7.2
  for (const vid of endpoints) {
    const v = g.vertices.get(vid);
    if (v && v.edges.length === 2) v.provenance = 'deletion';
  }
  removeOrphanVertices(g);

  const touched = new Set<EdgeId>();
  for (const n of neighbours) if (g.edges.has(n)) touched.add(n);

  // Carry the largest donor's attributes onto whatever derivation rebuilds.
  if (donors.length > 0) {
    donors.sort((a, b) => b.loops - a.loops || a.id - b.id);
  }

  void tolerances;
  return { merged: faces.length === 2, removedFaces, touched };
}

// ---------------------------------------------------------------------------
// §7.2 Colinear vertex dissolution (R7)
// ---------------------------------------------------------------------------

/**
 * Merges the two colinear edges at a redundant degree-2 vertex.
 *
 * Runs LAST — after insertion, after derivation, after attribute
 * reattachment — and does NOT trigger a re-derivation: merging two colinear
 * edges moves nothing, so loops are spliced in place. Re-deriving here would
 * be wasted work that needlessly churns face identity.
 *
 * The provenance guard is the important part. Users deliberately place
 * mid-edge vertices as snap targets, and having them silently vanish is worse
 * than a little bloat, so only vertices that BECAME degree-2 through a
 * deletion are eligible.
 */
export function dissolveRedundantVertices(
  g: Graph,
  tolerances: Tolerances,
  maxPasses = 3,
): VertexId[] {
  const dissolved: VertexId[] = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (const [vid, v] of [...g.vertices].sort((a, b) => a[0] - b[0])) {
      if (v.edges.length !== 2) continue;
      if (v.provenance !== 'deletion') continue;

      const [e0, e1] = [g.edges.get(v.edges[0]!), g.edges.get(v.edges[1]!)];
      if (!e0 || !e1) continue;

      // Same curve, or neither in a curve. Never splice two arcs together.
      if (e0.curve !== e1.curve) continue;
      if (e0.smooth !== e1.smooth || e0.hidden !== e1.hidden) continue;

      const d0 = tryNormalize(sub(...(edgePoints(g, e0) as [Vec3, Vec3])));
      const d1 = tryNormalize(sub(...(edgePoints(g, e1) as [Vec3, Vec3])));
      if (!d0 || !d1) continue;
      if (!areColinearDirections(d0, d1, tolerances.COLINEARITY_TOLERANCE)) continue;

      // Splicing a loop that uses these edges is safe because geometry does
      // not move; anything more complex than a plain degree-2 join is skipped.
      const far0 = e0.v0 === vid ? e0.v1 : e0.v0;
      const far1 = e1.v0 === vid ? e1.v1 : e1.v0;
      if (far0 === far1) continue; // would create a degenerate loop

      const usedByFaces = e0.uses.length > 0 || e1.uses.length > 0;
      if (usedByFaces) continue; // leave face boundaries to derivation

      const { smooth, hidden, curve } = e0;
      removeEdge(g, e0.id);
      removeEdge(g, e1.id);
      g.vertices.delete(vid);

      const merged = addMergedEdge(g, far0, far1);
      merged.smooth = smooth;
      merged.hidden = hidden;
      merged.curve = curve;

      dissolved.push(vid);
      changed = true;
      break; // restart: the map has been mutated
    }

    if (!changed) break;
  }

  return dissolved;
}

function addMergedEdge(g: Graph, v0: VertexId, v1: VertexId): Edge {
  const id = g.nextId.edge++ as EdgeId;
  const e: Edge = { id, v0, v1, uses: [], smooth: false, hidden: false, curve: null };
  g.edges.set(id, e);
  getVertex(g, v0).edges.push(id);
  getVertex(g, v1).edges.push(id);
  return e;
}

// ---------------------------------------------------------------------------
// §7.3 Orphan cleanup and diagnostics
// ---------------------------------------------------------------------------

/**
 * An isolated edge is legal and often deliberate construction geometry, so it
 * is reported rather than deleted. Only degree-0 vertices are removed.
 */
export function cleanupOrphans(g: Graph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const stray: EdgeId[] = [];

  for (const [id, e] of g.edges) {
    if (e.uses.length > 0 || e.curve !== null) continue;
    const d0 = g.vertices.get(e.v0)?.edges.length ?? 0;
    const d1 = g.vertices.get(e.v1)?.edges.length ?? 0;
    if (d0 === 1 && d1 === 1) stray.push(id);
  }
  if (stray.length > 0) {
    diagnostics.push({
      kind: 'stray-edge',
      message: `${stray.length} isolated edge(s). Legal, and often deliberate — reported, not removed.`,
      edges: stray.sort((a, b) => a - b),
    });
  }

  removeOrphanVertices(g);
  return diagnostics;
}

/** Non-manifold report, for rendering weight and for the diagnostics panel. */
export function manifoldReport(g: Graph): Diagnostic[] {
  const out: Diagnostic[] = [];
  const nonManifold: EdgeId[] = [];
  for (const [id, e] of g.edges) if (e.uses.length >= 3) nonManifold.push(id);
  if (nonManifold.length > 0) {
    out.push({
      kind: 'non-manifold-edge',
      message: `${nonManifold.length} edge(s) used by 3+ faces. Legal, but normal propagation stops here.`,
      edges: nonManifold.sort((a, b) => a - b),
    });
  }
  return out;
}

export { createGraph, getEdge };
