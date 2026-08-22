import { describe, it, expect } from 'vitest';
import {
  vec3, add, sub, scale, dot, cross, length, distance, midpoint,
  normalize, tryNormalize, ZeroLengthVectorError,
  sinAngleBetween, areColinearDirections, areSameDirection,
  newellNormal, centroid, planeFromPoints, signedDistanceToPlane,
  distanceToPlane, projectOntoPlane, coplanarity, arePointsCoplanar,
  planeBasis, projectToBasis, unprojectFromBasis,
  segmentIntersection3D, areSegmentsColinear, distancePointToLine,
  closestPointOnSegment, isFinite3,
} from './math';
import { DEFAULT_TOLERANCES as T } from './types';

const near = (a: number, b: number, p = 10) => expect(a).toBeCloseTo(b, p);

describe('normalize', () => {
  it('throws on a zero-length vector rather than returning NaN', () => {
    // NaN propagates silently: every later tolerance comparison returns false
    // and geometry stops deriving with no error anywhere. §10.3
    expect(() => normalize(vec3(0, 0, 0))).toThrow(ZeroLengthVectorError);
  });

  it('names the context in the error so the caller is identifiable', () => {
    expect(() => normalize(vec3(0, 0, 0), 'arc tangent')).toThrow(/arc tangent/);
  });

  it('throws on NaN input too', () => {
    expect(() => normalize(vec3(NaN, 0, 0))).toThrow(ZeroLengthVectorError);
  });

  it('offers a non-throwing variant for paths that expect degeneracy', () => {
    expect(tryNormalize(vec3(0, 0, 0))).toBeNull();
    near(length(tryNormalize(vec3(3, 4, 0))!), 1);
  });

  it('produces unit length', () => near(length(normalize(vec3(1, 2, 3))), 1));
});

describe('vector basics', () => {
  it('computes dot and cross correctly', () => {
    expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    const c = cross(vec3(1, 0, 0), vec3(0, 1, 0));
    expect([c.x, c.y, c.z]).toEqual([0, 0, 1]);
  });

  it('holds precision far from the origin', () => {
    // At 10^6 units, f64 spacing is ~2.3e-10, so a 1e-4 nudge is resolved to
    // roughly 6 significant figures. In f32 the spacing is ~0.125 — the nudge
    // would vanish entirely and the two points would compare equal, which is
    // how "faces stop deriving, but only in models built far from origin"
    // happens. Assert relative error, not absolute. §10.3
    const far = vec3(1e6, 1e6, 1e6);
    const nudged = add(far, vec3(1e-4, 0, 0));
    const measured = distance(far, nudged);
    expect(measured).toBeGreaterThan(0);
    expect(Math.abs(measured - 1e-4) / 1e-4).toBeLessThan(1e-5);

    // The same nudge through f32 storage is lost completely.
    const f32 = new Float32Array([1e6, 1e6 + 1e-4]);
    expect(f32[1]! - f32[0]!).toBe(0);
  });

  it('detects non-finite components', () => {
    expect(isFinite3(vec3(1, 2, 3))).toBe(true);
    expect(isFinite3(vec3(1, NaN, 3))).toBe(false);
  });

  it('midpoint sits halfway', () => {
    const m = midpoint(vec3(0, 0, 0), vec3(2, 4, 6));
    expect([m.x, m.y, m.z]).toEqual([1, 2, 3]);
  });
});

describe('colinearity', () => {
  it('treats anti-parallel directions as colinear', () => {
    // R2b and R7 both care about the line, not the direction of travel.
    expect(areColinearDirections(vec3(1, 0, 0), vec3(-1, 0, 0), T.COLINEARITY_TOLERANCE)).toBe(true);
    expect(areSameDirection(vec3(1, 0, 0), vec3(-1, 0, 0), T.COLINEARITY_TOLERANCE)).toBe(false);
  });

  it('discriminates either side of COLINEARITY_TOLERANCE', () => {
    const tol = T.COLINEARITY_TOLERANCE; // 0.1 degrees
    const inside = 0.05 * (Math.PI / 180);
    const outside = 0.2 * (Math.PI / 180);
    const a = vec3(1, 0, 0);
    expect(areColinearDirections(a, vec3(Math.cos(inside), Math.sin(inside), 0), tol)).toBe(true);
    expect(areColinearDirections(a, vec3(Math.cos(outside), Math.sin(outside), 0), tol)).toBe(false);
  });

  it('sinAngleBetween returns a sine', () => {
    near(sinAngleBetween(vec3(1, 0, 0), vec3(0, 1, 0)), 1);
    near(sinAngleBetween(vec3(1, 0, 0), vec3(1, 0, 0)), 0);
  });
});

