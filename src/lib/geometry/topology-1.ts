/**
 * PolyForm geometry kernel — half-edge topology store.
 *
 * Primitive add/remove and edge-use bookkeeping. No derivation, no
 * intersection, no faces created from cycles — those are Phases 4 to 6. This
 * file only maintains a consistent graph.
 *
 * The central rule (§2.4): an edge may be used by ANY number of faces. Three
 * walls meeting at a corner, or a fin on a panel, are legal and common, so
 * `uses` is an unbounded array rather than a pair of face slots.
 */

import type {
  Edge, EdgeClassification, EdgeId, EdgeUse, Face, FaceAttributes, FaceId,
  Graph, Loop, LoopId, Vec3, Vertex, VertexId, VertexProvenance,
} from './types';

export function createGraph(): Graph {
  return {
    nextId: { vertex: 1, edge: 1, loop: 1, face: 1, curve: 1, component: 1 },
    vertices: new Map(),
    edges: new Map(),
    loops: new Map(),
    faces: new Map(),
    curves: new Map(),
    components: new Map(),
  };
}

export const defaultAttributes = (): FaceAttributes => ({
  materialFront: null,
  materialBack: null,
  uv: null,
  layer: null,
  orientationLocked: false,
  hidden: false,
  name: null,
  custom: {},
});

// ---------------------------------------------------------------------------
// Vertices
// ---------------------------------------------------------------------------

export function addVertex(
  g: Graph,
  position: Vec3,
  provenance: VertexProvenance = 'user',
): Vertex {
  const id = g.nextId.vertex++ as VertexId;
  const v: Vertex = { id, position, edges: [], provenance };
  g.vertices.set(id, v);
  return v;
}

export const getVertex = (g: Graph, id: VertexId): Vertex => {
  const v = g.vertices.get(id);
  if (!v) throw new Error(`Vertex ${id} not found`);
  return v;
};

export const vertexDegree = (g: Graph, id: VertexId): number =>
  g.vertices.get(id)?.edges.length ?? 0;

/**
 * Removes a vertex only when nothing is attached. A vertex with edges is
 * removed by removing those edges — silently orphaning them would leave the
 * graph inconsistent in a way nothing downstream checks for.
 */
export function removeVertex(g: Graph, id: VertexId): boolean {
  const v = g.vertices.get(id);
  if (!v) return false;
  if (v.edges.length > 0) {
    throw new Error(
      `Cannot remove vertex ${id}: ${v.edges.length} edge(s) still attached. ` +
        `Remove the edges first.`,
    );
  }
  g.vertices.delete(id);
  return true;
}

