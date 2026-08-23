/**
 * PolyForm geometry kernel — plane and coplanar-component index.
 *
 * Derivation is bounded to connected COMPONENTS, never whole planes. A floor
 * plan may carry several hundred disconnected coplanar panels; rebuilding all
 * of them because the user drew one line is a guaranteed frame drop, and it
 * gets worse the more work the user has put in. §6.5
 *
 * Two layers:
 *   1. A quantised plane hash, so two panels coplanar within tolerance land in
 *      the same bucket. Sign-canonicalised, so a plane and its reverse agree.
 *   2. Union-find over the edges within each bucket, giving components in
 *      near-constant time.
 */

import type { EdgeId, Plane, PlaneKey, Vec3 } from './types';
import { dot, normalize, tryNormalize } from './math';

/**
 * Quantise a plane to a bucket key.
 *
 * Canonicalisation matters as much as quantisation: a plane and its reverse
 * describe the same surface, so the normal's sign is normalised by the first
 * significant component. Without that, a face and its neighbour drawn in the
 * opposite direction would never be recognised as coplanar and would never
 * merge. §6.5
 */
/**
 * Angular quantisation step for plane bucketing, as a unit-normal component.
 * ~0.02 corresponds to roughly one degree. Generous on purpose — see below.
 */
export const PLANE_ANGULAR_STEP = 0.02;

export function planeKey(plane: Plane, tolerance: number): PlaneKey {
  let n = normalize(plane.normal, 'planeKey normal');

  // Canonical sign, chosen from the LARGEST component.
  //
  // Picking the first component above some epsilon is unstable: on a normal
  // that is nearly axis-aligned, that component is a tiny number whose sign
  // flips with rounding, so two fits of the same surface canonicalise in
  // opposite directions and land in different buckets. A loop tilted by a
  // fraction of a degree then fragments and derives no face.
  //
  // The dominant component is far from zero, so its sign is stable.
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const dominant = ax >= ay && ax >= az ? n.x : ay >= az ? n.y : n.z;
  const sign = dominant < 0 ? -1 : 1;
  if (sign < 0) n = { x: -n.x, y: -n.y, z: -n.z };

  const offset = dot(n, plane.point) * (sign < 0 ? -1 : 1);

  // The normal needs an ANGULAR step; the offset needs a spatial one. Using
  // the distance tolerance for both is wrong and was a real bug: normals
  // differing by more than 0.001 in any component landed in different
  // buckets, so a loop tilted by a fraction of a degree — well inside
  // COPLANARITY_TOLERANCE — fragmented across several "planes" and derived no
  // face at all.
  //
  // Bucketing is a grouping heuristic, not a correctness test. It should be
  // GENEROUS: derivation verifies each ring's coplanarity exactly (§6.2), so
  // a bucket that is too coarse costs a little wasted work, while one that is
  // too fine silently loses faces. PLANE_ANGULAR_STEP of 0.02 groups normals
  // within roughly one degree.
  const angularStep = PLANE_ANGULAR_STEP;
  const q = (v: number, step: number) => {
    const r = Math.round(v / step);
    // -0 and 0 must produce the same key.
    return r === 0 ? 0 : r;
  };

  const nx = q(n.x, angularStep);
  const ny = q(n.y, angularStep);
  const nz = q(n.z, angularStep);
  const no = q(offset, Math.max(tolerance * 10, 1e-9));

  return `${nx}:${ny}:${nz}:${no}` as PlaneKey;
}

/** True when two planes are the same surface within tolerance. */
export function planesMatch(a: Plane, b: Plane, angleTol: number, distTol: number): boolean {
  const na = tryNormalize(a.normal);
  const nb = tryNormalize(b.normal);
  if (!na || !nb) return false;
  const d = dot(na, nb);
  if (Math.abs(Math.abs(d) - 1) > angleTol) return false;
  // Same orientation for the offset comparison.
  const nbAligned: Vec3 = d < 0 ? { x: -nb.x, y: -nb.y, z: -nb.z } : nb;
  return Math.abs(dot(na, a.point) - dot(nbAligned, b.point)) <= distTol;
}

// ---------------------------------------------------------------------------
// Union-find
// ---------------------------------------------------------------------------

class DisjointSet {
  private readonly parent = new Map<EdgeId, EdgeId>();
  private readonly rank = new Map<EdgeId, number>();

