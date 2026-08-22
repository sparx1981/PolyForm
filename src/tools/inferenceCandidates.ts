/**
 * PolyForm — inference candidates sourced from the kernel. §4.2, §2.5
 *
 * The existing PolyformInferenceEngine does not gather candidates; `update()`
 * receives them. That is the seam this file fills: it turns a kernel graph
 * into `InferenceCandidate[]` in the shape the engine already consumes, so
 * the engine's hysteresis, locking and tracking-ray machinery carries over
 * unchanged.
 *
 * Two rules from §2.5 shape the API:
 *
 *  - Hit-testing runs ACROSS contexts; insertion targets only the active one.
 *    That asymmetry is what lets a user draw a wall inside one container
 *    aligned exactly to a window in another, so candidates carry the context
 *    they came from and the caller converts on commit.
 *
 *  - Constraints are evaluated in the ACTIVE context's local space. Under a
 *    non-uniform ancestor scale, "perpendicular in world space" and
 *    "perpendicular in this container" are genuinely different constraints.
 */

import type {
  ContainerId, EdgeId, FaceId, Graph, Vec3, VertexId,
} from '../lib/geometry/types';
import {
  add, closestPointOnSegment, cross, distance, dot, length, midpoint,
  normalize, scale, segmentIntersection3D, sub, tryNormalize,
} from '../lib/geometry/math';
import { edgePoints, getVertex, loopPoints } from '../lib/geometry/topology';

/** Mirrors the engine's enum. Kept structural so this file does not import it. */
export type InferenceKind =
  | 'ENDPOINT' | 'CURVE_CENTER' | 'MIDPOINT' | 'FACE_CENTROID'
  | 'INTERSECTION' | 'GUIDE_POINT' | 'ON_EDGE' | 'ON_FACE';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface KernelCandidate {
  readonly kind: InferenceKind;
  /** In the ACTIVE context's local frame. */
  readonly point: Vec3;
  readonly screenDistance: number;
  readonly sourceEntityId: string;
  readonly tooltip: string;
  /** Direction of the edge this sits on, for parallel and extension locks. */
  readonly edgeVector?: Vec3;
  /** Normal of the face this sits on, for planar constraints. */
  readonly planeNormal?: Vec3;
  /** Which container it came from; may not be the active one. §2.5 */
  readonly context?: ContainerId;
}

export interface CandidateOptions {
  /** World point to screen. Null when behind the camera or off-screen. */
  readonly project: (p: Vec3) => ScreenPoint | null;
  readonly cursor: ScreenPoint;
  /** Cursor ray, for On Edge and On Face. */
  readonly ray?: { origin: Vec3; direction: Vec3 };
  /** Screen-space acquisition radius. Roughly double it for touch. §8 */
  readonly snapRadiusPx: number;
  readonly context?: ContainerId;
  /** Cap per kind, so a dense model cannot flood the engine. */
  readonly maxPerKind?: number;
}

