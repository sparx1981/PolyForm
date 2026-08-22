/**
 * PolyForm geometry kernel — planar cycle finding. §6.2 Phases 3a and 3b.
 *
 * THE critical file. A subtly wrong traversal produces correct faces on
 * rectangles and fails on the first L-shape or figure-eight, and the failure
 * is silent. Everything downstream — splitting, holes, healing — is this
 * algorithm viewed from a different starting state.
 *
 * Implemented directly rather than via a polygon-clipping library. Clipper,
 * Turf and friends operate on coordinate polygons and return NEW COORDINATES,
 * not your edges, and every identity guarantee in this kernel (the edge-set
 * hash, preserve-or-create, UV reattachment, face identity across undo)
 * depends on edge identity surviving derivation. §10.3
 */

import type {
  Diagnostic, EdgeId, Graph, PlaneBasis, Tolerances, Vec2, VertexId,
} from './types';
import { getEdge, getVertex } from './topology';
import { projectToBasis } from './math';
import { signedArea, pointInPolygon } from './polygon';

/** A directed use of an edge. `forward` means v0 -> v1. */
interface HalfEdge {
  readonly edge: EdgeId;
  readonly forward: boolean;
  readonly from: VertexId;
  readonly to: VertexId;
  /** Direction angle at `from`, in the plane basis. */
  readonly angle: number;
}

const keyOf = (edge: EdgeId, forward: boolean): string => `${edge}${forward ? '+' : '-'}`;

export interface Ring {
  /** Edges in traversal order. */
  readonly edges: EdgeId[];
  /** Vertices in traversal order, starting at the same place as `edges`. */
  readonly vertices: VertexId[];
  readonly polygon: Vec2[];
  readonly signedArea: number;
}

export interface CycleResult {
  /** Candidate face boundaries, counter-clockwise, sliver-free. */
  readonly rings: Ring[];
  /**
   * Index into `rings`: the smallest ring directly containing this one, or
   * -1. A directly-contained ring is both a face in its own right and a hole
   * in its parent — the island case. §2.4
   */
  readonly parentOf: number[];
  /** Edges excluded from derivation by pruning. Still live in the model. */
  readonly pruned: Set<EdgeId>;
  readonly diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Phase 3a — pruning
// ---------------------------------------------------------------------------

/**
 * Iterative degree-1 removal.
 *
 * The lollipop: a closed loop with a stick out of it. A traversal that keeps
 * the stick walks out and back within the same cycle, emitting a face whose
 * boundary doubles back on itself with zero width. Iteration matters — a
 * branching antenna needs several passes.
 */
function pruneLeaves(g: Graph, region: ReadonlySet<EdgeId>): Set<EdgeId> {
  const live = new Set(region);
  for (let pass = 0; pass < 10000; pass++) {
    const degree = new Map<VertexId, number>();
    for (const eid of live) {
      const e = getEdge(g, eid);
      degree.set(e.v0, (degree.get(e.v0) ?? 0) + 1);
      degree.set(e.v1, (degree.get(e.v1) ?? 0) + 1);
    }
    const doomed: EdgeId[] = [];
    for (const eid of live) {
      const e = getEdge(g, eid);
      if (degree.get(e.v0) === 1 || degree.get(e.v1) === 1) doomed.push(eid);
    }
    if (doomed.length === 0) break;
    for (const eid of doomed) live.delete(eid);
  }
  return live;
}

/**
 * Bridge removal (Tarjan).
 *
 * Leaf pruning alone is not enough: two closed shapes joined by a single
 * connecting edge have degree >= 2 at both of its ends, so nothing gets
 * pruned, yet the edge lies in no cycle and traversal walks it in both
 * directions to produce the same pinched, zero-area spur.
 */
function pruneBridges(g: Graph, region: ReadonlySet<EdgeId>): Set<EdgeId> {
  const adj = new Map<VertexId, { to: VertexId; edge: EdgeId }[]>();
  const push = (v: VertexId, to: VertexId, edge: EdgeId) => {
    let list = adj.get(v);
    if (!list) {
      list = [];
      adj.set(v, list);
    }
    list.push({ to, edge });
  };
  for (const eid of region) {
    const e = getEdge(g, eid);
    push(e.v0, e.v1, eid);
    push(e.v1, e.v0, eid);
  }

  const disc = new Map<VertexId, number>();
  const low = new Map<VertexId, number>();
  const bridges = new Set<EdgeId>();
  let timer = 0;

  // Iterative DFS — a deep model must not blow the call stack.
  const roots = [...adj.keys()].sort((a, b) => a - b);
  for (const root of roots) {
    if (disc.has(root)) continue;
    const stack: { v: VertexId; parentEdge: EdgeId | null; i: number }[] = [
      { v: root, parentEdge: null, i: 0 },
    ];
    disc.set(root, timer);
    low.set(root, timer);
    timer++;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbours = adj.get(frame.v) ?? [];
      if (frame.i < neighbours.length) {
        const { to, edge } = neighbours[frame.i]!;
        frame.i++;
        if (edge === frame.parentEdge) continue;
        if (disc.has(to)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, disc.get(to)!));
        } else {
          disc.set(to, timer);
          low.set(to, timer);
          timer++;
          stack.push({ v: to, parentEdge: edge, i: 0 });
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent && frame.parentEdge !== null) {
          low.set(parent.v, Math.min(low.get(parent.v)!, low.get(frame.v)!));
          if (low.get(frame.v)! > disc.get(parent.v)!) bridges.add(frame.parentEdge);
        }
      }
    }
  }

  const live = new Set(region);
  for (const b of bridges) live.delete(b);
  return live;
}

