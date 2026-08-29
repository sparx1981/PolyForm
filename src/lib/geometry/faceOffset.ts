/**
 * PolyForm — face boundary offset.
 *
 * Offsets a single face's boundary within its own plane by INSERTING the
 * offset polygon as new edges, leaving the original boundary untouched.
 * This is what the app's Offset tool has always done: draw a smaller (or
 * larger) copy of the shape inside (or around) it, splitting the original
 * single face into two — a "frame" between the two boundaries, and the
 * new inner (or outer) shape as its own separate face.
 *
 * The first version of this file MOVED the face's own vertices to the new
 * boundary instead of inserting a second one. That reshapes the face in
 * place — a legitimate thing to want, but not what this tool does, and it
 * is why only one face ever existed afterward: there was never a second
 * boundary, so there was nothing for a second face to be bounded by. The
 * "outer" and "inner" surfaces a real offset produces are not a rendering
 * detail to add later; they come from committing a genuinely different
 * ring of edges rather than relocating the existing one.
 *
 * Because nothing existing is moved, this needs none of the "does this
 * face share an edge with a neighbour" caution the move-based version
 * required — a wall that is part of an already-extruded box is just as
 * offsettable as a free-standing floor plan, since its relationship to the
 * rest of the solid is never touched. Deriving the result reuses the same
 * region/hole logic that already handles "a smaller shape drawn inside a
 * larger one" — this is that, produced programmatically instead of by
 * hand.
 *
 * `offsetFaceVertices` in grouptransform.ts remains a different operation:
 * moving every vertex of a face SET along each face's own 3D normal,
 * inflating or shrinking a whole solid in three dimensions (closer to
 * "Shell" or "Grow Solid" elsewhere). Both are legitimate; only this one is
 * what "Offset" means in this app.
 */

import type { EdgeId, FaceId, Vec2 } from './types';
import { getVertex, loopEdgeIds, loopVertexIds } from './topology';
import { planeBasis, projectToBasis, unprojectFromBasis, distance } from './math';
import { insertEdge, type InsertContext } from './insert';

/**
 * Mitred offset of a closed 2D polygon.
 *
 * Positive `dist` grows the polygon outward; negative shrinks it inward.
 * Winding-agnostic — the polygon may be wound either way, and "outward" is
 * derived from its own signed area rather than assumed.
 *
 * Each edge's line is shifted outward by `dist` along its own perpendicular,
 * and each vertex of the result is the intersection of its two adjacent
 * offset lines — the exact construction, correct at any corner angle. This
 * is NOT the averaged-vertex-normal approximation `offsetFaceVertices` uses
 * elsewhere, which is only exact at 90-degree corners.
 *
 * A tie at a colinear "corner" (no real angle to mitre) falls back to a
 * simple perpendicular shift at that vertex, since two parallel offset
 * lines have no single intersection point.
 */
export function offsetPolygon2D(points: readonly Vec2[], dist: number): Vec2[] {
  const n = points.length;
  if (n < 3 || Math.abs(dist) < 1e-12) return points.slice();

  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  const ccw = area2 > 0;

  const outwardNormal = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return ccw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
  };

  const intersectLines = (p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null => {
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
    return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
  };

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;

    const nPrev = outwardNormal(prev, cur);
    const nNext = outwardNormal(cur, next);

    const p1 = { x: prev.x + nPrev.x * dist, y: prev.y + nPrev.y * dist };
    const d1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const p2 = { x: cur.x + nNext.x * dist, y: cur.y + nNext.y * dist };
    const d2 = { x: next.x - cur.x, y: next.y - cur.y };

    const hit = intersectLines(p1, d1, p2, d2);
    out.push(hit ?? { x: cur.x + nPrev.x * dist, y: cur.y + nPrev.y * dist });
  }
  return out;
}

export interface FaceOffsetInsertResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** Every edge touched — the new ring plus the original boundary, so
   *  derivation re-examines the whole region and produces both faces. */
  readonly touched: Set<EdgeId>;
}

/**
 * Inserts the offset ring of a face's outer boundary as new edges.
 *
 * Does not move anything that already exists. The original boundary edges
 * are added to `touched` alongside the new ring's edges even though they
 * themselves are unchanged, because derivation needs to re-examine the
 * whole region to discover that it now bounds two faces instead of one —
 * exactly as it would if the new ring had been drawn by hand with the
 * rectangle or poly tool.
 */
export function insertFaceOffset(
  ctx: InsertContext,
  faceId: FaceId,
  dist: number,
): FaceOffsetInsertResult {
  const g = ctx.graph;
  const f = g.faces.get(faceId);
  if (!f) return { ok: false, reason: 'face not found', touched: new Set() };
  if (f.innerLoops.length > 0) {
    return {
      ok: false,
      reason: 'face already has a hole; offsetting it is not supported yet',
      touched: new Set(),
    };
  }
  if (Math.abs(dist) < ctx.tolerances.MIN_EDGE_LENGTH) {
    return { ok: false, reason: 'distance below MIN_EDGE_LENGTH', touched: new Set() };
  }

  const basis = planeBasis(f.plane);
  const order = loopVertexIds(g, f.outerLoop);
  const points2D = order.map((vid) => projectToBasis(getVertex(g, vid).position, basis));
  const offset2D = offsetPolygon2D(points2D, dist);
  const offset3D = offset2D.map((p) => unprojectFromBasis(p, basis));

  const touched = new Set<EdgeId>();
  const n = offset3D.length;
  for (let i = 0; i < n; i++) {
    const a = offset3D[i]!;
    const b = offset3D[(i + 1) % n]!;
    if (distance(a, b) < ctx.tolerances.MIN_EDGE_LENGTH) continue;
    for (const t of insertEdge(ctx, a, b).touched) touched.add(t);
  }

  // The original boundary is unchanged, but it must be re-examined too —
  // this is what turns "one face" into "a frame with a hole, plus the new
  // shape" rather than leaving the new ring as disconnected geometry
  // floating inside a face that does not yet know about it.
  for (const eid of loopEdgeIds(g, f.outerLoop)) touched.add(eid);

  return { ok: true, touched };
}

// ---------------------------------------------------------------------------
// Cursor-to-polygon distance — for a hover/drag preview matching the app's
// original Offset tool exactly: the cursor's position directly encodes the
// offset amount (negative inside the boundary, positive outside), rather
// than a dragged delta the way push/pull's distance works.
// ---------------------------------------------------------------------------

/** True when a 2D point lies inside a polygon (even-odd ray casting). */
export function pointInPolygon2D(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersects = a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to a line segment. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * Signed distance from a point to a polygon's boundary: negative when the
 * point is inside (read as "shrink by this much"), positive when outside
 * ("grow by this much"). This is what turns raw cursor position into the
 * offset tool's live distance, matching the app's original hover-preview
 * behaviour exactly.
 */
export function signedDistanceToPolygon2D(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const d = distanceToSegment(p, poly[i]!, poly[(i + 1) % n]!);
    if (d < best) best = d;
  }
  return pointInPolygon2D(p, poly) ? -best : best;
}
