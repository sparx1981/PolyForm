import * as THREE from 'three';
import { BezierKnot } from './types';

export function tessellateBezierSpan(
  k0: BezierKnot,
  k1: BezierKnot,
  divisions: number = 24
): THREE.Vector3[] {
  const p0 = k0.point;
  const p1 = k0.handleOut ?? k0.point;
  const p2 = k1.handleIn ?? k1.point;
  const p3 = k1.point;

  // A degenerate span (e.g. double-clicking to place two knots at the same
  // screen pixel, with no handles) has all four control points coincident.
  // THREE.CubicBezierCurve3 doesn't special-case this — it still returns
  // `divisions + 1` identical points, which downstream code (session
  // .drawChain) then has to tolerate/dedupe. Collapse it to a single point
  // instead of doing that wasted work and forwarding duplicate points.
  const EPS_SQ = 1e-12;
  if (
    p0.distanceToSquared(p1) < EPS_SQ &&
    p0.distanceToSquared(p2) < EPS_SQ &&
    p0.distanceToSquared(p3) < EPS_SQ
  ) {
    return [p0.clone()];
  }

  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  return curve.getPoints(divisions);
}

export function tessellateEntireCurve(
  knots: BezierKnot[],
  isClosed: boolean,
  divisionsPerSpan: number = 24
): THREE.Vector3[] {
  if (knots.length < 2) return knots.map(k => k.point.clone());

  const result: THREE.Vector3[] = [];
  const spanCount = isClosed ? knots.length : knots.length - 1;

  for (let i = 0; i < spanCount; i++) {
    const k0 = knots[i]!;
    const k1 = knots[(i + 1) % knots.length]!;
    const spanPoints = tessellateBezierSpan(k0, k1, divisionsPerSpan);

    if (i > 0) spanPoints.shift(); // Prevent duplicate overlapping vertices
    result.push(...spanPoints);
  }

  return result;
}
