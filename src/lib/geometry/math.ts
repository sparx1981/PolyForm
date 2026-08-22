/**
 * PolyForm geometry kernel — vector, plane and intersection maths.
 *
 * Double precision throughout. Never store these values in a Float32Array:
 * typed arrays belong at the GPU buffer boundary only. At 10^6 units from the
 * origin, f32 resolves to ~0.06 units — sixty times coarser than
 * COPLANARITY_TOLERANCE — and faces silently stop deriving. §10.3
 *
 * Spec references are to polyform-line-and-arc-tools-spec.md.
 */

import type { Vec2, Vec3, Plane, PlaneBasis } from './types';

// ---------------------------------------------------------------------------
// Construction and basic operations
// ---------------------------------------------------------------------------

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const AXIS_X: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });
export const AXIS_Y: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });
export const AXIS_Z: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const negate = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export const distanceSq = (a: Vec3, b: Vec3): number => lengthSq(sub(a, b));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const midpoint = (a: Vec3, b: Vec3): Vec3 => lerp(a, b, 0.5);

/** Every component finite — guards against NaN entering the graph. */
export const isFinite3 = (a: Vec3): boolean =>
  Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/**
 * Thrown by normalize() on a zero-length vector.
 *
 * The alternative — returning NaN — is far worse: NaN propagates silently,
 * every subsequent tolerance comparison returns false, and geometry simply
 * stops deriving with no error raised anywhere. Failing loudly here saves days
 * across every later phase. §10.3
 */
export class ZeroLengthVectorError extends Error {
  constructor(context?: string) {
    super(
      `Cannot normalize a zero-length vector${context ? ` (${context})` : ''}. ` +
        `This usually means two points were expected to differ but did not.`,
    );
    this.name = 'ZeroLengthVectorError';
  }
}

