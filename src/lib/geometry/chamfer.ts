/**
 * PolyForm — uniform chamfer of a solid.
 *
 * Chamfers every edge of a closed solid by the same amount: each face's own
 * boundary shrinks inward, a new flat quad bridges every original edge
 * (connecting the two now-separate shrunk faces on either side of it), and
 * a new flat triangle caps every original vertex (connecting the three
 * faces that used to meet there).
 *
 * FIRST VERSION OF THIS FILE inserted all the new geometry as raw edges and
 * let the kernel's generic derive() figure out the resulting faces from
 * scratch. That does not work here: derive()'s region-detection builds a
 * candidate plane from EVERY pair of edges meeting at a vertex, which is a
 * sound heuristic for a simple box (every vertex has degree 3, and every
 * such pairing genuinely corresponds to one of the three real faces there).
 * A chamfered corner has degree-4+ vertices where NOT every pairing is a
 * real face — some pairings are just two edges that happen to meet at a
 * point, defining a plane that exists mathematically but was never intended
 * as a face. On a symmetric solid, enough of these coincide to form bogus
 * regions: verified faces with perfectly correct, individually-planar
 * geometry were getting silently merged into unintended flat "slice" faces
 * once handed to generic derivation.
 *
 * This version bypasses that entirely: since exactly which vertices bound
 * which new face is already known by construction, each face is built
 * directly — insert its boundary edges, compute its own plane from its own
 * points (Newell's method), and construct the Face/Loop records explicitly,
 * the same way derive() itself does internally, just without asking it to
 * guess topology it doesn't need to guess.
 *
 * Deliberately scoped to solids where every vertex has exactly degree 3 —
 * three faces meeting at a point. That covers everything this app currently
 * produces: a push/pulled rectangle, triangle, or circle (a box, a
 * triangular prism, a cylinder) all have this property. A vertex where
 * four or more faces meet needs an N-sided corner cap instead of always a
 * triangle, which is a genuinely different, more involved construction —
 * refusing that case cleanly is more honest than silently producing a
 * wrong result.
 *
 * The per-face inset reuses `offsetPolygon2D` from faceOffset.ts — the
 * exact mitred construction, not the averaged-vertex-normal approximation
 * `offsetFaceVertices` uses elsewhere, since a chamfer needs every face's
 * shrink to be geometrically exact at whatever corner angles it actually
 * has, not just the 90-degree case that approximation gets right.
 */

import type {
  EdgeId, Face, FaceId, Graph, Plane, Tolerances, Vec3, VertexId,
} from './types';
import {
  addFace, addLoop, defaultAttributes, getVertex, loopEdgeIds, loopVertexIds,
  removeEdge, removeFace, removeOrphanVertices,
} from './topology';
import { planeBasis, projectToBasis, unprojectFromBasis, distance, dot, normalize } from './math';
import { makeUVBasis, edgeSetHash } from './derive';
import { offsetPolygon2D } from './faceOffset';
import { insertEdge, type InsertContext } from './insert';

export interface ChamferResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly touched: Set<EdgeId>;
}

// ---------------------------------------------------------------------------
// Direct face construction — the piece that replaces generic derive() for
// this operation's own new geometry.
// ---------------------------------------------------------------------------