// ---------------------------------------------------------------------------
// Phase 3b — traversal
// ---------------------------------------------------------------------------

/**
 * Minimal-turn planar traversal.
 *
 * At each vertex the outgoing half-edges are sorted by angle. Arriving along
 * u->v, we take the half-edge immediately CLOCKWISE from the reverse (v->u) —
 * the strictly adjacent one, not merely some edge in the right rotational
 * direction. Taking any other produces plausible output on convex shapes and
 * fails at the first pinch point: a figure-eight traces one self-crossing
 * perimeter instead of two faces.
 *
 * With this rule, interior faces come out counter-clockwise (positive area)
 * and each component's outer boundary comes out clockwise (negative), which is
 * how they are told apart.
 */
export function findCycles(
  g: Graph,
  region: ReadonlySet<EdgeId>,
  basis: PlaneBasis,
  tolerances: Tolerances,
): CycleResult {
  const diagnostics: Diagnostic[] = [];

  const afterLeaves = pruneLeaves(g, region);
  const live = pruneBridges(g, afterLeaves);

  const pruned = new Set<EdgeId>();
  for (const eid of region) if (!live.has(eid)) pruned.add(eid);
  if (pruned.size > 0) {
    diagnostics.push({
      kind: 'stray-edge',
      message: `${pruned.size} edge(s) bound no face and were excluded from derivation.`,
      edges: [...pruned].sort((a, b) => a - b),
    });
  }
  if (live.size === 0) return { rings: [], parentOf: [], pruned, diagnostics };

  // 2D positions, cached per vertex.
  const pos2 = new Map<VertexId, Vec2>();
  const at = (v: VertexId): Vec2 => {
    let p = pos2.get(v);
    if (!p) {
      p = projectToBasis(getVertex(g, v).position, basis);
      pos2.set(v, p);
    }
    return p;
  };

  // Outgoing half-edges per vertex, sorted by angle ascending.
  const outgoing = new Map<VertexId, HalfEdge[]>();
  const addHalf = (h: HalfEdge) => {
    let list = outgoing.get(h.from);
    if (!list) {
      list = [];
      outgoing.set(h.from, list);
    }
    list.push(h);
  };

  for (const eid of [...live].sort((a, b) => a - b)) {
    const e = getEdge(g, eid);
    const p0 = at(e.v0);
    const p1 = at(e.v1);
    addHalf({
      edge: eid, forward: true, from: e.v0, to: e.v1,
      angle: Math.atan2(p1.y - p0.y, p1.x - p0.x),
    });
    addHalf({
      edge: eid, forward: false, from: e.v1, to: e.v0,
      angle: Math.atan2(p0.y - p1.y, p0.x - p1.x),
    });
  }

  for (const list of outgoing.values()) {
    // Ties broken by edge id so ordering is deterministic. §10.3
    list.sort((a, b) => (a.angle - b.angle) || (a.edge - b.edge));
  }

  const indexOfHalf = new Map<string, number>();
  for (const [, list] of outgoing) {
    for (let i = 0; i < list.length; i++) {
      indexOfHalf.set(keyOf(list[i]!.edge, list[i]!.forward), i);
    }
  }

  /** The minimal clockwise turn: predecessor of the reverse half-edge. */
  const next = (h: HalfEdge): HalfEdge | null => {
    const list = outgoing.get(h.to);
    if (!list || list.length === 0) return null;
    const reverseIdx = indexOfHalf.get(keyOf(h.edge, !h.forward));
    if (reverseIdx === undefined) return null;
    const idx = (reverseIdx - 1 + list.length) % list.length;
    return list[idx] ?? null;
  };

  const visited = new Set<string>();
  const rings: Ring[] = [];

  const starts: HalfEdge[] = [];
  for (const list of [...outgoing.entries()].sort((a, b) => a[0] - b[0])) {
    for (const h of list[1]) starts.push(h);
  }

  for (const start of starts) {
    if (visited.has(keyOf(start.edge, start.forward))) continue;

    const edges: EdgeId[] = [];
    const vertices: VertexId[] = [];
    let h: HalfEdge | null = start;
    let guard = 0;
    const maxLen = live.size * 2 + 4;

    while (h && guard++ <= maxLen) {
      const k = keyOf(h.edge, h.forward);
      if (visited.has(k)) break;
      visited.add(k);
      edges.push(h.edge);
      vertices.push(h.from);
      const n: HalfEdge | null = next(h);
      if (!n) break;
      if (keyOf(n.edge, n.forward) === keyOf(start.edge, start.forward)) {
        h = null;
        break;
      }
      h = n;
    }

    if (edges.length < 3) continue;

    const polygon = vertices.map(at);
    const areaSigned = signedArea(polygon);

    // Negative area is the component's outer boundary (the infinite face).
    if (areaSigned <= 0) continue;

    if (Math.abs(areaSigned) < tolerances.MIN_FACE_AREA) {
      // A needle: real vertices, genuinely coplanar, essentially no area.
      // Reject the CYCLE only — its edges stay in the graph and frequently
      // belong to a larger valid cycle as well. §6.2
      diagnostics.push({
        kind: 'sliver-rejected',
        message: `Cycle of ${edges.length} edges rejected: area ${areaSigned.toExponential(2)} below MIN_FACE_AREA.`,
        edges: [...edges].sort((a, b) => a - b),
      });
      continue;
    }

    rings.push({ edges, vertices, polygon, signedArea: areaSigned });
  }

  // Deterministic ring order: largest first, then by lowest edge id.
  rings.sort((a, b) =>
    b.signedArea - a.signedArea ||
    Math.min(...a.edges) - Math.min(...b.edges),
  );

  return { rings, parentOf: nestRings(rings), pruned, diagnostics };
}

