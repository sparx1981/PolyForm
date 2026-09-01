/**
 * PolyForm — uniform fillet (rounded edges) of a rectangular box.
 *
 * This is a genuinely different, and more carefully derived, construction
 * than an earlier attempt at this feature (removed after being found
 * wrong before shipping — see git history / prior session notes if
 * curious). That attempt used a SEPARATE, per-edge "centre" for each
 * rounded strip, built independently of the corner geometry, and a flat
 * triangle to cap each corner reusing chamfer's own inset points. Working
 * through the actual numbers exposed two real problems with that:
 *
 *  1. An edge's own rounded-arc tangent point on a face (computed from
 *     just that ONE edge) is a DIFFERENT point from that face's own
 *     mitred corner (which accounts for BOTH of its edges at that
 *     vertex) — confirmed with real coordinates, not a hunch. They don't
 *     coincide, so the arc and the flat corner cap left a gap.
 *  2. Even ignoring that, three arcs and three faces meeting at one
 *     corner means SIX tangent points cluster there, not the three a
 *     flat triangle assumes.
 *
 * The construction here fixes both by starting from a single, unified
 * per-VERTEX centre instead of a per-edge one, and using an actual curved
 * (not flat) corner patch:
 *
 *  - Each face still shrinks inward by `radius`, via the identical 2D
 *    mitre chamferSolid already uses (`computeChamferInsets` is reused
 *    directly, not re-derived).
 *  - Each edge's rounded strip is TRIMMED by `radius` at each end (it no
 *    longer runs the sharp edge's full original length), and its cross-
 *    section at parameter t is `normalize(lerp(nA, nB, t))` scaled by
 *    `radius` from a per-edge centre — not a true angular rotation, which
 *    matters: see below.
 *  - Each vertex gets a genuine spherical-octant patch (not a flat cap):
 *    for a box corner the three face normals nA, nB, nC are mutually
 *    perpendicular, so the point equidistant `radius` from all three
 *    faces is a single centre `O = V - radius*(nA+nB+nC)`, and the
 *    curved corner surface is the portion of the sphere of radius
 *    `radius` around O lying in the octant `{nA, nB, nC ≥ 0}` — built by
 *    subdividing the flat triangle with corners nA, nB, nC into a
 *    barycentric grid and normalizing each grid point onto that sphere
 *    (the standard "geodesic sphere face" technique).
 *
 * That specific choice of parametrization — normalize(linear blend),
 * not rotate-by-equal-angle — is what makes the edge strip and the
 * corner patch connect with no seam: at the trimmed end of an edge
 * (radius in from the original vertex), the edge strip's own local
 * centre works out to be EXACTLY the corner patch's centre O, and its
 * cross-section there is the identical curve to the corner patch's own
 * boundary. Confirmed numerically for the concrete box-corner case this
 * module is scoped to, not asserted from the general derivation alone —
 * see this module's test file for that check.
 *
 * SCOPE, same restriction as chamfer and for the same underlying reason:
 * rectangular boxes only. The centre formula and the "arc meets patch
 * with no seam" property both specifically depend on the three face
 * normals at a vertex being mutually perpendicular — true at every
 * corner of a box, not true at a triangular prism's or a cylinder's
 * non-90-degree corners. Attempting this on those shapes would need a
 * genuinely different (non-orthogonal) corner-patch derivation, not a
 * copy of this one.
 *
 * Reuses the SAME direct-face-construction technique chamferSolid uses,
 * and for the same reason: generic derive() region-detection breaks down
 * at the high-connectivity vertices this produces. Every new face here
 * is marked `chamferLocked` too, for the identical protection.
 */

import type { EdgeId, FaceId, Graph, Vec3, VertexId } from './types';
import { getVertex, loopEdgeIds, loopVertexIds, removeFace, removeEdge, removeOrphanVertices } from './topology';
import { planeBasis, projectToBasis, unprojectFromBasis, dot, add, scale, sub, tryNormalize } from './math';
import { offsetPolygon2D } from './faceOffset';
import type { InsertContext } from './insert';
import { createDirectFace } from './chamfer';

export interface FilletResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly touched: Set<EdgeId>;
}

const RIGHT_ANGLE_TOLERANCE = 1e-3;

