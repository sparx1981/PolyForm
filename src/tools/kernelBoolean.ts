/**
 * PolyForm — Merge, Subtract and Intersect for flat drawn shapes.
 *
 * Shapes drawn with the shape tools are kept independent: two overlapping
 * rectangles stay two rectangles. These operations combine flat shapes
 * that lie on one plane into a single new one:
 *
 *  - Merge: everything the shapes cover (they must overlap or touch).
 *  - Subtract: the first shape with every later one cut out of it.
 *  - Intersect: only where all the shapes overlap.
 *
 * The first shape in the list leads: it is the one Subtract keeps, and
 * the result takes its material. The originals are replaced by the result
 * in one undo step.
 */

import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import type { EdgeId, FaceId, Graph, LoopId, PlaneBasis, Vec2, Vec3 } from '../lib/geometry/types';
import { loopEdgeIds, loopPoints, removeFace } from '../lib/geometry/topology';
import { planeBasis, projectToBasis, unprojectFromBasis } from '../lib/geometry/math';
import { insertIsolatedEdge, type InsertContext } from '../lib/geometry/insert';
import { derive, type DeriveOptions } from '../lib/geometry/derive';
import { deleteGroupFacesAndEdges, groupContaining } from './kernelSelection';
import { ISOLATED_SHAPE_KEY } from './kernelPushPull';

const clip = ((polygonClippingModule as unknown as { default?: typeof polygonClippingModule }).default
  ?? polygonClippingModule) as typeof polygonClippingModule;

export type BooleanOp = 'merge' | 'subtract' | 'intersect';

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  merge: 'Merge',
  subtract: 'Subtract',
  intersect: 'Intersect',
};

/** Normals this close (about 0.5 degrees) count as the same plane orientation. */
const PARALLEL = Math.cos((0.5 * Math.PI) / 180);
/** Faces this close (m) to the first shape's plane count as on it. */
const ON_PLANE = 1e-3;
/** Results smaller than this (m²) count as nothing. */
const MIN_AREA = 1e-4;

export interface BooleanPlan {
  readonly ok: true;
  readonly op: BooleanOp;
  /** Every face that will be replaced. */
  readonly sourceFaces: FaceId[];
  /** The result, in the first shape's plane: outer ring then holes, per piece. */
  readonly pieces: Vec2[][][];
  readonly basis: PlaneBasis;
  readonly material: string | null;
  readonly finish: unknown;
}

export interface BooleanRejection {
  readonly ok: false;
  readonly reason: string;
}

const ringOf = (pts: readonly Vec2[]): Ring => [...pts.map((p) => [p.x, p.y] as [number, number]), [pts[0]!.x, pts[0]!.y]];

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i + 1 < r.length; i++) a += r[i]![0] * r[i + 1]![1] - r[i + 1]![0] * r[i]![1];
  return a / 2;
}

function multiArea(m: MultiPolygon): number {
  return m.reduce((sum, poly) => sum + poly.reduce((s, ring, k) => s + (k === 0 ? 1 : -1) * Math.abs(ringArea(ring)), 0), 0);
}

function toVec2(r: Ring): Vec2[] {
  const pts = r.map(([x, y]) => ({ x, y }));
  const first = pts[0], last = pts[pts.length - 1];
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-12) pts.pop();
  return pts;
}

/** True when every face of a shape lies on one plane (a drawn flat shape, not a pulled-up solid). */
export function isFlatShape(g: Graph, faces: readonly FaceId[]): boolean {
  const first = g.faces.get(faces[0]!);
  if (!first) return false;
  const n = first.plane.normal, o = first.plane.point;
  return faces.every(id => {
    const f = g.faces.get(id);
    if (!f) return false;
    const fn = f.plane.normal, fp = f.plane.point;
    return Math.abs(fn.x * n.x + fn.y * n.y + fn.z * n.z) >= PARALLEL
      && Math.abs((fp.x - o.x) * n.x + (fp.y - o.y) * n.y + (fp.z - o.z) * n.z) <= ON_PLANE;
  });
}

/**
 * The shapes a face selection covers, each as its whole group, in the
 * order they were first selected (the first shape leads).
 */
export function orderedShapeGroups(g: Graph, faces: readonly FaceId[]): FaceId[][] {
  const seen = new Set<FaceId>();
  const groups: FaceId[][] = [];
  for (const id of faces) {
    if (seen.has(id) || !g.faces.has(id)) continue;
    const group = groupContaining(g, id);
    for (const f of group) seen.add(f);
    groups.push(group);
  }
  return groups;
}

/**
 * Works out a Merge, Subtract or Intersect of shapes, each given as the
 * faces of one drawn shape (a selection group), first shape first.
 */
