/**
 * PolyForm geometry kernel — 2D polygon operations.
 *
 * These run on points already projected into a plane's basis (see math.ts
 * projectToBasis). Winding is interpreted from that basis: positive signed
 * area means counter-clockwise viewed from the front of the plane. §6.4
 */

import type { Vec2 } from './types';

// ---------------------------------------------------------------------------
// Area and winding — §6.4
// ---------------------------------------------------------------------------

/**
 * Shoelace signed area. Positive = counter-clockwise = outer loop convention.
 *
 * Needed twice over: to reject sliver cycles by magnitude (§6.2) and to
 * enforce loop winding (§6.4). Computing it once and reusing it is why the
 * sliver test is an area test rather than an aspect-ratio one.
 */
export function signedArea(points: readonly Vec2[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export const area = (points: readonly Vec2[]): number => Math.abs(signedArea(points));

export const isCounterClockwise = (points: readonly Vec2[]): boolean => signedArea(points) > 0;

/** Returns a copy wound in the requested direction. Does not mutate. */
export function withWinding(points: readonly Vec2[], counterClockwise: boolean): Vec2[] {
  const ccw = isCounterClockwise(points);
  return ccw === counterClockwise ? [...points] : [...points].reverse();
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

/**
 * Ray-crossing containment test. Points exactly on the boundary are not
 * guaranteed either way — callers that care should use a strictly interior
 * point (see interiorPoint) rather than a boundary one.
 */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Containment in a face: inside the outer loop and outside every hole.
 * Used by attribute reattachment to match a new face to an old one. §6.3
 */
export function pointInPolygonWithHoles(
  p: Vec2,
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): boolean {
  if (!pointInPolygon(p, outer)) return false;
  for (const hole of holes) if (pointInPolygon(p, hole)) return false;
  return true;
}

/** Distance from a point to a polygon's boundary. Zero when exactly on it. */
export function distanceToBoundary(p: Vec2, polygon: readonly Vec2[]): number {
  const n = polygon.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Interior point — §6.3
// ---------------------------------------------------------------------------

const crossZ = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = crossZ(a, b, p);
  const d2 = crossZ(b, c, p);
  const d3 = crossZ(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * A point guaranteed to lie strictly inside a simple polygon, convex or not.
 *
 * NOT the centroid. The centroid of a concave polygon — an L-shape, a
 * horseshoe, a room with a bay — frequently falls outside it, and attribute
 * reattachment (§6.3) matches new faces to old ones by testing which old
 * polygon contains a new face's representative point. A centroid that lands
 * outside silently transplants the wrong material onto the wrong region.
 *
 * Method: the leftmost vertex `b` is necessarily convex. If no reflex vertex
 * lies inside triangle (a, b, c) formed with its neighbours, the midpoint of
 * a-c is interior. Otherwise the midpoint of `b` and the reflex vertex
 * farthest from line a-c is interior. This is exact rather than heuristic.
 */
export function interiorPoint(polygon: readonly Vec2[]): Vec2 | null {
  const n = polygon.length;
  if (n < 3) return null;

  const ccw = withWinding(polygon, true);

  // Leftmost vertex, tie-broken by lowest y. Guaranteed convex.
  let bi = 0;
  for (let i = 1; i < n; i++) {
    const p = ccw[i]!;
    const best = ccw[bi]!;
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) bi = i;
  }

  const a = ccw[(bi - 1 + n) % n]!;
  const b = ccw[bi]!;
  const c = ccw[(bi + 1) % n]!;

  // Any reflex vertex intruding into the ear?
  let bestVertex: Vec2 | null = null;
  let bestDist = -Infinity;
  const abx = c.x - a.x;
  const aby = c.y - a.y;
  const acLen = Math.hypot(abx, aby);

  for (let i = 0; i < n; i++) {
    if (i === bi || i === (bi - 1 + n) % n || i === (bi + 1) % n) continue;
    const p = ccw[i]!;
    if (!pointInTriangle(p, a, b, c)) continue;
    const prev = ccw[(i - 1 + n) % n]!;
    const next = ccw[(i + 1) % n]!;
    if (crossZ(prev, p, next) > 0) continue; // convex, cannot block the ear
    const d = acLen > 0 ? Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx) / acLen : 0;
    if (d > bestDist) {
      bestDist = d;
      bestVertex = p;
    }
  }

  const q = bestVertex ?? a;
  const other = bestVertex ? b : c;
  const result = { x: (q.x + other.x) / 2, y: (q.y + other.y) / 2 };

  // Cheap correctness net. If the exact construction somehow fails on
  // degenerate input, fall back rather than returning a point outside.
  if (pointInPolygon(result, ccw)) return result;
  return fallbackInteriorPoint(ccw);
}

/**
 * Scanline fallback: cast a horizontal ray through a y between two distinct
 * vertex heights and take the midpoint of the first interior span.
 */
function fallbackInteriorPoint(polygon: readonly Vec2[]): Vec2 | null {
  const ys = [...new Set(polygon.map((p) => p.y))].sort((m, o) => m - o);
  if (ys.length < 2) return null;

  for (let k = 0; k < ys.length - 1; k++) {
    const y = (ys[k]! + ys[k + 1]!) / 2;
    const xs: number[] = [];
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p = polygon[i]!;
      const q = polygon[j]!;
      if (p.y > y !== q.y > y) xs.push(((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x);
    }
    xs.sort((m, o) => m - o);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      if (x1 - x0 > 0) return { x: (x0 + x1) / 2, y };
    }
  }
  return null;
}

/**
 * An interior point that also avoids the holes — the version attribute
 * reattachment actually needs for a face with inner loops. §6.3
 */
export function interiorPointWithHoles(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): Vec2 | null {
  const candidate = interiorPoint(outer);
  if (candidate && pointInPolygonWithHoles(candidate, outer, holes)) return candidate;

  // The simple interior point landed in a hole. Walk scanlines and take the
  // first span that is inside the outer loop and outside every hole.
  const allY = [
    ...new Set([...outer, ...holes.flat()].map((p) => p.y)),
  ].sort((m, o) => m - o);

  for (let k = 0; k + 1 < allY.length; k++) {
    const y = (allY[k]! + allY[k + 1]!) / 2;
    const xs = new Set<number>();
    for (const ring of [outer, ...holes]) {
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const p = ring[i]!;
        const q = ring[j]!;
        if (p.y > y !== q.y > y) xs.add(((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x);
      }
    }
    const sorted = [...xs].sort((m, o) => m - o);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const mid = { x: (sorted[i]! + sorted[i + 1]!) / 2, y };
      if (pointInPolygonWithHoles(mid, outer, holes)) return mid;
    }
  }
  return null;
}
