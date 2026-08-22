/**
 * PolyForm geometry kernel — derivation pipeline. §6.2 Phases 2-5, §6.3, §6.4.
 *
 * There is no "split" operation and no "create" operation. There is only
 * DERIVE: insert topology, then re-derive every face on each affected
 * component from scratch. Splitting, creation, hole formation, hole bisection
 * and hole opening are all this one code path viewed from different starting
 * states. §6.1
 *
 * Preserve-or-create (§7.4) is what keeps a deleted face deleted:
 *
 *   A derived cycle yields a face if EITHER a face existed on that exact
 *   cycle before the transaction, OR at least one of its edges was touched
 *   during it.
 *
 * Simplify that to "always create" and every basic test still passes —
 * rectangles, splits and holes all behave identically. What breaks is
 * deleting a face: the void refills the moment the user draws anywhere on the
 * same panel. §10.4
 */

import type {
  Diagnostic, EdgeId, Face, FaceId, FaceSnapshot, Graph, Loop, Plane,
  PlaneBasis, Tolerances, UVBasis, Vec2, Vec3, VertexId,
} from './types';
import {
  addFace, addLoop, defaultAttributes, edgePoints, getEdge, getFace, getVertex,
  loopEdgeIds, loopPoints, removeFace,
} from './topology';
import {
  add, bestFitPlane, cross, dot, normalize, planeBasis, projectToBasis,
  scale, sub, tryNormalize, distance,
} from './math';
import { interiorPointWithHoles, pointInPolygonWithHoles, signedArea } from './polygon';
import { findCycles, edgeSetHash, type Ring } from './cycles';
import { planeKey } from './planeIndex';

export interface DeriveOptions {
  readonly tolerances: Tolerances;
  /**
   * Fixed camera for orientation. Tests inject one so results are
   * reproducible; the deterministic rules run first regardless. §6.4
   */
  readonly cameraDirection?: Vec3;
}

export interface DeriveResult {
  readonly created: FaceId[];
  readonly preserved: FaceId[];
  readonly deleted: FaceId[];
  readonly diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Snapshots — §6.3
// ---------------------------------------------------------------------------

export function snapshotFace(g: Graph, id: FaceId): FaceSnapshot {
  const f = getFace(g, id);
  const edges = new Set<EdgeId>(loopEdgeIds(g, f.outerLoop));
  const polygon = loopPoints(g, f.outerLoop).map((p) => projectToBasis(p, f.basis));
  return {
    id,
    hash: f.hash,
    edgeSet: edges,
    attributes: { ...f.attributes, custom: { ...f.attributes.custom } },
    plane: f.plane,
    polygon2D: polygon,
    frontNormal: f.plane.normal,
  };
}

const sameEdgeSet = (a: ReadonlySet<EdgeId>, b: ReadonlySet<EdgeId>): boolean => {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

// ---------------------------------------------------------------------------
// UV — §6.3
// ---------------------------------------------------------------------------

/**
 * A world-space UV basis: an origin plus two in-plane vectors in model
 * coordinates. Never per-vertex UVs, and never normalised to the face's
 * bounding box — bounds-normalisation is the standard mistake, and its
 * symptom is every split visibly rescaling the texture on both halves.
 */
export function makeUVBasis(plane: Plane): UVBasis {
  const n = normalize(plane.normal, 'makeUVBasis');
  // Canonical sign, so a face and its reverse share a UV frame.
  const eps = 1e-12;
  const lead = Math.abs(n.x) > eps ? n.x : Math.abs(n.y) > eps ? n.y : n.z;
  const canonical = lead >= 0 ? n : { x: -n.x, y: -n.y, z: -n.z };

  // Anchor at the point on the plane closest to the WORLD origin, never at
  // the region centroid. A centroid moves whenever the region's edge set
  // changes, so anchoring there makes every split shift the texture — the
  // bounds-normalisation failure this rule exists to prevent, reached by a
  // different route.
  const d = dot(canonical, plane.point);
  const origin = scale(canonical, d);

  const basis = planeBasis({ point: origin, normal: canonical });
  return { origin, u: basis.u, v: basis.v };
}

export const sampleUV = (p: Vec3, uv: UVBasis): Vec2 => {
  const d = sub(p, uv.origin);
  return { x: dot(d, uv.u), y: dot(d, uv.v) };
};

// ---------------------------------------------------------------------------
// Orientation — §6.4
// ---------------------------------------------------------------------------

/**
 * Deterministic rules first, camera last.
 *
 * A camera-dependent rule means the same drawing operation yields a different
 * stored orientation depending on where the user happened to be looking:
 * fine for a person, unacceptable for a test suite or a file round-trip.
 */
export function orientNormal(
  plane: Plane,
  opts: {
    neighbourNormal?: Vec3 | null;
    snapshotNormal?: Vec3 | null;
    cameraDirection?: Vec3 | null;
    tolerance: number;
  },
): Vec3 {
  const n = normalize(plane.normal, 'orientNormal');
  const flip = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });

