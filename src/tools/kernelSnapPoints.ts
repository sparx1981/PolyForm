/**
 * PolyForm — snap points from the geometry kernel.
 *
 * Viewport collects its own snap candidates from `shapes` and picks the
 * nearest on screen. Kernel geometry is a separate representation, so it is
 * invisible to that pass — which is why a line cannot snap to a previously
 * drawn edge.
 *
 * This produces candidates in the exact shape that pass already uses, so the
 * integration is one loop rather than a rework. Deliberately NOT wired
 * through PolyformInferenceEngine: that engine is used elsewhere, and this
 * site has its own simpler collection. Matching what is here beats imposing a
 * second mechanism.
 *
 * Pure and testable: no three.js, no projection, no screen space. The caller
 * projects and measures.
 */

import type { Graph, Vec3 } from '../lib/geometry/types';
import { edgePoints, loopPoints } from '../lib/geometry/topology';
import { midpoint } from '../lib/geometry/math';

/** Matches Viewport's existing candidate vocabulary. */
export type SnapKind = 'endpoint' | 'midpoint' | 'center';

export interface KernelSnapPoint {
  readonly point: Vec3;
  readonly kind: SnapKind;
  /** Stable id, useful for debugging and for de-duplication. */
  readonly id: string;
}

export interface SnapPointOptions {
  /** Include edge midpoints. Default true. */
  readonly midpoints?: boolean;
  /** Include face centroids. Default true. */
  readonly faceCentres?: boolean;
  /**
   * Cap the number of points returned per kind. A dense model would
   * otherwise hand the caller thousands of candidates to project on every
   * mouse move.
   */
  readonly maxPerKind?: number;
}

/**
 * Every snappable point in the kernel graph.
 *
 * Ordering is deterministic — sorted by id — so the candidate list does not
 * reshuffle between frames and a snap cannot flicker between two equals.
 */
export function collectKernelSnapPoints(
  g: Graph,
  opts: SnapPointOptions = {},
): KernelSnapPoint[] {
  const wantMid = opts.midpoints !== false;
  const wantFaces = opts.faceCentres !== false;
  const cap = opts.maxPerKind ?? 2000;

  const out: KernelSnapPoint[] = [];

  // Endpoints. Highest value by far: this is what closes a loop.
  let n = 0;
  for (const [id, v] of [...g.vertices].sort((a, b) => a[0] - b[0])) {
    if (n++ >= cap) break;
    out.push({ point: v.position, kind: 'endpoint', id: `kv${id}` });
  }

  if (wantMid) {
    n = 0;
    for (const [id, e] of [...g.edges].sort((a, b) => a[0] - b[0])) {
      if (n++ >= cap) break;
      const [a, b] = edgePoints(g, e);
      out.push({ point: midpoint(a, b), kind: 'midpoint', id: `ke${id}` });
    }
  }

  if (wantFaces) {
    n = 0;
    for (const [id, f] of [...g.faces].sort((a, b) => a[0] - b[0])) {
      if (n++ >= cap) break;
      const pts = loopPoints(g, f.outerLoop);
      if (pts.length < 3) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const p of pts) {
        x += p.x;
        y += p.y;
        z += p.z;
      }
      out.push({
        point: { x: x / pts.length, y: y / pts.length, z: z / pts.length },
        kind: 'center',
        id: `kf${id}`,
      });
    }
  }

  return out;
}

/**
 * Points lying on kernel edges, for an "on edge" snap along a cursor ray.
 *
 * Separate from the list above because it depends on the cursor and so must
 * be recomputed every move, whereas the vertex and midpoint set only changes
 * when the model does and can be cached against the kernel revision.
 */
export function closestPointsOnKernelEdges(
  g: Graph,
  near: Vec3,
  maxDistance: number,
): KernelSnapPoint[] {
  const out: KernelSnapPoint[] = [];
  for (const [id, e] of [...g.edges].sort((a, b) => a[0] - b[0])) {
    const [a, b] = edgePoints(g, e);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const lenSq = abx * abx + aby * aby + abz * abz;
    if (lenSq === 0) continue;
    let t = ((near.x - a.x) * abx + (near.y - a.y) * aby + (near.z - a.z) * abz) / lenSq;
    t = Math.min(1, Math.max(0, t));
    const p = { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t };
    const d = Math.hypot(p.x - near.x, p.y - near.y, p.z - near.z);
    if (d <= maxDistance) out.push({ point: p, kind: 'endpoint', id: `koe${id}` });
  }
  return out;
}