  add(id: EdgeId): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: EdgeId): EdgeId {
    let root = id;
    while (this.parent.get(root) !== root) {
      const p = this.parent.get(root);
      if (p === undefined) {
        this.add(root);
        return root;
      }
      root = p;
    }
    // Path compression.
    let cur = id;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: EdgeId, b: EdgeId): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  members(): EdgeId[] {
    return [...this.parent.keys()];
  }

  delete(id: EdgeId): void {
    this.parent.delete(id);
    this.rank.delete(id);
  }

  has(id: EdgeId): boolean {
    return this.parent.has(id);
  }
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export interface PlaneBucket {
  readonly key: PlaneKey;
  readonly plane: Plane;
  readonly edges: Set<EdgeId>;
  /** Set when a deletion may have disconnected a component. §6.5 */
  dirty: boolean;
}

/**
 * Adjacency is supplied by the caller rather than stored here: the topology
 * store already knows which edges share a vertex, and duplicating that would
 * create two sources of truth that can disagree.
 */
export type AdjacencyFn = (edge: EdgeId) => readonly EdgeId[];

export class PlaneComponentIndex {
  private readonly buckets = new Map<PlaneKey, PlaneBucket>();
  private readonly sets = new Map<PlaneKey, DisjointSet>();
  private readonly edgePlanes = new Map<EdgeId, Set<PlaneKey>>();

  constructor(private readonly tolerance: number) {}

  /** An edge may lie on several planes; each is registered separately. */
  addEdge(edge: EdgeId, plane: Plane, adjacency: AdjacencyFn): PlaneKey {
    const key = planeKey(plane, this.tolerance);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { key, plane, edges: new Set(), dirty: false };
      this.buckets.set(key, bucket);
      this.sets.set(key, new DisjointSet());
    }
    bucket.edges.add(edge);

    let planes = this.edgePlanes.get(edge);
    if (!planes) {
      planes = new Set();
      this.edgePlanes.set(edge, planes);
    }
    planes.add(key);

    const ds = this.sets.get(key)!;
    ds.add(edge);
    // Union with neighbours already in this bucket. This is what merges two
    // components when the user draws an edge bridging them.
    for (const neighbour of adjacency(edge)) {
      if (bucket.edges.has(neighbour)) ds.union(edge, neighbour);
    }
    return key;
  }

  /**
   * Union-find cannot express a split, so removal marks the bucket dirty and
   * connectivity is recomputed lazily on next access rather than eagerly on
   * every delete. §6.5
   */
  removeEdge(edge: EdgeId): void {
    const planes = this.edgePlanes.get(edge);
    if (!planes) return;
    for (const key of planes) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.edges.delete(edge);
      bucket.dirty = true;
      this.sets.get(key)?.delete(edge);
      if (bucket.edges.size === 0) {
        this.buckets.delete(key);
        this.sets.delete(key);
      }
    }
    this.edgePlanes.delete(edge);
  }

  private rebuild(key: PlaneKey, adjacency: AdjacencyFn): void {
    const bucket = this.buckets.get(key);
    if (!bucket || !bucket.dirty) return;
    const ds = new DisjointSet();
    for (const e of bucket.edges) ds.add(e);
    for (const e of bucket.edges) {
      for (const n of adjacency(e)) if (bucket.edges.has(n)) ds.union(e, n);
    }
    this.sets.set(key, ds);
    bucket.dirty = false;
  }

  /** The connected component containing this edge on this plane. */
  componentOf(edge: EdgeId, key: PlaneKey, adjacency: AdjacencyFn): Set<EdgeId> {
    this.rebuild(key, adjacency);
    const bucket = this.buckets.get(key);
    const ds = this.sets.get(key);
    if (!bucket || !ds || !ds.has(edge)) return new Set();
    const root = ds.find(edge);
    const out = new Set<EdgeId>();
    for (const e of bucket.edges) if (ds.find(e) === root) out.add(e);
    return out;
  }

  /** Every component on a plane. Sorted for determinism. §10.3 */
  componentsOnPlane(key: PlaneKey, adjacency: AdjacencyFn): Set<EdgeId>[] {
    this.rebuild(key, adjacency);
    const bucket = this.buckets.get(key);
    const ds = this.sets.get(key);
    if (!bucket || !ds) return [];
    const byRoot = new Map<EdgeId, Set<EdgeId>>();
    for (const e of [...bucket.edges].sort((a, b) => a - b)) {
      const root = ds.find(e);
      let set = byRoot.get(root);
      if (!set) {
        set = new Set();
        byRoot.set(root, set);
      }
      set.add(e);
    }
    return [...byRoot.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  planesOf(edge: EdgeId): PlaneKey[] {
    return [...(this.edgePlanes.get(edge) ?? [])].sort();
  }

  bucket(key: PlaneKey): PlaneBucket | undefined {
    return this.buckets.get(key);
  }

  get planeCount(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
    this.sets.clear();
    this.edgePlanes.clear();
  }
}