describe('planes', () => {
  it('fits a normal by Newell for a non-convex loop', () => {
    // An L-shape in the XY plane. A cross product of the first three points
    // would work here, but fails on loops that start with colinear vertices.
    const pts = [
      vec3(0, 0, 0), vec3(2, 0, 0), vec3(2, 1, 0),
      vec3(1, 1, 0), vec3(1, 2, 0), vec3(0, 2, 0),
    ];
    const n = newellNormal(pts)!;
    near(Math.abs(n.z), 1);
    near(n.x, 0);
    near(n.y, 0);
  });

  it('survives a loop whose first three points are colinear', () => {
    const pts = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0), vec3(2, 2, 0)];
    expect(newellNormal(pts)).not.toBeNull();
  });

  it('returns null for wholly colinear points', () => {
    expect(newellNormal([vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0)])).toBeNull();
  });

  it('reports coplanarity deviation, not just a verdict', () => {
    // §3 requires a passive hint when a cycle *just* misses, so the deviation
    // has to come back with the answer.
    const pts = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(1, 1, 0), vec3(0, 1, 0.01)];
    const r = coplanarity(pts, T.COPLANARITY_TOLERANCE);
    expect(r.coplanar).toBe(false);
    expect(r.deviation).toBeGreaterThan(T.COPLANARITY_TOLERANCE);
    expect(r.deviation).toBeLessThan(0.02);
  });

  it('holds coplanarity for a plane built 10^6 units from the origin', () => {
    const o = 1e6;
    const pts = [
      vec3(o, o, o), vec3(o + 1, o, o), vec3(o + 1, o + 1, o), vec3(o, o + 1, o),
    ];
    expect(arePointsCoplanar(pts, T.COPLANARITY_TOLERANCE)).toBe(true);
  });

  it('discriminates either side of COPLANARITY_TOLERANCE', () => {
    const base = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(1, 1, 0)];
    expect(arePointsCoplanar([...base, vec3(0, 1, 5e-4)], T.COPLANARITY_TOLERANCE)).toBe(true);
    expect(arePointsCoplanar([...base, vec3(0, 1, 5e-3)], T.COPLANARITY_TOLERANCE)).toBe(false);
  });

  it('projects a point onto a plane', () => {
    const plane = { point: vec3(0, 0, 0), normal: vec3(0, 0, 1) };
    expect(signedDistanceToPlane(vec3(1, 1, 5), plane)).toBe(5);
    expect(distanceToPlane(vec3(1, 1, -5), plane)).toBe(5);
    const p = projectOntoPlane(vec3(1, 1, 5), plane);
    near(p.z, 0);
  });
});

describe('plane basis', () => {
  it('round-trips a point through projection and unprojection', () => {
    const plane = planeFromPoints([vec3(1, 2, 3), vec3(4, 0, 1), vec3(0, 5, 2)])!;
    const basis = planeBasis(plane);
    const p = projectOntoPlane(vec3(2, 2, 2), plane);
    const back = unprojectFromBasis(projectToBasis(p, basis), basis);
    near(distance(p, back), 0, 9);
  });

  it('is orthonormal', () => {
    const b = planeBasis({ point: vec3(0, 0, 0), normal: normalize(vec3(1, 2, 3)) });
    near(length(b.u), 1);
    near(length(b.v), 1);
    near(dot(b.u, b.v), 0);
    near(dot(b.u, b.normal), 0);
  });

  it('is deterministic for the same plane', () => {
    // 2D coordinates, signed areas and winding all depend on this. §10.3
    const plane = { point: vec3(0, 0, 0), normal: normalize(vec3(0.3, 0.9, 0.1)) };
    const a = planeBasis(plane);
    const b = planeBasis(plane);
    expect(a.u).toEqual(b.u);
    expect(a.v).toEqual(b.v);
  });

  it('stays well-conditioned for axis-aligned normals', () => {
    for (const n of [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)]) {
      const b = planeBasis({ point: vec3(0, 0, 0), normal: n });
      near(length(b.u), 1);
      near(dot(b.u, b.v), 0);
    }
  });
});

