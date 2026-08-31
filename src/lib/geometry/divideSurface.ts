/**
 * PolyForm — divide a rectangular surface into a grid of smaller ones.
 *
 * This is genuinely a different action from drawing a line across a face
 * by hand, even though the underlying mechanism (insertEdge's ordinary
 * sticky splitting) is identical — it's a one-click way to place a whole
 * grid of dividing lines at once, rather than drawing each one
 * individually. It deliberately uses the STICKY insertEdge, not
 * insertIsolatedEdge: a divided face's own pieces should behave exactly
 * like any other surface a user split with the Line tool — connected to
 * their shared boundaries, groupable, splittable further — not held
 * apart as independent objects the way Rectangle/Circle/Triangle's own
 * shapes are (see insertIsolatedEdge's own doc comment for why those are
 * different).
 *
 * Scoped to a single, simple rectangular face (4 vertices, both pairs of
 * consecutive edges meeting at 90 degrees) for the same reason chamfer
 * and fillet scope themselves the way they do: the grid math here is a
 * straightforward linear interpolation between two edge directions,
 * which only produces a valid, non-self-intersecting grid when those two
 * directions are genuinely perpendicular. A non-rectangular quad (or
 * anything with more than 4 sides) would need real polygon-subdivision
 * math this function does not attempt.
 */

import type { EdgeId, FaceId, Graph, Vec3 } from './types';
import { loopPoints, removeFace } from './topology';
import { insertEdge, type InsertContext } from './insert';
import { add, dot, scale, sub, tryNormalize } from './math';

export interface DivideSurfaceResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly touched: Set<EdgeId>;
}

const RIGHT_ANGLE_TOLERANCE = 1e-3;

/**
 * Validates that a face is a simple, divisible rectangle. Exposed
 * separately (not folded into divideRectangularFace itself) so a caller
 * — e.g. deciding whether to even show "Divide Surface" in a context
 * menu — can check eligibility without attempting the edit.
 */
export function isSimpleRectangularFace(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  if (f.innerLoops.length > 0) return false; // a hole makes "a grid of N x M pieces" ill-defined
  const pts = loopPoints(g, f.outerLoop);
  if (pts.length !== 4) return false;

  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % 4]!;
    const dirIn = tryNormalize(sub(cur, prev));
    const dirOut = tryNormalize(sub(next, cur));
    if (!dirIn || !dirOut) return false;
    if (Math.abs(dot(dirIn, dirOut)) > RIGHT_ANGLE_TOLERANCE) return false;
  }
  return true;
}

/**
 * Divides a single rectangular face into `columns` x `rows` equal pieces,
 * by inserting a grid of dividing edges the ordinary, sticky way (see
 * this module's own doc comment for why sticky, not isolated).
 *
 * `columns` counts divisions along the P0->P1 edge, `rows` along the
 * P0->P3 edge — i.e. columns x rows pieces are produced in total, not
 * columns+rows. Which of a face's own two edge directions is "P0->P1" is
 * an internal detail of how derive() happened to wind that face's loop,
 * not something tied to a fixed "horizontal vs vertical" or "width vs
 * depth" — a caller presenting this as a user-facing "columns/rows"
 * input should keep that in mind; the two numbers reliably multiply out
 * to the right total piece count, but which physical direction each one
 * corresponds to is not guaranteed to match visual intuition.
 */
export function divideRectangularFace(
  ctx: InsertContext,
  id: FaceId,
  columns: number,
  rows: number,
): DivideSurfaceResult {
  const touched = new Set<EdgeId>();
  if (columns < 1 || rows < 1) {
    return { ok: false, reason: 'columns and rows must each be at least 1', touched };
  }
  if (columns === 1 && rows === 1) {
    return { ok: false, reason: 'nothing to divide (1 x 1 is the face itself)', touched };
  }
  if (!isSimpleRectangularFace(ctx.graph, id)) {
    return { ok: false, reason: 'only a simple, 4-sided rectangular face can be divided this way', touched };
  }

  const g = ctx.graph;
  const f = g.faces.get(id)!;
  const [p0, p1, p2, p3] = loopPoints(g, f.outerLoop) as [Vec3, Vec3, Vec3, Vec3];
  const dirA = sub(p1, p0); // P0 -> P1, divided into `columns`
  const dirB = sub(p3, p0); // P0 -> P3, divided into `rows`

  // Dividers parallel to dirB, at each interior column boundary along dirA.
  for (let i = 1; i < columns; i++) {
    const t = i / columns;
    const start = add(p0, scale(dirA, t));
    const end = add(start, dirB);
    for (const e of insertEdge(ctx, start, end).touched) touched.add(e);
  }
  // Dividers parallel to dirA, at each interior row boundary along dirB.
  for (let j = 1; j < rows; j++) {
    const t = j / rows;
    const start = add(p0, scale(dirB, t));
    const end = add(start, dirA);
    for (const e of insertEdge(ctx, start, end).touched) touched.add(e);
  }

  // Explicitly remove the ORIGINAL, now-subdivided face before deriving —
  // not just re-touch its boundary and hope derive()'s own hash-matching
  // sorts it out. Confirmed directly that re-touching alone was NOT
  // enough: the original face object still persisted alongside the new,
  // smaller pieces (an off-by-one face count in testing), almost
  // certainly because its own outerLoop reference goes stale once its
  // boundary edges are split by the new dividers, yet the face object
  // itself was never actually replaced. removeFace only deletes the face
  // and loop objects, not the underlying edges/vertices — those stay
  // exactly where the dividers left them, ready for derive() to build
  // fresh, correctly-sized pieces from.
  removeFace(g, id);

  return { ok: true, touched };
}
