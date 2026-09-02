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