/** Degree-0 vertices only. Genuinely orphaned, safe to drop silently. §7.3 */
export function removeOrphanVertices(g: Graph): VertexId[] {
  const removed: VertexId[] = [];
  for (const [id, v] of [...g.vertices].sort((a, b) => a[0] - b[0])) {
    if (v.edges.length === 0) {
      g.vertices.delete(id);
      removed.push(id);
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Creates an edge with no deduplication, no intersection and no splitting.
 * Those are Phase 4 and 4b — this is the primitive they build on.
 */
export function addEdge(g: Graph, v0: VertexId, v1: VertexId): Edge {
  if (v0 === v1) throw new Error(`Cannot create a degenerate edge from vertex ${v0} to itself`);
  const a = getVertex(g, v0);
  const b = getVertex(g, v1);
  const id = g.nextId.edge++ as EdgeId;
  const e: Edge = { id, v0, v1, uses: [], smooth: false, hidden: false, curve: null };
  g.edges.set(id, e);
  a.edges.push(id);
  b.edges.push(id);
  return e;
}

export const getEdge = (g: Graph, id: EdgeId): Edge => {
  const e = g.edges.get(id);
  if (!e) throw new Error(`Edge ${id} not found`);
  return e;
};

/**
 * Removes an edge and every use of it. Faces are NOT touched here — deciding
 * between merge and delete is R5/R6, which lives in Phase 8 and needs
 * coplanarity information this file has no business knowing about.
 */
export function removeEdge(g: Graph, id: EdgeId): boolean {
  const e = g.edges.get(id);
  if (!e) return false;

  for (const vid of [e.v0, e.v1]) {
    const v = g.vertices.get(vid);
    if (!v) continue;
    const i = v.edges.indexOf(id);
    if (i >= 0) v.edges.splice(i, 1);
  }

  for (const loop of g.loops.values()) {
    const before = loop.uses.length;
    loop.uses = loop.uses.filter((u) => u.edge !== id);
    if (loop.uses.length !== before) {
      // The loop is now open. Phase 8 decides what happens to its face.
    }
  }

  if (e.curve !== null) {
    const curve = g.curves.get(e.curve);
    if (curve) {
      curve.edges = curve.edges.filter((x) => x !== id);
      if (curve.edges.length === 0) g.curves.delete(e.curve);
    }
  }

  g.edges.delete(id);
  return true;
}

export const otherVertex = (e: Edge, v: VertexId): VertexId => {
  if (e.v0 === v) return e.v1;
  if (e.v1 === v) return e.v0;
  throw new Error(`Vertex ${v} is not an endpoint of edge ${e.id}`);
};

/** Edges sharing a vertex with this one. Deterministic order. §10.3 */
export function adjacentEdges(g: Graph, id: EdgeId): EdgeId[] {
  const e = g.edges.get(id);
  if (!e) return [];
  const out = new Set<EdgeId>();
  for (const vid of [e.v0, e.v1]) {
    const v = g.vertices.get(vid);
    if (!v) continue;
    for (const other of v.edges) if (other !== id) out.add(other);
  }
  return [...out].sort((a, b) => a - b);
}

export function findEdgeBetween(g: Graph, v0: VertexId, v1: VertexId): Edge | null {
  const v = g.vertices.get(v0);
  if (!v) return null;
  for (const id of v.edges) {
    const e = g.edges.get(id);
    if (!e) continue;
    if ((e.v0 === v0 && e.v1 === v1) || (e.v0 === v1 && e.v1 === v0)) return e;
  }
  return null;
}

/**
 * Classification drives rendering weight and normal propagation. Boundary and
 * non-manifold edges are drawn heavier so users can see holes and stray
 * geometry without running a diagnostic; normal propagation crosses only
 * `manifold` edges, since across a non-manifold edge there is no right
 * answer. §2.4
 */
export function classifyEdge(e: Edge): EdgeClassification {
  if (e.uses.length >= 3) return 'non-manifold';
  if (e.uses.length === 2) return 'manifold';
  return 'boundary';
}

export const edgeVector = (g: Graph, e: Edge): Vec3 => {
  const a = getVertex(g, e.v0).position;
  const b = getVertex(g, e.v1).position;
  return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
};

export const edgePoints = (g: Graph, e: Edge): [Vec3, Vec3] => [
  getVertex(g, e.v0).position,
  getVertex(g, e.v1).position,
];

// ---------------------------------------------------------------------------
// Loops and faces
// ---------------------------------------------------------------------------

/**
 * Builds a loop from an ordered edge list and registers an EdgeUse on each
 * edge. Direction is derived from the traversal, so a loop and the loop on
 * the other side of the same edges get opposite `reversed` flags — which is
 * exactly what a face and the island inside it need. §2.4
 */
export function addLoop(
  g: Graph,
  face: FaceId,
  edges: readonly EdgeId[],
  kind: 'outer' | 'inner',
  startVertex: VertexId,
): Loop {
  const id = g.nextId.loop++ as LoopId;
  const uses: EdgeUse[] = [];

  let current = startVertex;
  for (const eid of edges) {
    const e = getEdge(g, eid);
    const reversed = e.v0 !== current;
    if (reversed && e.v1 !== current) {
      throw new Error(
        `Loop ${id} is not connected: edge ${eid} (${e.v0}->${e.v1}) does not ` +
          `continue from vertex ${current}`,
      );
    }
    const use: EdgeUse = { edge: eid, loop: id, reversed };
    uses.push(use);
    e.uses.push(use);
    current = reversed ? e.v0 : e.v1;
  }

  if (current !== startVertex) {
    throw new Error(`Loop ${id} does not close: ended at ${current}, expected ${startVertex}`);
  }

  const loop: Loop = { id, face, uses, kind, signedArea: 0 };
  g.loops.set(id, loop);
  return loop;
}

export function removeLoop(g: Graph, id: LoopId): boolean {
  const loop = g.loops.get(id);
  if (!loop) return false;
  for (const use of loop.uses) {
    const e = g.edges.get(use.edge);
    if (!e) continue;
    e.uses = e.uses.filter((u) => u.loop !== id);
  }
  g.loops.delete(id);
  return true;
}

export function addFace(g: Graph, face: Omit<Face, 'id'>): Face {
  const id = g.nextId.face++ as FaceId;
  const f: Face = { ...face, id };
  g.faces.set(id, f);
  return f;
}

export const getFace = (g: Graph, id: FaceId): Face => {
  const f = g.faces.get(id);
  if (!f) throw new Error(`Face ${id} not found`);
  return f;
};

/** Removes a face and its loops. Edges survive — that is R5's whole point. */
export function removeFace(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  removeLoop(g, f.outerLoop);
  for (const l of f.innerLoops) removeLoop(g, l);
  g.faces.delete(id);
  return true;
}

export function facesUsingEdge(g: Graph, id: EdgeId): FaceId[] {
  const e = g.edges.get(id);
  if (!e) return [];
  const out = new Set<FaceId>();
  for (const use of e.uses) {
    const loop = g.loops.get(use.loop);
    if (loop) out.add(loop.face);
  }
  return [...out].sort((a, b) => a - b);
}

export function loopEdgeIds(g: Graph, id: LoopId): EdgeId[] {
  return g.loops.get(id)?.uses.map((u) => u.edge) ?? [];
}

/** Ordered vertices around a loop, following its direction. */
export function loopVertexIds(g: Graph, id: LoopId): VertexId[] {
  const loop = g.loops.get(id);
  if (!loop) return [];
  return loop.uses.map((u) => {
    const e = getEdge(g, u.edge);
    return u.reversed ? e.v1 : e.v0;
  });
}

export const loopPoints = (g: Graph, id: LoopId): Vec3[] =>
  loopVertexIds(g, id).map((v) => getVertex(g, v).position);

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

/**
 * Development-time invariant check. Cheap enough to run in tests after every
 * operation, which is how a topology bug gets caught in the phase that
 * introduced it rather than three phases later.
 */
export function checkIntegrity(g: Graph): string[] {
  const problems: string[] = [];

  for (const [id, v] of g.vertices) {
    for (const eid of v.edges) {
      const e = g.edges.get(eid);
      if (!e) problems.push(`Vertex ${id} references missing edge ${eid}`);
      else if (e.v0 !== id && e.v1 !== id) problems.push(`Vertex ${id} lists edge ${eid}, which does not touch it`);
    }
    if (new Set(v.edges).size !== v.edges.length) problems.push(`Vertex ${id} lists a duplicate edge`);
  }

  for (const [id, e] of g.edges) {
    if (e.v0 === e.v1) problems.push(`Edge ${id} is degenerate`);
    for (const vid of [e.v0, e.v1]) {
      const v = g.vertices.get(vid);
      if (!v) problems.push(`Edge ${id} references missing vertex ${vid}`);
      else if (!v.edges.includes(id)) problems.push(`Edge ${id} not listed on vertex ${vid}`);
    }
    for (const use of e.uses) {
      if (use.edge !== id) problems.push(`Edge ${id} holds a use belonging to edge ${use.edge}`);
      if (!g.loops.has(use.loop)) problems.push(`Edge ${id} references missing loop ${use.loop}`);
    }
  }

  for (const [id, loop] of g.loops) {
    if (!g.faces.has(loop.face)) problems.push(`Loop ${id} references missing face ${loop.face}`);
    for (const use of loop.uses) {
      const e = g.edges.get(use.edge);
      if (!e) problems.push(`Loop ${id} references missing edge ${use.edge}`);
      else if (!e.uses.some((u) => u.loop === id && u.edge === use.edge)) {
        problems.push(`Loop ${id} use of edge ${use.edge} is not registered on the edge`);
      }
    }
  }

  for (const [id, f] of g.faces) {
    if (!g.loops.has(f.outerLoop)) problems.push(`Face ${id} references missing outer loop`);
    for (const l of f.innerLoops) if (!g.loops.has(l)) problems.push(`Face ${id} references missing inner loop ${l}`);
  }

  return problems;
}