export function planBoolean(g: Graph, shapes: readonly (readonly FaceId[])[], op: BooleanOp): BooleanPlan | BooleanRejection {
  if (shapes.length < 2) return { ok: false, reason: 'Select at least two shapes.' };
  const firstFace = g.faces.get(shapes[0]![0]!);
  if (!firstFace) return { ok: false, reason: 'That shape no longer exists.' };
  const basis = planeBasis(firstFace.plane);
  const n = basis.normal;

  // A shape drawn inside another becomes a hole in it (the two share that
  // outline's edges). Where a hole is filled by another selected shape, it
  // counts as filled, so the outer shape means its whole outline.
  const edgeKey = (loop: LoopId) => [...loopEdgeIds(g, loop)].sort((a, b) => a - b).join(',');
  const selectedOutlines = new Set<string>();
  for (const faces of shapes) for (const id of faces) {
    const f = g.faces.get(id);
    if (f) selectedOutlines.add(edgeKey(f.outerLoop));
  }

  // Each shape's region on the plane: its faces joined together.
  const regions: MultiPolygon[] = [];
  for (const faces of shapes) {
    const polys: Polygon[] = [];
    for (const id of faces) {
      const f = g.faces.get(id);
      if (!f) return { ok: false, reason: 'One of those shapes no longer exists.' };
      const fn = f.plane.normal;
      if (Math.abs(fn.x * n.x + fn.y * n.y + fn.z * n.z) < PARALLEL) {
        return { ok: false, reason: 'Only flat shapes can be combined. Pulled-up shapes have sides facing other ways.' };
      }
      const off = (f.plane.point.x - basis.origin.x) * n.x + (f.plane.point.y - basis.origin.y) * n.y + (f.plane.point.z - basis.origin.z) * n.z;
      if (Math.abs(off) > ON_PLANE) return { ok: false, reason: 'The shapes must lie on the same flat surface.' };
      const flat = (loop: LoopId) => loopPoints(g, loop).map((p) => projectToBasis(p, basis));
      const holes = f.innerLoops.filter((l) => !selectedOutlines.has(edgeKey(l)));
      polys.push([ringOf(flat(f.outerLoop)), ...holes.map((l) => ringOf(flat(l)))]);
    }
    const [head, ...rest] = polys;
    if (!head) return { ok: false, reason: 'One of those shapes has no surface.' };
    regions.push(rest.length ? clip.union(head, ...rest) : [head]);
  }

  const [first, ...others] = regions;
  let result: MultiPolygon;
  try {
    if (op === 'merge') {
      result = clip.union(first!, ...others);
      if (result.length > 1) {
        return { ok: false, reason: 'Those shapes do not overlap or touch, so they cannot be merged into one.' };
      }
    } else if (op === 'subtract') {
      const overlap = multiArea(clip.intersection(first!, clip.union(others[0]!, ...others.slice(1))));
      if (overlap < MIN_AREA) return { ok: false, reason: 'Nothing to cut: the other shapes do not overlap the first one.' };
      result = clip.difference(first!, ...others);
    } else {
      result = clip.intersection(first!, ...others);
      if (multiArea(result) < MIN_AREA) return { ok: false, reason: 'Those shapes do not all overlap, so there is nothing in common to keep.' };
    }
  } catch {
    return { ok: false, reason: 'Those shapes could not be combined.' };
  }
  const pieces = result
    .filter((poly) => poly.length && Math.abs(ringArea(poly[0]!)) >= MIN_AREA)
    .map((poly) => poly.map(toVec2).filter((r) => r.length >= 3));
  if (!pieces.length) {
    return { ok: false, reason: op === 'subtract' ? 'That would cut the whole shape away.' : 'Nothing would be left.' };
  }
  return {
    ok: true,
    op,
    sourceFaces: shapes.flat(),
    pieces,
    basis,
    material: firstFace.attributes.materialFront,
    finish: firstFace.attributes.custom.finish,
  };
}

/**
 * Replaces the source faces with the result. Returns the new faces.
 * Call inside the host's `transact` so it is one undo step.
 */
export function applyBoolean(ctx: InsertContext, plan: BooleanPlan, deriveOpts: DeriveOptions): FaceId[] {
  const g = ctx.graph;
  deleteGroupFacesAndEdges(g, plan.sourceFaces);
  const facesBefore = new Set(g.faces.keys());
  const touched = new Set<EdgeId>();
  const to3 = (p: Vec2): Vec3 => unprojectFromBasis(p, plan.basis);
  for (const piece of plan.pieces) {
    for (const ring of piece) {
      for (let i = 0; i < ring.length; i++) {
        for (const t of insertIsolatedEdge(ctx, to3(ring[i]!), to3(ring[(i + 1) % ring.length]!)).touched) touched.add(t);
      }
    }
  }
  derive(g, touched, deriveOpts);

  // Drawing a hole's outline also derives a face filling the hole; only
  // faces that match a result piece (same holes, same area) are kept.
  const expected = plan.pieces.map((piece) => ({
    holes: piece.length - 1,
    area: Math.abs(ringArea(ringOf(piece[0]!))),
  }));
  const kept: FaceId[] = [];
  for (const [id, face] of [...g.faces]) {
    if (facesBefore.has(id)) continue;
    const outer = loopPoints(g, face.outerLoop).map((p) => projectToBasis(p, plan.basis));
    const area = Math.abs(ringArea(ringOf(outer)));
    const match = expected.some((e) => e.holes === face.innerLoops.length && Math.abs(e.area - area) <= Math.max(1e-6, e.area * 1e-3));
    if (!match) {
      removeFace(g, id);
      continue;
    }
    face.attributes.custom[ISOLATED_SHAPE_KEY] = true;
    if (plan.material) face.attributes.materialFront = plan.material;
    if (plan.finish) face.attributes.custom.finish = JSON.parse(JSON.stringify(plan.finish)) as unknown;
    kept.push(id);
  }
  return kept;
}