const screenDist = (a: ScreenPoint, b: ScreenPoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Collects every kernel candidate within the snap radius.
 *
 * Returns a superset ordered deterministically; the engine applies precedence
 * and hysteresis. Deliberately does NOT pick a winner — that decision lives
 * in one place, and duplicating it here is how the two drift apart.
 */
export function collectKernelCandidates(
  g: Graph,
  opts: CandidateOptions,
): KernelCandidate[] {
  const out: KernelCandidate[] = [];
  const cap = opts.maxPerKind ?? 64;

  const consider = (
    kind: InferenceKind,
    point: Vec3,
    id: string,
    tooltip: string,
    extra: { edgeVector?: Vec3; planeNormal?: Vec3 } = {},
  ): void => {
    const s = opts.project(point);
    if (!s) return;
    const d = screenDist(s, opts.cursor);
    if (d > opts.snapRadiusPx) return;
    out.push({
      kind,
      point,
      screenDistance: d,
      sourceEntityId: id,
      tooltip,
      ...(extra.edgeVector ? { edgeVector: extra.edgeVector } : {}),
      ...(extra.planeNormal ? { planeNormal: extra.planeNormal } : {}),
      ...(opts.context !== undefined ? { context: opts.context } : {}),
    });
  };

  // --- Endpoints -----------------------------------------------------------
  let n = 0;
  for (const [id, v] of [...g.vertices].sort((a, b) => a[0] - b[0])) {
    if (n++ > cap * 8) break;
    consider('ENDPOINT', v.position, `v${id}`, 'Endpoint');
  }

  // --- Midpoints and On Edge ----------------------------------------------
  n = 0;
  for (const [id, e] of [...g.edges].sort((a, b) => a[0] - b[0])) {
    if (n++ > cap * 8) break;
    const [a, b] = edgePoints(g, e);
    const dir = tryNormalize(sub(b, a));
    const extra = dir ? { edgeVector: dir } : {};

    consider('MIDPOINT', midpoint(a, b), `e${id}m`, 'Midpoint', extra);

    if (opts.ray) {
      const onEdge = closestPointOnRayToSegment(opts.ray, a, b);
      if (onEdge) consider('ON_EDGE', onEdge, `e${id}`, 'On Edge', extra);
    }
  }

  // --- Curve centres -------------------------------------------------------
  for (const [id, c] of [...g.curves].sort((a, b) => a[0] - b[0])) {
    consider('CURVE_CENTER', c.centre, `c${id}`, 'Center', { planeNormal: c.normal });
  }

  // --- Faces: centroid and On Face ----------------------------------------
  for (const [id, f] of [...g.faces].sort((a, b) => a[0] - b[0])) {
    const pts = loopPoints(g, f.outerLoop);
    if (pts.length >= 3) {
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
      const centroid = { x: cx / pts.length, y: cy / pts.length, z: cz / pts.length };
      consider('FACE_CENTROID', centroid, `f${id}c`, 'Center of Face', { planeNormal: f.plane.normal });
    }
    if (opts.ray) {
      const hit = rayFaceHit(g, id, opts.ray);
      if (hit) consider('ON_FACE', hit, `f${id}`, 'On Face', { planeNormal: f.plane.normal });
    }
  }

  // --- Intersections -------------------------------------------------------
  // Within one graph, crossing edges are already split into a shared vertex by
  // R2, so these come from edges that cross WITHOUT being joined: geometry in
  // different containers, or imported geometry not yet resolved. §2.4
  for (const c of apparentIntersections(g, opts)) out.push(c);

  return out.sort(
    (a, b) => a.screenDistance - b.screenDistance || a.sourceEntityId.localeCompare(b.sourceEntityId),
  );
}

function apparentIntersections(g: Graph, opts: CandidateOptions): KernelCandidate[] {
  const out: KernelCandidate[] = [];
  const edges = [...g.edges.values()].sort((a, b) => a.id - b.id);
  const limit = Math.min(edges.length, 200); // pairwise: keep it bounded

  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      const ea = edges[i]!;
      const eb = edges[j]!;
      // Topologically joined already: R2 gave them a shared vertex.
      if (ea.v0 === eb.v0 || ea.v0 === eb.v1 || ea.v1 === eb.v0 || ea.v1 === eb.v1) continue;

      const [a0, a1] = edgePoints(g, ea);
      const [b0, b1] = edgePoints(g, eb);
      const hit = segmentIntersection3D(a0, a1, b0, b1, 1e-6);
      if (!hit) continue;

      const s = opts.project(hit.point);
      if (!s) continue;
      const d = screenDist(s, opts.cursor);
      if (d > opts.snapRadiusPx) continue;

      out.push({
        kind: 'INTERSECTION',
        point: hit.point,
        screenDistance: d,
        sourceEntityId: `x${ea.id}_${eb.id}`,
        tooltip: 'Intersection',
        ...(opts.context !== undefined ? { context: opts.context } : {}),
      });
    }
  }
  return out;
}

