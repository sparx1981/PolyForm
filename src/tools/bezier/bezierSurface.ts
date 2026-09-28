/**
 * PolyForm — a closed Bézier curve committed as a kernel surface.
 *
 * Shared by the Bézier tool and `sdk.drawing.bezier`, so a script draws exactly what the tool
 * draws: the curve is tessellated, flattened onto its drawing plane, committed like the other
 * shape tools (one undo step, an isolated shape), and its knots kept on the surface so the
 * curve can be edited later.
 */

import * as THREE from 'three';
import type { FaceId, Vec3 } from '../../lib/geometry/types';
import { checkSelfIntersection, projectToPlane } from '../../lib/planarPolygon';
import { tessellateEntireCurve } from './tessellate';
import type { BezierKnot, HandleMode } from './types';
import type { KernelArcHost } from '../kernelArcHost';

type Point = [number, number, number];

export interface BezierKnotInput {
  point: Point;
  handleIn?: Point | null;
  handleOut?: Point | null;
  mode?: HandleMode;
}

export interface BezierSurfaceOutcome {
  ok: boolean;
  faces: number[];
  /** Points in the committed outline. */
  points: number;
  /** Why nothing was drawn: 'too few points', 'crosses itself', or the kernel's reason. */
  reason?: string;
}

const vec = (p: Point) => new THREE.Vector3(p[0], p[1], p[2]);

export function commitBezierSurface(
  host: KernelArcHost,
  input: readonly BezierKnotInput[],
  resolution: number,
  normalIn: Vec3 = { x: 0, y: 1, z: 0 },
): BezierSurfaceOutcome {
  const knots: BezierKnot[] = input.map(k => ({
    point: vec(k.point),
    handleIn: k.handleIn ? vec(k.handleIn) : null,
    handleOut: k.handleOut ? vec(k.handleOut) : null,
    mode: k.mode ?? 'mirrored',
  }));
  if (knots.length < 2) return { ok: false, faces: [], points: 0, reason: 'too few points' };
  const tessPts = tessellateEntireCurve(knots, true, resolution);
  if (tessPts.length < 3) return { ok: false, faces: [], points: 0, reason: 'too few points' };

  const origin = knots[0]!.point.clone();
  const normal = new THREE.Vector3(normalIn.x, normalIn.y, normalIn.z).normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  // A closed curve's tessellation ends back on its first point: drop that (and any repeated
  // points), or the ring touches itself there and reads as crossing itself.
  const ringPts = tessPts.map(p => plane.projectPoint(p, new THREE.Vector3()))
    .filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-6);
  while (ringPts.length > 3 && ringPts[ringPts.length - 1]!.distanceTo(ringPts[0]!) < 1e-6) ringPts.pop();
  if (checkSelfIntersection(projectToPlane(ringPts, origin, normal))) return { ok: false, faces: [], points: 0, reason: 'crosses itself' };

  const committed = host.commitIsolatedRing(ringPts.map(p => ({ x: p.x, y: p.y, z: p.z })));
  if (!committed.ok) return { ok: false, faces: [], points: 0, reason: committed.reason ?? 'unknown error' };
  const stored = input.map(k => ({
    point: [...k.point],
    handleIn: k.handleIn ? [...k.handleIn] : null,
    handleOut: k.handleOut ? [...k.handleOut] : null,
    mode: k.mode ?? 'mirrored',
  }));
  for (const fid of committed.faces) {
    const face = host.graph.faces.get(fid as FaceId);
    if (face) face.attributes.custom.bezier = { knots: stored, resolution };
  }
  return { ok: true, faces: committed.faces, points: ringPts.length };
}