  // 1. Neighbour consistency.
  if (opts.neighbourNormal) {
    return dot(n, opts.neighbourNormal) >= 0 ? n : flip(n);
  }
  // 2. Snapshot consistency — stops a split flipping half a wall.
  if (opts.snapshotNormal) {
    return dot(n, opts.snapshotNormal) >= 0 ? n : flip(n);
  }
  // 3. Horizontal planes face up. A rectangle on the ground has an
  //    unambiguous right answer and users notice when it comes out face-down.
  if (Math.abs(Math.abs(n.z) - 1) <= Math.max(opts.tolerance, 1e-6)) {
    return n.z >= 0 ? n : flip(n);
  }
  // 4. Camera-facing.
  if (opts.cameraDirection) {
    return dot(n, opts.cameraDirection) <= 0 ? n : flip(n);
  }
  // 5. Canonical sign — headless determinism.
  const eps = 1e-12;
  const first = Math.abs(n.x) > eps ? n.x : Math.abs(n.y) > eps ? n.y : n.z;
  return first >= 0 ? n : flip(n);
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

interface RingPlan {
  readonly ring: Ring;
  readonly hash: string;
  readonly edgeSet: Set<EdgeId>;
  readonly children: number[];
  match: FaceSnapshot | null;
  keep: boolean;
  /** Face id already carrying this ring, if one survived untouched. */
  realised: FaceId | null;
}

/**
 * Re-derives every face on one coplanar region.
 *
 * `region` is the set of edges to consider — normally a connected component
 * plus any coplanar components nested inside it. Nesting across components
 * matters: an island drawn inside a face shares no edge with it, so a strictly
 * edge-connected region would derive the outer face with no hole.
 */
export function deriveRegion(
  g: Graph,
  region: ReadonlySet<EdgeId>,
  touched: ReadonlySet<EdgeId>,
  opts: DeriveOptions,
): DeriveResult {
  const diagnostics: Diagnostic[] = [];
  const created: FaceId[] = [];
  const preserved: FaceId[] = [];
  const deleted: FaceId[] = [];

  if (region.size === 0) return { created, preserved, deleted, diagnostics };

  // Plane for the region, fitted from its vertices.
  const points: Vec3[] = [];
  const seen = new Set<VertexId>();
  for (const eid of [...region].sort((a, b) => a - b)) {
    const e = g.edges.get(eid);
    if (!e) continue;
    for (const vid of [e.v0, e.v1]) {
      if (seen.has(vid)) continue;
      seen.add(vid);
      points.push(getVertex(g, vid).position);
    }
  }
  const plane = bestFitPlane(points);
  if (!plane) return { created, preserved, deleted, diagnostics };
  const basis = planeBasis(plane);

  // ---- Find cycles FIRST, before touching any face ----
  // Deleting up front and re-creating would hand every surviving face a new
  // FaceId. Preserve means preserve: same object, same id. §6.3
  const cycleResult = findCycles(g, region, basis, opts.tolerances);
  diagnostics.push(...cycleResult.diagnostics);

  const plans: RingPlan[] = cycleResult.rings.map((ring) => {
    const edgeSet = new Set(ring.edges);
    return {
      ring, edgeSet, hash: edgeSetHash(edgeSet),
      children: [], match: null, keep: false, realised: null,
    };
  });
  for (let i = 0; i < plans.length; i++) {
    const parent = cycleResult.parentOf[i] ?? -1;
    if (parent >= 0) plans[parent]!.children.push(i);
  }
  // A ring's identity includes its holes: an outer face whose island has just
  // appeared has the same outer hash but is no longer the same face.
  const signatureOf = (i: number): string => {
    const p = plans[i]!;
    const kids = p.children.map((c) => plans[c]!.hash).sort();
    return `${p.hash}|${kids.join('&')}`;
  };

  // ---- Existing faces: preserve exact matches, delete the rest ----
  const affectedFaces = new Set<FaceId>();
  for (const eid of region) {
    const e = g.edges.get(eid);
    if (!e) continue;
    for (const use of e.uses) {
      const loop = g.loops.get(use.loop);
      if (loop) affectedFaces.add(loop.face);
    }
  }

  const snapshots: FaceSnapshot[] = [];
  const survivors = new Set<FaceId>();
  for (const fid of [...affectedFaces].sort((a, b) => a - b)) {
    const face = g.faces.get(fid);
    if (!face) continue;
    const snap = snapshotFace(g, fid);
    snapshots.push(snap);

    const innerHashes = face.innerLoops
      .map((l) => edgeSetHash(loopEdgeIds(g, l)))
      .sort();
    const faceSignature = `${face.hash}|${innerHashes.join('&')}`;

    const idx = plans.findIndex(
      (p, i) => signatureOf(i) === faceSignature && sameEdgeSet(p.edgeSet, snap.edgeSet),
    );
    if (idx >= 0 && plans[idx]!.realised === null) {
      plans[idx]!.realised = fid;
      plans[idx]!.match = snap;
      plans[idx]!.keep = true;
      survivors.add(fid);
      preserved.push(fid);
    }
  }

  for (const snap of snapshots) {
    if (survivors.has(snap.id)) continue;
    if (!g.faces.has(snap.id)) continue;
    removeFace(g, snap.id);
    deleted.push(snap.id);
  }

  const byHash = new Map<string, FaceSnapshot[]>();
  for (const s of snapshots) {
    if (survivors.has(s.id)) continue;
    const list = byHash.get(s.hash);
    if (list) list.push(s);
    else byHash.set(s.hash, [s]);
  }

  // ---- Preserve-or-create for rings with no surviving face ----
  for (const plan of plans) {
    if (plan.realised !== null) continue;
    const candidates = byHash.get(plan.hash) ?? [];
    plan.match = candidates.find((s) => sameEdgeSet(s.edgeSet, plan.edgeSet)) ?? null;
    const wasTouched = [...plan.edgeSet].some((e) => touched.has(e));
    plan.keep = plan.match !== null || wasTouched;
  }

  // ---- Build faces ----
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!;
    if (plan.realised !== null) continue; // already carried forward, id intact
    if (!plan.keep) continue; // an untouched cycle that carried no face: the void

    const ringPlane: Plane = { point: plane.point, normal: plane.normal };
    const oriented = orientNormal(ringPlane, {
      snapshotNormal: plan.match?.frontNormal ?? null,
      cameraDirection: opts.cameraDirection ?? null,
      tolerance: opts.tolerances.COPLANARITY_TOLERANCE,
    });
    const facePlane: Plane = { point: plane.point, normal: oriented };
    const faceBasis = planeBasis(facePlane);

    const attributes = plan.match
      ? { ...plan.match.attributes, custom: { ...plan.match.attributes.custom } }
      : defaultAttributes();
    if (!attributes.uv) attributes.uv = makeUVBasis(plane);

    const face = addFace(g, {
      outerLoop: 0 as unknown as Loop['id'],
      innerLoops: [],
      plane: facePlane,
      basis: faceBasis,
      hash: plan.hash as Face['hash'],
      attributes,
    });

    // Cycles were found in the DERIVATION basis; the face's normal is
    // oriented independently by §6.4. When the two disagree, the stored loop
    // would read clockwise from the face's own front, so reverse it. Winding
    // is relative and a tessellator reads it that way — get this wrong and
    // holes fill in. §6.4
    const flipped = dot(oriented, basis.normal) < 0;
    const ringArgs = (r: Ring, reverse: boolean) => ({
      edges: reverse ? [...r.edges].reverse() : r.edges,
      start: r.vertices[0]!,
    });

    const outerArgs = ringArgs(plan.ring, flipped);
    const outer = addLoop(g, face.id, outerArgs.edges, 'outer', outerArgs.start);
    outer.signedArea = Math.abs(plan.ring.signedArea);
    face.outerLoop = outer.id;

    // Children become inner loops, wound counter to the outer loop. The same
    // edges, used twice, with opposite EdgeUse directions. §2.4, §6.4
    for (const childIdx of plan.children) {
      const child = plans[childIdx]!.ring;
      const innerArgs = ringArgs(child, !flipped);
      const inner = addLoop(g, face.id, innerArgs.edges, 'inner', innerArgs.start);
      inner.signedArea = -Math.abs(child.signedArea);
      face.innerLoops.push(inner.id);
    }

    // Reattach attributes for a genuinely new face by containment. §6.3
    if (!plan.match && snapshots.length > 0) {
      const holes = plan.children.map((c) => plans[c]!.ring.polygon);
      const probe = interiorPointWithHoles(plan.ring.polygon, holes);
      if (probe) {
        const world = add(basis.origin, add(scale(basis.u, probe.x), scale(basis.v, probe.y)));
        for (const s of snapshots) {
          if (distance(s.plane.point, plane.point) > 1e6) continue;
          const local = projectToBasis(world, basis);
          if (pointInPolygonWithHoles(local, s.polygon2D, [])) {
            face.attributes = { ...s.attributes, custom: { ...s.attributes.custom } };
            break;
          }
        }
      }
    }

    created.push(face.id);
  }