/** Point on the segment nearest the cursor ray. Null when they diverge. */
function closestPointOnRayToSegment(
  ray: { origin: Vec3; direction: Vec3 },
  a: Vec3,
  b: Vec3,
): Vec3 | null {
  const d1 = ray.direction;
  const d2 = sub(b, a);
  const r = sub(a, ray.origin);
  const a11 = dot(d1, d1);
  const a12 = -dot(d1, d2);
  const a22 = dot(d2, d2);
  const b1 = dot(d1, r);
  const b2 = -dot(d2, r);
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null; // parallel
  const t2 = (a11 * b2 - a12 * b1) / det;
  const clamped = Math.min(1, Math.max(0, t2));
  return add(a, scale(d2, clamped));
}

function rayFaceHit(
  g: Graph,
  id: FaceId,
  ray: { origin: Vec3; direction: Vec3 },
): Vec3 | null {
  const f = g.faces.get(id);
  if (!f) return null;
  const denom = dot(f.plane.normal, ray.direction);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(sub(f.plane.point, ray.origin), f.plane.normal) / denom;
  if (t < 0) return null;
  return add(ray.origin, scale(ray.direction, t));
}

// ---------------------------------------------------------------------------
// Linear inferences — §4.2
// ---------------------------------------------------------------------------

export type LinearKind =
  | 'axis' | 'parallel' | 'perpendicular' | 'extension' | 'fromPoint';

export interface LinearInference {
  readonly kind: LinearKind;
  /** Unit direction the segment is constrained to. */
  readonly direction: Vec3;
  /** Anchor the constraint line passes through. */
  readonly origin: Vec3;
  /** Point on the constraint line nearest the raw cursor. */
  readonly point: Vec3;
  readonly deviation: number;
  readonly tooltip: string;
  readonly colorHex: string;
}

const COLOR = {
  x: '#E53E3E', y: '#38A169', z: '#3182CE',
  parallel: '#D53F8C', inference: '#805AD5', tracking: '#DD6B20',
} as const;

const projectOntoLine = (p: Vec3, origin: Vec3, dir: Vec3): Vec3 =>
  add(origin, scale(dir, dot(sub(p, origin), dir)));

/**
 * The linear inferences §4.2 lists that the existing engine does not yet
 * cover: parallel to a hovered edge, perpendicular to it, and colinear with
 * an existing edge beyond its end.
 *
 * The engine already handles axis locks and cardinal tracking rays, so those
 * are not duplicated here — only `axis` is offered, and only so a caller that
 * wants a single ranked list can get one.
 */