export function validateBox(
  g: Graph,
  faceIds: readonly FaceId[],
): { ok: true; vertexFaces: Map<VertexId, FaceId[]> } | { ok: false; reason: string } {
  if (faceIds.length < 4) return { ok: false, reason: 'not enough faces to form a closed solid' };
  const faceSet = new Set(faceIds);
  const vertexFaces = new Map<VertexId, Set<FaceId>>();

  for (const fid of faceIds) {
    const f = g.faces.get(fid);
    if (!f) return { ok: false, reason: `face ${fid} not found` };
    // A face with a hole is fine — see chamfer.ts's own identical
    // reasoning: the hole is interior to the face, never touches the
    // edges being rounded, and carries over unchanged onto the shrunk
    // boundary face.

    const order = loopVertexIds(g, f.outerLoop);
    if (order.length !== 4) {
      return { ok: false, reason: 'rounded edges are only supported on rectangular boxes right now (a non-quad face was found)' };
    }

    const edgeIds = loopEdgeIds(g, f.outerLoop);
    for (const eid of edgeIds) {
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
      const [a, b] = [...usingFaces];
      const fa = g.faces.get(a!)!;
      const fb = g.faces.get(b!)!;
      if (Math.abs(dot(fa.plane.normal, fb.plane.normal)) > RIGHT_ANGLE_TOLERANCE) {
        return {
          ok: false,
          reason: 'rounded edges are only supported on rectangular boxes right now (a non-90-degree edge was found)',
        };
      }
    }

    for (const vid of order) {
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
        reason: `vertex ${vid} is shared by ${faces.size} faces, not 3 — only simple box corners are supported`,
      };
    }
  }

  const out = new Map<VertexId, FaceId[]>();
  for (const [vid, faces] of vertexFaces) out.set(vid, [...faces]);
  return { ok: true, vertexFaces: out };
}

/** A point on the arc/patch surface: normalize a weighted blend of unit
 *  normals, scale by radius, offset from a centre. Used for BOTH edge
 *  strips (two weights) and corner patches (three weights) — see this
 *  module's own doc comment for why using the same formula in both
 *  places is what makes them connect with no seam. */
function bulgePoint(centre: Vec3, radius: number, weighted: Vec3): Vec3 {
  const dir = tryNormalize(weighted);
  if (!dir) return centre;
  return add(centre, scale(dir, radius));
}