  // Verify the winding invariant. Cheap, and it catches cycle-finder
  // regressions immediately — otherwise invisible until a user draws a hole.
  for (const fid of [...created, ...preserved]) {
    const f = g.faces.get(fid);
    if (!f) continue;
    const outerPts = loopPoints(g, f.outerLoop).map((p) => projectToBasis(p, basis));
    if (signedArea(outerPts) <= 0) {
      diagnostics.push({
        kind: 'non-manifold-vertex',
        message: `Face ${fid} outer loop has non-positive signed area — winding invariant violated.`,
      });
    }
  }

  return { created, preserved, deleted, diagnostics };
}

// ---------------------------------------------------------------------------
// Region assembly
// ---------------------------------------------------------------------------

/**
 * Groups a graph's edges into coplanar regions, merging components that are
 * spatially nested so that an island lands in the same region as the face
 * containing it.
 *
 * Worth flagging: §6.5 defines a region as an edge-CONNECTED component, but a
 * face and the island inside it share no edge. Bounding derivation strictly to
 * edge-connected components would derive the outer face with no hole. Nesting
 * is therefore resolved per plane bucket, across components.
 */
export function regionsFor(
  g: Graph,
  edges: ReadonlySet<EdgeId>,
  tolerances: Tolerances,
): Map<string, Set<EdgeId>> {
  const byPlane = new Map<string, Set<EdgeId>>();

  for (const eid of [...edges].sort((a, b) => a - b)) {
    const e = g.edges.get(eid);
    if (!e) continue;
    // An edge alone does not determine a plane; use its neighbourhood.
    const pts: Vec3[] = edgePoints(g, e);
    for (const vid of [e.v0, e.v1]) {
      for (const other of getVertex(g, vid).edges) {
        const oe = g.edges.get(other);
        if (!oe || oe.id === eid) continue;
        pts.push(...edgePoints(g, oe));
      }
    }
    const plane = bestFitPlane(pts);
    const key = plane ? planeKey(plane, tolerances.COPLANARITY_TOLERANCE) : `edge:${eid}`;
    let set = byPlane.get(key);
    if (!set) {
      set = new Set();
      byPlane.set(key, set);
    }
    set.add(eid);
  }
  return byPlane;
}

/** Convenience: derive every coplanar region touched by an edit. */
export function derive(
  g: Graph,
  touched: ReadonlySet<EdgeId>,
  opts: DeriveOptions,
): DeriveResult {
  const all = new Set<EdgeId>(g.edges.keys());
  const regions = regionsFor(g, all, opts.tolerances);
  const out: DeriveResult = { created: [], preserved: [], deleted: [], diagnostics: [] };

  for (const [, region] of [...regions].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const r = deriveRegion(g, region, touched, opts);
    (out.created as FaceId[]).push(...r.created);
    (out.preserved as FaceId[]).push(...r.preserved);
    (out.deleted as FaceId[]).push(...r.deleted);
    (out.diagnostics as Diagnostic[]).push(...r.diagnostics);
  }
  return out;
}

export { edgeSetHash };