export function collectLinearInferences(
  g: Graph,
  from: Vec3,
  cursor: Vec3,
  opts: {
    hoveredEdge?: EdgeId | null;
    toleranceRad?: number;
    /** Screen-space test, when available, is closer to what the user sees. */
    screenTolerance?: { project: (p: Vec3) => ScreenPoint | null; cursor: ScreenPoint; radiusPx: number };
  } = {},
): LinearInference[] {
  const out: LinearInference[] = [];
  const raw = sub(cursor, from);
  const rawLen = length(raw);
  if (!(rawLen > 0)) return out;
  const tol = opts.toleranceRad ?? 0.05; // ~3 degrees

  const offer = (
    kind: LinearKind,
    dir: Vec3 | null,
    origin: Vec3,
    tooltip: string,
    colorHex: string,
  ): void => {
    const d = tryNormalize(dir ?? { x: 0, y: 0, z: 0 });
    if (!d) return;
    const projected = projectOntoLine(cursor, origin, d);
    const deviation = distance(cursor, projected);
    // Angular gate, so the constraint is offered when the user is pointing
    // roughly along it rather than merely near the infinite line.
    const along = tryNormalize(sub(projected, origin));
    if (!along) return;
    const sinAngle = length(cross(normalize(raw), d));
    if (sinAngle > Math.sin(tol)) return;
    out.push({ kind, direction: d, origin, point: projected, deviation, tooltip, colorHex });
  };

  offer('axis', { x: 1, y: 0, z: 0 }, from, 'On Red Axis', COLOR.x);
  offer('axis', { x: 0, y: 1, z: 0 }, from, 'On Green Axis', COLOR.y);
  offer('axis', { x: 0, y: 0, z: 1 }, from, 'On Blue Axis', COLOR.z);

  if (opts.hoveredEdge != null) {
    const e = g.edges.get(opts.hoveredEdge);
    if (e) {
      const [a, b] = edgePoints(g, e);
      const dir = tryNormalize(sub(b, a));
      if (dir) {
        offer('parallel', dir, from, 'Parallel to Edge', COLOR.parallel);
        // Any direction perpendicular to the edge is valid, so choose the one
        // closest to where the user is actually pointing rather than an
        // arbitrary axis — otherwise the cue appears in an unrelated place.
        const perp = tryNormalize(sub(raw, scale(dir, dot(raw, dir))));
        offer('perpendicular', perp, from, 'Perpendicular to Edge', COLOR.parallel);
      }
    }
  }

  // Edge extension: colinear with an existing edge, beyond its end.
  for (const [id, e] of [...g.edges].sort((a, b) => a[0] - b[0])) {
    const [a, b] = edgePoints(g, e);
    const dir = tryNormalize(sub(b, a));
    if (!dir) continue;
    for (const end of [a, b]) {
      if (distance(end, from) > 1e-9) continue;
      offer('extension', dir, end, 'On Edge Extension', COLOR.inference);
      break;
    }
    void id;
  }

  return out.sort((p, q) => p.deviation - q.deviation);
}

/**
 * From-point inference: aligned with a previously hovered point along an
 * axis. The engine's tracking rays already cover the cardinal case; this is
 * the general form for an arbitrary reference direction.
 */
export function fromPointInference(
  source: Vec3,
  direction: Vec3,
  cursor: Vec3,
  tolerance: number,
): LinearInference | null {
  const d = tryNormalize(direction);
  if (!d) return null;
  const projected = projectOntoLine(cursor, source, d);
  const deviation = distance(cursor, projected);
  if (deviation > tolerance) return null;
  return {
    kind: 'fromPoint',
    direction: d,
    origin: source,
    point: projected,
    deviation,
    tooltip: 'From Point',
    colorHex: COLOR.tracking,
  };
}

// ---------------------------------------------------------------------------
// Cross-context handling — §2.5.2
// ---------------------------------------------------------------------------

export interface ContextTransforms {
  /** World from local, for the context the candidate came from. */
  readonly toWorld: (p: Vec3, context?: ContainerId) => Vec3;
  /** Local from world, for the ACTIVE context. */
  readonly toActiveLocal: (p: Vec3) => Vec3;
  /** Uses the inverse transpose. Never the plain inverse. §2.5.2 */
  readonly normalToActiveLocal: (n: Vec3) => Vec3;
}

/**
 * Converts a candidate found in another container into the active context's
 * local frame, ready to commit.
 *
 * The snap is honoured for POSITION; the edge is still created in the active
 * context. Getting this wrong leaks a parent-frame point into a child graph,
 * where it lands somewhere visibly wrong the moment the container moves.
 */
export function toActiveContext(
  candidate: KernelCandidate,
  t: ContextTransforms,
): KernelCandidate {
  const world = t.toWorld(candidate.point, candidate.context);
  const local = t.toActiveLocal(world);
  return {
    ...candidate,
    point: local,
    ...(candidate.edgeVector
      ? { edgeVector: t.normalToActiveLocal(candidate.edgeVector) }
      : {}),
    ...(candidate.planeNormal
      ? { planeNormal: t.normalToActiveLocal(candidate.planeNormal) }
      : {}),
  };
}

export { distance, normalize };