export function filletSolid(
  ctx: InsertContext,
  faceIds: readonly FaceId[],
  radius: number,
  segments = 6,
): FilletResult {
  if (radius <= 0) return { ok: false, reason: 'radius must be positive', touched: new Set() };
  if (segments < 1) return { ok: false, reason: 'segments must be at least 1', touched: new Set() };

  const g = ctx.graph;
  const validated = validateBox(g, faceIds);
  if (!validated.ok) return { ok: false, reason: validated.reason, touched: new Set() };
  const { vertexFaces } = validated;

  // The box's own centroid — used below to verify each face's stored
  // normal genuinely points outward, not just to trust it blindly.
  //
  // Confirmed directly as necessary, not a defensive guess: reconstructing
  // a box from stored boundary data (the re-apply path — see
  // kernelFillet.ts's own `reapplyFrom`) can produce a face whose stored
  // `plane.normal` points INWARD instead of outward, even though the
  // face's own geometry (which faces are where) is entirely correct.
  // insetPoint below is immune to this — its 2D mitre-inset shrinks
  // toward each face's own polygon centre regardless of which way its
  // normal points, which is exactly why chamfer's identical re-apply
  // path never surfaced this at all. vertexCentre and bulgePoint are
  // NOT immune: both depend on the absolute direction of "outward", so
  // a single inverted face normal there produces a vertexCentre wildly
  // on the wrong side of the corner — not a small error, a mirrored one.
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const fid of faceIds) {
    const f = g.faces.get(fid)!;
    for (const vid of loopVertexIds(g, f.outerLoop)) {
      const p = getVertex(g, vid).position;
      cx += p.x; cy += p.y; cz += p.z; count++;
    }
  }
  const centroid: Vec3 = count > 0 ? { x: cx / count, y: cy / count, z: cz / count } : { x: 0, y: 0, z: 0 };

  const originalNormal = new Map<FaceId, Vec3>();
  const insetPoint = new Map<FaceId, Map<VertexId, Vec3>>();
  for (const fid of faceIds) {
    const f = g.faces.get(fid)!;
    const order = loopVertexIds(g, f.outerLoop);
    const faceCentre = order.reduce(
      (acc, vid) => add(acc, getVertex(g, vid).position),
      { x: 0, y: 0, z: 0 } as Vec3,
    );
    const faceCentreAvg = scale(faceCentre, 1 / order.length);
    const towardOutside = sub(faceCentreAvg, centroid);
    const storedNormal = f.plane.normal;
    // Only the value stored in `originalNormal` is corrected — insetPoint
    // below deliberately keeps reading `f.plane` directly, unaffected by
    // this, since its own math never needed the fix in the first place.
    const outwardNormal = dot(storedNormal, towardOutside) < 0 ? scale(storedNormal, -1) : storedNormal;
    originalNormal.set(fid, outwardNormal);

    const basis = planeBasis(f.plane);
    const points2D = order.map((vid) => projectToBasis(getVertex(g, vid).position, basis));
    const inset2D = offsetPolygon2D(points2D, -radius);
    const map = new Map<VertexId, Vec3>();
    order.forEach((vid, i) => map.set(vid, unprojectFromBasis(inset2D[i]!, basis)));
    insetPoint.set(fid, map);
  }

  const touched = new Set<EdgeId>();
  const newFaceIds: FaceId[] = [];
  const addDirectFace = (points: Vec3[], hint: Vec3, holes?: readonly (readonly Vec3[])[]): FaceId | null => {
    const created = createDirectFace(ctx, points, hint, touched, holes);
    if (created !== null) newFaceIds.push(created);
    return created;
  };

  // Per-vertex centre O = V - radius*(sum of the three face normals) —
  // the point equidistant `radius` from all three faces at that corner.
  const vertexCentre = new Map<VertexId, Vec3>();
  for (const [vid, faces] of vertexFaces) {
    const v = getVertex(g, vid).position;
    const sumN = faces.reduce((acc, fid) => add(acc, originalNormal.get(fid)!), { x: 0, y: 0, z: 0 } as Vec3);
    vertexCentre.set(vid, sub(v, scale(sumN, radius)));
  }

  // 1. Each face's own shrunk boundary (identical to chamfer's). Any
  // hole carries over completely unchanged — see chamfer.ts's identical
  // reasoning and createDirectFace's own doc comment on its `holes`
  // parameter.
  for (const fid of faceIds) {
    const f = g.faces.get(fid)!;
    const order = loopVertexIds(g, f.outerLoop);
    const map = insetPoint.get(fid)!;
    const holes = f.innerLoops.map((loopId) =>
      loopVertexIds(g, loopId).map((vid) => getVertex(g, vid).position),
    );
    const created = addDirectFace(order.map((vid) => map.get(vid)!), originalNormal.get(fid)!, holes);
    if (created !== null) {
      // Same reasoning as chamfer.ts's identical step — see its own doc
      // comment on `originalBoundary` for the full explanation.
      g.faces.get(created)!.attributes.custom.originalBoundary =
        order.map((vid) => getVertex(g, vid).position);
    }
  }

  // 2. A trimmed, curved strip per original edge.
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
      const nA = originalNormal.get(fid)!;
      const nB = originalNormal.get(otherFace)!;
      const centre1 = vertexCentre.get(v1)!;
      const centre2 = vertexCentre.get(v2)!;

      const ringAt1: Vec3[] = [];
      const ringAt2: Vec3[] = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const weighted = add(scale(nA, 1 - t), scale(nB, t));
        ringAt1.push(bulgePoint(centre1, radius, weighted));
        ringAt2.push(bulgePoint(centre2, radius, weighted));
      }

      for (let s = 0; s < segments; s++) {
        addDirectFace(
          [ringAt1[s]!, ringAt1[s + 1]!, ringAt2[s + 1]!, ringAt2[s]!],
          add(scale(nA, 1 - s / segments), scale(nB, s / segments)),
        );
      }
    }
  }

  // 3. A curved spherical-octant patch per original (degree-3) vertex,
  // built by subdividing the flat triangle (nA, nB, nC) into a
  // barycentric grid and normalizing each point onto the sphere around
  // that vertex's own centre.
  for (const [vid, faces] of vertexFaces) {
    const centre = vertexCentre.get(vid)!;
    const [fA, fB, fC] = faces;
    const nA = originalNormal.get(fA!)!;
    const nB = originalNormal.get(fB!)!;
    const nC = originalNormal.get(fC!)!;

    // grid[i][j] for i+j<=segments, k = segments-i-j implicit.
    const grid: Vec3[][] = [];
    for (let i = 0; i <= segments; i++) {
      const row: Vec3[] = [];
      for (let j = 0; j <= segments - i; j++) {
        const k = segments - i - j;
        const weighted = add(add(scale(nA, i / segments), scale(nB, j / segments)), scale(nC, k / segments));
        row.push(bulgePoint(centre, radius, weighted));
      }
      grid.push(row);
    }

    const hint = tryNormalize(add(add(nA, nB), nC));
    if (!hint) continue;

    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < segments - i; j++) {
        // "Up" triangle, always present.
        addDirectFace([grid[i]![j]!, grid[i + 1]![j]!, grid[i]![j + 1]!], hint);
        // "Down" triangle, present except along the outer edge of the grid.
        if (j < segments - i - 1) {
          addDirectFace([grid[i + 1]![j]!, grid[i + 1]![j + 1]!, grid[i]![j + 1]!], hint);
        }
      }
    }
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