/** Newell's method: robust for a near-planar polygon, not just a perfect one. */
export function computeNormal(points: readonly Vec3[]): Vec3 | null {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    nx += (p.y - q.y) * (p.z + q.z);
    ny += (p.z - q.z) * (p.x + q.x);
    nz += (p.x - q.x) * (p.y + q.y);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return null;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/** Linear scan is fine here: a handful of points per new face, never a hot path. */
export function findVertexAt(g: Graph, pos: Vec3, tol: number): VertexId | null {
  for (const [id, v] of g.vertices) {
    if (distance(v.position, pos) < tol) return id;
  }
  return null;
}

/**
 * Builds one new planar face directly from an ordered ring of points,
 * oriented so its normal points toward `outwardHint` — a rough direction
 * (e.g. the average of the adjacent original faces' normals) used only to
 * pick the correct winding, not stored anywhere.
 */
export function createDirectFace(
  ctx: InsertContext,
  points: readonly Vec3[],
  outwardHint: Vec3,
  touched: Set<EdgeId>,
  /**
   * Optional hole boundaries to carry over UNCHANGED onto the new face.
   * Chamfer/fillet only ever reshape a face's OUTER boundary (that's
   * where it meets the edges actually being rounded) — a hole cut into
   * the middle of a face doesn't touch those edges at all, so it stays
   * exactly where it was, not shrunk or moved. Each entry is one hole's
   * own closed point loop, in the SAME winding convention the original
   * face's hole loop used (reversed relative to the outer loop, per this
   * kernel's own B-rep convention) — callers are responsible for getting
   * that winding right; this function does not re-derive it.
   */
  holes?: readonly (readonly Vec3[])[],
): FaceId | null {
  const g = ctx.graph;
  let ordered = points;
  let normal = computeNormal(ordered);
  if (!normal) return null;

  if (dot(normal, outwardHint) < 0) {
    ordered = [...points].reverse();
    normal = computeNormal(ordered)!;
  }

  const n = ordered.length;
  const edgeIds: EdgeId[] = [];
  for (let i = 0; i < n; i++) {
    const a = ordered[i]!;
    const b = ordered[(i + 1) % n]!;
    if (distance(a, b) < ctx.tolerances.MIN_EDGE_LENGTH) return null;
    const result = insertEdge(ctx, a, b);
    for (const t of result.touched) touched.add(t);
    if (result.edges.length === 0) return null;
    edgeIds.push(...result.edges);
  }

  const startVertex = findVertexAt(g, ordered[0]!, ctx.tolerances.VERTEX_MERGE_TOLERANCE);
  if (startVertex === null) return null;

  const plane: Plane = { point: ordered[0]!, normal };
  const basis = planeBasis(plane);
  const attributes = defaultAttributes();
  attributes.uv = makeUVBasis(plane);
  // See derive()'s own doc comment on the `chamferLocked` exclusion: this
  // is what keeps an unrelated later derive() call from re-examining (and
  // potentially mis-bucketing) this face's edges at all, as long as
  // nothing is specifically trying to touch them.
  attributes.custom = { chamferLocked: true };

  // A proper hash, not a placeholder: derive() identifies an existing face
  // by hashing its cycle's edge set (§6.3), and any LATER derive() call —
  // the caller's own follow-up, or an unrelated edit somewhere else in the
  // model — walks the whole graph again. Without a hash that matches what
  // it would independently compute for this exact cycle, it finds no
  // match, concludes "unmatched," and builds a duplicate face right on top
  // of this one — the same class of bug fixed in push/pull and offset
  // earlier this session, here from a different cause (a placeholder
  // instead of a stale cache).
  //
  // NOTE this hash covers the OUTER loop's edges only, same as before
  // holes were supported — a hole's own edges are not folded in. This is
  // a narrower version of the SAME accepted limitation chamferLocked
  // already documents (protection holds as long as nothing is
  // specifically touching these edges); a hole's edges being touched
  // later would fall under that identical, already-documented boundary,
  // not a new one.
  const hash = edgeSetHash(edgeIds) as unknown as Face['hash'];

  // Same placeholder-then-patch sequencing derive() itself uses: a Face
  // needs a Loop id before the Loop exists, and a Loop needs a Face id
  // before it's built, so one of the two is created with a dummy value and
  // corrected once the real id exists.
  const face = addFace(g, {
    outerLoop: 0 as unknown as Face['outerLoop'],
    innerLoops: [],
    plane,
    basis,
    hash,
    attributes,
  });
  const loop = addLoop(g, face.id, edgeIds, 'outer', startVertex);
  face.outerLoop = loop.id;

  if (holes) {
    for (const holePoints of holes) {
      if (holePoints.length < 3) return null;
      const holeEdgeIds: EdgeId[] = [];
      const hn = holePoints.length;
      for (let i = 0; i < hn; i++) {
        const a = holePoints[i]!;
        const b = holePoints[(i + 1) % hn]!;
        if (distance(a, b) < ctx.tolerances.MIN_EDGE_LENGTH) return null;
        const result = insertEdge(ctx, a, b);
        for (const t of result.touched) touched.add(t);
        if (result.edges.length === 0) return null;
        holeEdgeIds.push(...result.edges);
      }
      const holeStartVertex = findVertexAt(g, holePoints[0]!, ctx.tolerances.VERTEX_MERGE_TOLERANCE);
      if (holeStartVertex === null) return null;
      const holeLoop = addLoop(g, face.id, holeEdgeIds, 'inner', holeStartVertex);
      face.innerLoops.push(holeLoop.id);
    }
  }

  return face.id;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateSolid(
  g: Graph,
  faceIds: readonly FaceId[],
): { ok: true; vertexFaces: Map<VertexId, FaceId[]> } | { ok: false; reason: string } {
  if (faceIds.length < 4) return { ok: false, reason: 'not enough faces to form a closed solid' };
  const faceSet = new Set(faceIds);
  const vertexFaces = new Map<VertexId, Set<FaceId>>();

  for (const fid of faceIds) {
    const f = g.faces.get(fid);
    if (!f) return { ok: false, reason: `face ${fid} not found` };
    // A face with a hole is fine: the hole is interior to the face and
    // doesn't touch any of the edges actually being chamfered, so it
    // carries over unchanged onto the shrunk boundary face — see
    // createDirectFace's own doc comment on its `holes` parameter, and
    // the step that builds each face's shrunk boundary below.

    for (const eid of loopEdgeIds(g, f.outerLoop)) {
      const e = g.edges.get(eid);
      if (!e) continue;
      const usingFaces = new Set<FaceId>();
      for (const use of e.uses) {
        const loop = g.loops.get(use.loop);
        if (loop && faceSet.has(loop.face)) usingFaces.add(loop.face);
      }
      if (usingFaces.size !== 2) {
        return { ok: false, reason: 'not a closed solid — an edge is not shared by exactly two of these faces' };
      }
    }

    for (const vid of loopVertexIds(g, f.outerLoop)) {
      let set = vertexFaces.get(vid);
      if (!set) {
        set = new Set();
        vertexFaces.set(vid, set);
      }
      set.add(fid);
    }
  }

  for (const [vid, faces] of vertexFaces) {
    if (faces.size !== 3) {
      return {
        ok: false,
        reason: `vertex ${vid} is shared by ${faces.size} faces, not 3 — only degree-3 solids are supported yet`,
      };
    }
  }

  const out = new Map<VertexId, FaceId[]>();
  for (const [vid, faces] of vertexFaces) out.set(vid, [...faces]);
  return { ok: true, vertexFaces: out };
}

/**
 * Computes each face's own shrunk-inward inset points, without mutating the
 * graph — the read-only half of what `chamferSolid` does, exposed so a live
 * preview can show the same math mid-drag without running the full,
 * mutating construction on every frame.
 */
/** The reusable core of computeChamferInsets — the 2D-mitre shrink math
 *  for ONE face's own raw boundary points, independent of whether those
 *  points currently exist as a real face in the graph. Both
 *  computeChamferInsets (graph-based) and
 *  computeChamferInsetsFromBoundaries (raw stored data, for previewing a
 *  re-apply) share this. */
function insetFacePoints(points: readonly Vec3[], normal: Vec3, amount: number): Vec3[] {
  const plane: Plane = { point: points[0]!, normal };
  const basis = planeBasis(plane);
  const points2D = points.map((p) => projectToBasis(p, basis));
  const inset2D = offsetPolygon2D(points2D, -amount);
  return inset2D.map((p) => unprojectFromBasis(p, basis));
}

export function computeChamferInsets(
  g: Graph,
  faceIds: readonly FaceId[],
  amount: number,
): { originalNormal: Map<FaceId, Vec3>; insetPoint: Map<FaceId, Map<VertexId, Vec3>> } {
  const originalNormal = new Map<FaceId, Vec3>();
  const insetPoint = new Map<FaceId, Map<VertexId, Vec3>>();
  for (const fid of faceIds) {
    const f = g.faces.get(fid);
    if (!f) continue;
    originalNormal.set(fid, f.plane.normal);
    const order = loopVertexIds(g, f.outerLoop);
    const points = order.map((vid) => getVertex(g, vid).position);
    const inset = insetFacePoints(points, f.plane.normal, amount);
    const map = new Map<VertexId, Vec3>();
    order.forEach((vid, i) => map.set(vid, inset[i]!));
    insetPoint.set(fid, map);
  }
  return { originalNormal, insetPoint };
}

/**
 * The same shrink-inward preview math as computeChamferInsets, but for
 * boundaries that are NOT currently represented as real faces in the
 * graph — specifically, the original (pre-shrink) boundary a chamfer
 * session stores when re-applying to an already-chamfered solid (see
 * kernelChamfer.ts's own `reapplyFrom` field on ChamferSession).
 *
 * This exists because a live preview built on the CURRENT, already-
 * chamfered faces (via the ordinary computeChamferInsets) would compute
 * an inset of the wrong boundary entirely — the small, already-shrunk
 * faces, not the original sharp solid re-applying will actually
 * reconstruct and re-chamfer. That mismatch is confirmed as the actual
 * cause of a re-apply's live preview showing almost no visible change,
 * even though the eventual committed result is correct: the preview and
 * the real operation were computing two different things.
 */
export function computeChamferInsetsFromBoundaries(
  boundaries: readonly (readonly Vec3[])[],
  amount: number,
): Vec3[][] {
  return boundaries.map((points) => {
    const normal = computeNormal(points);
    if (!normal) return [];
    return insetFacePoints(points, normal, amount);
  });
}

// ---------------------------------------------------------------------------
// The operation
// ---------------------------------------------------------------------------

export function chamferSolid(
  ctx: InsertContext,
  faceIds: readonly FaceId[],
  amount: number,
): ChamferResult {
  if (amount <= 0) return { ok: false, reason: 'amount must be positive', touched: new Set() };

  const g = ctx.graph;
  const validated = validateSolid(g, faceIds);
  if (!validated.ok) return { ok: false, reason: validated.reason, touched: new Set() };
  const { vertexFaces } = validated;

  const { originalNormal, insetPoint } = computeChamferInsets(g, faceIds, amount);

  const touched = new Set<EdgeId>();
  const newFaceIds: FaceId[] = [];

  // 1. Each face's own shrunk boundary — the face itself, chamfered. Any
  // hole carries over completely unchanged: it's interior to the face
  // and doesn't touch the edges actually being chamfered.
  for (const fid of faceIds) {
    const f = g.faces.get(fid)!;
    const order = loopVertexIds(g, f.outerLoop);
    const map = insetPoint.get(fid)!;
    const points = order.map((vid) => map.get(vid)!);
    const holes = f.innerLoops.map((loopId) =>
      loopVertexIds(g, loopId).map((vid) => getVertex(g, vid).position),
    );
    const created = createDirectFace(ctx, points, originalNormal.get(fid)!, touched, holes);
    if (created !== null) {
      newFaceIds.push(created);
      // The ORIGINAL (pre-shrink) boundary, stored on the new shrunk face
      // itself — not on the edge-strip/corner-patch faces, which don't
      // correspond to any single original face. This is what lets a
      // later "re-apply chamfer with a different amount" reconstruct the
      // sharp box directly, rather than needing to undo (which risks
      // touching unrelated later edits) or re-locate the face spatially
      // after an undo. See kernelChamfer.ts's own use of this field.
      g.faces.get(created)!.attributes.custom.originalBoundary =
        order.map((vid) => getVertex(g, vid).position);
    }
  }

  // 2. One quad per original edge, bridging the two faces that used to meet
  // there.
  const processedEdges = new Set<EdgeId>();
  for (const fid of faceIds) {
    const f = g.faces.get(fid)!;
    const order = loopVertexIds(g, f.outerLoop);
    const edgeIds = loopEdgeIds(g, f.outerLoop);
    const n = order.length;
    for (let i = 0; i < n; i++) {
      const eid = edgeIds[i]!;
      if (processedEdges.has(eid)) continue;
      processedEdges.add(eid);

      const e = g.edges.get(eid)!;
      let otherFace: FaceId | null = null;
      for (const use of e.uses) {
        const loop = g.loops.get(use.loop);
        if (loop && loop.face !== fid && insetPoint.has(loop.face)) otherFace = loop.face;
      }
      if (otherFace === null) continue;

      const v1 = order[i]!;
      const v2 = order[(i + 1) % n]!;
      const a1 = insetPoint.get(fid)!.get(v1)!;
      const b1 = insetPoint.get(fid)!.get(v2)!;
      const otherMap = insetPoint.get(otherFace)!;
      const a2 = otherMap.get(v1)!;
      const b2 = otherMap.get(v2)!;

      const n1 = originalNormal.get(fid)!;
      const n2 = originalNormal.get(otherFace)!;
      const hint = normalize({ x: n1.x + n2.x, y: n1.y + n2.y, z: n1.z + n2.z });

      const created = createDirectFace(ctx, [a1, b1, b2, a2], hint, touched);
      if (created !== null) newFaceIds.push(created);
    }
  }

  // 3. One triangle per original (degree-3) vertex, capping the corner.
  for (const [vid, faces] of vertexFaces) {
    if (faces.length !== 3) continue;
    const pts = faces.map((fid) => insetPoint.get(fid)!.get(vid)!);
    const normals = faces.map((fid) => originalNormal.get(fid)!);
    const hint = normalize({
      x: normals[0]!.x + normals[1]!.x + normals[2]!.x,
      y: normals[0]!.y + normals[1]!.y + normals[2]!.y,
      z: normals[0]!.z + normals[1]!.z + normals[2]!.z,
    });
    const created = createDirectFace(ctx, pts, hint, touched);
    if (created !== null) newFaceIds.push(created);
  }

  // 4. Remove the original faces and their now-unused sharp edges/vertices.
  const oldEdgeIds = new Set<EdgeId>();
  for (const fid of faceIds) {
    const f = g.faces.get(fid);
    if (!f) continue;
    for (const eid of loopEdgeIds(g, f.outerLoop)) oldEdgeIds.add(eid);
    removeFace(g, fid);
  }
  for (const eid of oldEdgeIds) {
    const e = g.edges.get(eid);
    if (e && e.uses.length === 0) removeEdge(g, eid);
  }
  removeOrphanVertices(g);

  return { ok: true, touched };
}