/** Throws rather than returning NaN. See ZeroLengthVectorError. */
export function normalize(a: Vec3, context?: string): Vec3 {
  const len = length(a);
  if (!(len > 0) || !Number.isFinite(len)) throw new ZeroLengthVectorError(context);
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/** Returns null instead of throwing, for paths that legitimately expect degeneracy. */
export function tryNormalize(a: Vec3): Vec3 | null {
  const len = length(a);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

// ---------------------------------------------------------------------------
// Angular relationships
// ---------------------------------------------------------------------------

/**
 * |a x b| / (|a||b|) — the sine of the angle between two directions.
 * Used for parallelism and colinearity tests, which is why the thresholds
 * that consume it (COLINEARITY_TOLERANCE, MIN_CROSS_MAGNITUDE) are angles.
 */
export function sinAngleBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (!(la > 0) || !(lb > 0)) return 0;
  return length(cross(a, b)) / (la * lb);
}

/**
 * Parallel OR anti-parallel — direction-agnostic, as colinearity requires.
 * `toleranceRad` is compared as a sine, valid for the small angles in use.
 */
export function areColinearDirections(a: Vec3, b: Vec3, toleranceRad: number): boolean {
  return sinAngleBetween(a, b) <= Math.sin(toleranceRad);
}

/** Same direction (dot > 0) rather than merely colinear. */
export function areSameDirection(a: Vec3, b: Vec3, toleranceRad: number): boolean {
  return areColinearDirections(a, b, toleranceRad) && dot(a, b) > 0;
}

// ---------------------------------------------------------------------------
// Planes — §3, §6
// ---------------------------------------------------------------------------

/**
 * Best-fit plane normal by Newell's method.
 *
 * Newell rather than a cross product of the first three points: it is stable
 * for non-convex polygons, for near-degenerate triangles, and for vertices
 * that are very nearly colinear — all of which occur constantly in real
 * drawn geometry. Returns null when the points span no plane at all.
 */
export function newellNormal(points: readonly Vec3[]): Vec3 | null {
  const n = points.length;
  if (n < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const c = points[i]!;
    const d = points[(i + 1) % n]!;
    nx += (c.y - d.y) * (c.z + d.z);
    ny += (c.z - d.z) * (c.x + d.x);
    nz += (c.x - d.x) * (c.y + d.y);
  }
  return tryNormalize({ x: nx, y: ny, z: nz });
}

export function centroid(points: readonly Vec3[]): Vec3 {
  const n = points.length;
  if (n === 0) return ZERO;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Best-fit plane through an ORDERED point loop, via Newell.
 *
 * Requires loop order. For an unordered set use bestFitPlane — Newell over a
 * scattered cloud is meaningless, because the sum depends on the arbitrary
 * iteration order, and it fails silently by returning a plausible-looking
 * garbage normal.
 */
export function planeFromPoints(points: readonly Vec3[]): Plane | null {
  const normal = newellNormal(points);
  if (!normal) return null;
  return { point: centroid(points), normal };
}

/**
 * Least-squares plane through an UNORDERED point cloud.
 *
 * Covariance matrix, then the normal selected by the largest of the three
 * 2x2 determinants — the standard robust formulation, and it avoids needing
 * an eigenvalue solver. Returns null for points that are colinear or
 * coincident, where no plane is determined.
 */
export function bestFitPlane(points: readonly Vec3[]): Plane | null {
  const n = points.length;
  if (n < 3) return null;
  const c = centroid(points);

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
    xx += rx * rx; xy += rx * ry; xz += rx * rz;
    yy += ry * ry; yz += ry * rz; zz += rz * rz;
  }

  const detX = yy * zz - yz * yz;
  const detY = xx * zz - xz * xz;
  const detZ = xx * yy - xy * xy;
  const detMax = Math.max(detX, detY, detZ);
  if (!(detMax > 0)) return null; // colinear or coincident

  let normal: Vec3;
  if (detMax === detX) {
    normal = { x: detX, y: xz * yz - xy * zz, z: xy * yz - xz * yy };
  } else if (detMax === detY) {
    normal = { x: xz * yz - xy * zz, y: detY, z: xy * xz - yz * xx };
  } else {
    normal = { x: xy * yz - xz * yy, y: xy * xz - yz * xx, z: detZ };
  }

  const unit = tryNormalize(normal);
  return unit ? { point: c, normal: unit } : null;
}

/** Signed: positive on the side the normal points towards. */
export const signedDistanceToPlane = (p: Vec3, plane: Plane): number =>
  dot(sub(p, plane.point), plane.normal);

export const distanceToPlane = (p: Vec3, plane: Plane): number =>
  Math.abs(signedDistanceToPlane(p, plane));

export const projectOntoPlane = (p: Vec3, plane: Plane): Vec3 =>
  sub(p, scale(plane.normal, signedDistanceToPlane(p, plane)));

/**
 * Do these points lie on a common plane within tolerance?
 *
 * Reports the deviation as well as the verdict, because §3 requires a passive
 * hint when a cycle *just* misses — "edges don't lie on one plane" is far more
 * useful to a user than a surface silently failing to appear.
 */
export function coplanarity(
  points: readonly Vec3[],
  tolerance: number,
): { coplanar: boolean; deviation: number; plane: Plane | null } {
  if (points.length < 3) return { coplanar: true, deviation: 0, plane: null };
  const plane = bestFitPlane(points) ?? planeFromPoints(points);
  if (!plane) return { coplanar: false, deviation: Infinity, plane: null };
  let deviation = 0;
  for (let i = 0; i < points.length; i++) {
    const d = distanceToPlane(points[i]!, plane);
    if (d > deviation) deviation = d;
  }
  return { coplanar: deviation <= tolerance, deviation, plane };
}

export const arePointsCoplanar = (points: readonly Vec3[], tolerance: number): boolean =>
  coplanarity(points, tolerance).coplanar;

// ---------------------------------------------------------------------------
// 2D basis — projection and unprojection
// ---------------------------------------------------------------------------

/**
 * An orthonormal basis for a plane, chosen deterministically.
 *
 * The seed axis is whichever cardinal axis the normal is *least* aligned with,
 * which keeps the cross product well-conditioned. Determinism matters: the
 * same plane must always produce the same basis, or 2D coordinates — and
 * therefore signed areas and winding — vary between runs. §10.3
 */
export function planeBasis(plane: Plane): PlaneBasis {
  const n = normalize(plane.normal, 'planeBasis normal');
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const seed = ax <= ay && ax <= az ? AXIS_X : ay <= az ? AXIS_Y : AXIS_Z;
  const u = normalize(cross(seed, n), 'planeBasis u');
  const v = cross(n, u); // already unit: n and u are orthonormal
  return { origin: plane.point, u, v, normal: n };
}

export function projectToBasis(p: Vec3, basis: PlaneBasis): Vec2 {
  const d = sub(p, basis.origin);
  return { x: dot(d, basis.u), y: dot(d, basis.v) };
}

export function unprojectFromBasis(p: Vec2, basis: PlaneBasis): Vec3 {
  return add(basis.origin, add(scale(basis.u, p.x), scale(basis.v, p.y)));
}

// ---------------------------------------------------------------------------
// Segment intersection — §6.2 Phase 1a
// ---------------------------------------------------------------------------

export interface SegmentIntersection {
  readonly point: Vec3;
  /** Parameter along the first segment, 0..1. */
  readonly t: number;
  /** Parameter along the second segment, 0..1. */
  readonly s: number;
  readonly atEndpointA: boolean;
  readonly atEndpointB: boolean;
}

/**
 * Intersection of two 3D segments, within tolerance.
 *
 * Returns null when the segments are parallel or colinear. That is deliberate,
 * not an omission: colinear overlap is a different operation with different
 * semantics (subdivide the shared span, keep the existing edge) and is handled
 * by Phase 4b under R2b. Feeding a colinear pair to this solver divides by a
 * vanishing denominator and yields an arbitrary point, so the caller must
 * filter them out first. §6.2 Phase 1a
 */
export function segmentIntersection3D(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
  tolerance: number,
): SegmentIntersection | null {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const n = cross(d1, d2);
  const denom = lengthSq(n);

  // Parallel or colinear. Guard scaled by the segment lengths so the test is
  // an angular one rather than a length-dependent one.
  const scaleGuard = lengthSq(d1) * lengthSq(d2);
  if (scaleGuard === 0) return null;
  if (denom / scaleGuard < 1e-16) return null;

  const r = sub(b0, a0);
  const t = dot(cross(r, d2), n) / denom;
  const s = dot(cross(r, d1), n) / denom;

  // Parameter tolerance derived from the segment length, so a fixed spatial
  // tolerance means the same thing on a 1mm edge and a 100m one.
  const lenA = Math.sqrt(lengthSq(d1));
  const lenB = Math.sqrt(lengthSq(d2));
  const tEps = lenA > 0 ? tolerance / lenA : 0;
  const sEps = lenB > 0 ? tolerance / lenB : 0;

  if (t < -tEps || t > 1 + tEps || s < -sEps || s > 1 + sEps) return null;

  const pa = add(a0, scale(d1, t));
  const pb = add(b0, scale(d2, s));
  // Skew lines pass without touching; only a genuine crossing counts.
  if (distance(pa, pb) > tolerance) return null;

  const tc = Math.min(1, Math.max(0, t));
  const sc = Math.min(1, Math.max(0, s));
  return {
    point: midpoint(pa, pb),
    t: tc,
    s: sc,
    atEndpointA: tc <= tEps || tc >= 1 - tEps,
    atEndpointB: sc <= sEps || sc >= 1 - sEps,
  };
}

/** True when two segments share a direction and lie on a common line. R2b */
export function areSegmentsColinear(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
  angleTolerance: number,
  distanceTolerance: number,
): boolean {
  const d1 = tryNormalize(sub(a1, a0));
  const d2 = tryNormalize(sub(b1, b0));
  if (!d1 || !d2) return false;
  if (!areColinearDirections(d1, d2, angleTolerance)) return false;
  // Same direction is not enough — the lines must also coincide.
  return (
    distancePointToLine(b0, a0, d1) <= distanceTolerance &&
    distancePointToLine(b1, a0, d1) <= distanceTolerance
  );
}

/** Perpendicular distance from a point to an infinite line. */
export function distancePointToLine(p: Vec3, origin: Vec3, direction: Vec3): number {
  const d = sub(p, origin);
  return length(cross(d, direction)) / length(direction);
}

export interface ClosestPointOnSegment {
  readonly point: Vec3;
  /** Clamped to 0..1. */
  readonly t: number;
  readonly distance: number;
}

export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): ClosestPointOnSegment {
  const ab = sub(b, a);
  const lenSq = lengthSq(ab);
  if (lenSq === 0) return { point: a, t: 0, distance: distance(p, a) };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / lenSq));
  const point = add(a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}