describe('segment intersection', () => {
  it('finds a crossing in a plane', () => {
    const r = segmentIntersection3D(
      vec3(-1, 0, 0), vec3(1, 0, 0),
      vec3(0, -1, 0), vec3(0, 1, 0),
      T.VERTEX_MERGE_TOLERANCE,
    )!;
    expect(r).not.toBeNull();
    near(r.point.x, 0);
    near(r.point.y, 0);
    near(r.t, 0.5);
    near(r.s, 0.5);
    expect(r.atEndpointA).toBe(false);
  });

  it('returns null for colinear segments', () => {
    // Deliberate. Colinear overlap is Phase 4b's job under R2b, and feeding a
    // colinear pair to this solver divides by a vanishing denominator. §6.2
    expect(segmentIntersection3D(
      vec3(0, 0, 0), vec3(2, 0, 0),
      vec3(1, 0, 0), vec3(3, 0, 0),
      T.VERTEX_MERGE_TOLERANCE,
    )).toBeNull();
  });

  it('returns null for parallel but separated segments', () => {
    expect(segmentIntersection3D(
      vec3(0, 0, 0), vec3(1, 0, 0),
      vec3(0, 1, 0), vec3(1, 1, 0),
      T.VERTEX_MERGE_TOLERANCE,
    )).toBeNull();
  });

  it('returns null for skew lines that pass without touching', () => {
    expect(segmentIntersection3D(
      vec3(-1, 0, 0), vec3(1, 0, 0),
      vec3(0, -1, 1), vec3(0, 1, 1),
      T.VERTEX_MERGE_TOLERANCE,
    )).toBeNull();
  });

  it('finds skew lines that pass within tolerance', () => {
    const r = segmentIntersection3D(
      vec3(-1, 0, 0), vec3(1, 0, 0),
      vec3(0, -1, 5e-4), vec3(0, 1, 5e-4),
      T.VERTEX_MERGE_TOLERANCE,
    );
    expect(r).not.toBeNull();
  });

  it('returns null when the crossing lies beyond a segment end', () => {
    expect(segmentIntersection3D(
      vec3(0, 0, 0), vec3(1, 0, 0),
      vec3(5, -1, 0), vec3(5, 1, 0),
      T.VERTEX_MERGE_TOLERANCE,
    )).toBeNull();
  });

  it('flags a crossing at an endpoint', () => {
    const r = segmentIntersection3D(
      vec3(0, 0, 0), vec3(2, 0, 0),
      vec3(0, 0, 0), vec3(0, 2, 0),
      T.VERTEX_MERGE_TOLERANCE,
    )!;
    expect(r.atEndpointA).toBe(true);
    expect(r.atEndpointB).toBe(true);
  });

  it('scales its endpoint test with segment length', () => {
    // A fixed spatial tolerance must mean the same thing on a 1mm edge and a
    // 100m one, so the parameter epsilon is derived from the length.
    const r = segmentIntersection3D(
      vec3(0, 0, 0), vec3(100, 0, 0),
      vec3(50, -1, 0), vec3(50, 1, 0),
      T.VERTEX_MERGE_TOLERANCE,
    )!;
    expect(r.atEndpointA).toBe(false);
    near(r.t, 0.5);
  });
});

describe('colinear segment detection', () => {
  const ang = T.COLINEARITY_TOLERANCE;
  const dist = T.VERTEX_MERGE_TOLERANCE;

  it('detects an overlapping colinear pair', () => {
    expect(areSegmentsColinear(
      vec3(0, 0, 0), vec3(2, 0, 0), vec3(1, 0, 0), vec3(3, 0, 0), ang, dist,
    )).toBe(true);
  });

  it('detects a reversed colinear pair', () => {
    expect(areSegmentsColinear(
      vec3(0, 0, 0), vec3(2, 0, 0), vec3(3, 0, 0), vec3(1, 0, 0), ang, dist,
    )).toBe(true);
  });

  it('rejects parallel segments on different lines', () => {
    expect(areSegmentsColinear(
      vec3(0, 0, 0), vec3(2, 0, 0), vec3(0, 1, 0), vec3(2, 1, 0), ang, dist,
    )).toBe(false);
  });

  it('rejects a crossing pair', () => {
    expect(areSegmentsColinear(
      vec3(0, 0, 0), vec3(2, 0, 0), vec3(1, -1, 0), vec3(1, 1, 0), ang, dist,
    )).toBe(false);
  });
});

describe('point to line and segment', () => {
  it('measures perpendicular distance to an infinite line', () => {
    near(distancePointToLine(vec3(0, 3, 0), vec3(0, 0, 0), vec3(1, 0, 0)), 3);
  });

  it('clamps to the segment ends', () => {
    const r = closestPointOnSegment(vec3(-5, 1, 0), vec3(0, 0, 0), vec3(1, 0, 0));
    expect(r.t).toBe(0);
    near(r.distance, Math.hypot(5, 1));
  });

  it('handles a degenerate segment without dividing by zero', () => {
    const r = closestPointOnSegment(vec3(1, 0, 0), vec3(0, 0, 0), vec3(0, 0, 0));
    expect(Number.isFinite(r.distance)).toBe(true);
    near(r.distance, 1);
  });
});