/**
 * Containment nesting.
 *
 * A ring directly inside another is BOTH a face in its own right and an inner
 * loop of its parent — drawing a closed shape inside a face gives an island
 * plus a hole, and the two share the same edges with opposite EdgeUse
 * directions. §2.4
 */
export function nestRings(rings: readonly Ring[]): number[] {
  const parentOf = new Array<number>(rings.length).fill(-1);
  for (let i = 0; i < rings.length; i++) {
    const inner = rings[i]!;
    const probe = inner.polygon[0];
    if (!probe) continue;
    let bestParent = -1;
    let bestArea = Infinity;
    for (let j = 0; j < rings.length; j++) {
      if (i === j) continue;
      const outer = rings[j]!;
      if (Math.abs(outer.signedArea) <= Math.abs(inner.signedArea)) continue;
      // Every vertex must be inside, so a ring that merely overlaps does not
      // count as contained.
      if (!inner.polygon.every((p) => pointInPolygon(p, outer.polygon))) continue;
      if (Math.abs(outer.signedArea) < bestArea) {
        bestArea = Math.abs(outer.signedArea);
        bestParent = j;
      }
    }
    parentOf[i] = bestParent;
  }
  return parentOf;
}

/**
 * Order-independent hash of a cycle's edge set. §6.3
 *
 * Sorted-then-hashed rather than XOR: unmixed XOR of raw IDs collides
 * trivially (any two disjoint pairs where a^b === c^d), and sequential edge
 * IDs generate exactly that pattern constantly. Callers must still confirm a
 * hash hit by comparing the actual edge sets before carrying a face forward —
 * a false positive silently transplants another face's material, UV basis and
 * identity onto an unrelated region.
 */
export function edgeSetHash(edges: Iterable<EdgeId>): string {
  const sorted = [...edges].sort((a, b) => a - b);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const id of sorted) {
    h1 = Math.imul(h1 ^ id, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + id + 0x9e3779b9, 0x85ebca6b) >>> 0;
  }
  return `${sorted.length}:${h1.toString(36)}:${h2.toString(36)}`;
}
