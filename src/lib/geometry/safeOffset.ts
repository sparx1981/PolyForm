/**
 * PolyForm — a polygon offset that never folds over itself.
 *
 * The plain mitred offset (offsetPolygon2D) shifts every edge and joins
 * neighbours where their shifted lines meet. That is exact while every
 * edge survives, but once the offset passes a curve's radius (a Bézier or
 * circle drawn as many short edges) or a notch narrower than twice the
 * offset, edges run backwards and the outline turns inside out: loops,
 * spikes and crossed edges that corrupt the face derived from them.
 *
 * This version gives the result a CAD offset gives:
 *
 *  1. Edge collapse. Each shifted edge's length changes linearly with the
 *     offset; an edge whose length would reach zero before the requested
 *     offset is removed and its neighbours joined directly, earliest
 *     collapse first. This is the straight skeleton's "edge event", and
 *     it is what cleans tight curves and small notches.
 *  2. Mitre limit. A corner whose point would reach further than
 *     `miterLimit` times the offset from the original corner is cut flat
 *     there, instead of throwing out a long spike.
 *  3. Pinches. If the outline still crosses itself — a narrow neck
 *     pinching the shape into two — the true region (every point at least
 *     the offset from the original boundary) is rebuilt with polygon
 *     boolean operations, and its largest piece kept.
 */

import * as polygonClippingModule from 'polygon-clipping';
import type { Polygon, Ring } from 'polygon-clipping';
import type { Vec2 } from './types';

const clip = ((polygonClippingModule as unknown as { default?: typeof polygonClippingModule }).default
  ?? polygonClippingModule) as typeof polygonClippingModule;

export interface SafeOffsetResult {
  /** The offset outline, counter-clockwise; empty when nothing survives. */
  readonly points: Vec2[];
  readonly ok: boolean;
  readonly reason?: string;
  /** Edges removed because they vanished at this offset. */
  readonly collapsed: number;
  /** Corners cut flat by the mitre limit. */
  readonly bevelled: number;
  /** The offset pinched the shape into several pieces; only the largest was kept. */
  readonly split: boolean;
}

const EPS = 1e-9;

function signedArea(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const u = p[i]!;
    const v = p[(i + 1) % p.length]!;
    a += u.x * v.y - v.x * u.y;
  }
  return a / 2;
}

/** Drops repeated points and points on a straight line between their neighbours. */
function cleanRing(input: readonly Vec2[]): Vec2[] {
  let pts = input.filter((p, i) => {
    const q = input[(i + 1) % input.length]!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-7;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
      if (Math.abs(cross) <= 1e-9 * Math.max(scale, 1e-12) && dot > 0) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  return pts;
}

interface Line {
  /** A point on the shifted line. */
  p: Vec2;
  /** Unit direction of the original edge. */
  d: Vec2;
  /** Original edge length. */
  length: number;
  /** Original start vertex (for mitre limits). */
  a: Vec2;
}

function intersect(l1: Line, l2: Line): Vec2 | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
}

/** Corner between two shifted lines (a perpendicular step when they are parallel). */
function corner(prev: Line, next: Line): Vec2 {
  return intersect(prev, next) ?? { x: next.p.x, y: next.p.y };
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

export function selfIntersects(p: readonly Vec2[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(p[i]!, p[(i + 1) % n]!, p[j]!, p[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

const ringOf = (p: readonly Vec2[]): Ring => [...p.map((q) => [q.x, q.y] as [number, number]), [p[0]!.x, p[0]!.y]];
const fromRing = (r: Ring): Vec2[] => {
  const pts = r.map(([x, y]) => ({ x, y }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-12) pts.pop();
  return pts;
};

/**
 * The exact region at least `|dist|` inside (dist < 0) or within `dist`
 * outside (dist > 0) of the polygon, built from bands along every edge and
 * discs at every corner. Used only when the fast edge-collapse result still
 * crosses itself. Corners come out rounded here, which only affects shapes
 * that pinch apart.
 */
function bandOffset(poly: readonly Vec2[], dist: number): Vec2[][] {
  const r = Math.abs(dist);
  const bands: Polygon[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * r, ny = ((b.x - a.x) / len) * r;
    bands.push([ringOf([
      { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
    ])]);
    const disc: Vec2[] = [];
    for (let k = 0; k < 24; k++) disc.push({ x: a.x + r * Math.cos((2 * Math.PI * k) / 24), y: a.y + r * Math.sin((2 * Math.PI * k) / 24) });
    bands.push([ringOf(disc)]);
  }
  const shape: Polygon = [ringOf(poly)];
  const [first, ...rest] = bands;
  if (!first) return [];
  const result = dist < 0 ? clip.difference(shape, first, ...rest) : clip.union(shape, first, ...rest);
  return result.map((p) => fromRing(p[0]!)).filter((p) => p.length >= 3);
}

function distanceToBoundary(q: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(q.x - a.x - dx * t, q.y - a.y - dy * t));
  }
  return best;
}

function inside(q: Vec2, poly: readonly Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > q.y) !== (b.y > q.y) && b.y !== a.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Whether an outline really is the offset: every point along it at least
 * the offset distance from the original outline, on the right side of it.
 * Catches pinches that do not strictly cross (two sides of a narrow neck
 * that have swapped over).
 */
function isTrueOffset(points: readonly Vec2[], poly: readonly Vec2[], dist: number): boolean {
  const need = Math.abs(dist) * (1 - 1e-6) - 1e-9;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    for (const t of [0.25, 0.5, 0.75]) {
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (distanceToBoundary(q, poly) < need) return false;
      if (inside(q, poly) !== dist < 0) return false;
    }
  }
  return true;
}

/**
 * Offsets a closed polygon by `dist` (positive grows it, negative shrinks
 * it; either winding), never folding over itself.
 */
export function safeOffsetPolygon2D(input: readonly Vec2[], dist: number, opts: { miterLimit?: number } = {}): SafeOffsetResult {
  const miterLimit = opts.miterLimit ?? 2;
  let poly = cleanRing(input);
  if (poly.length < 3) return { points: [], ok: false, reason: 'The shape has too few corners to offset.', collapsed: 0, bevelled: 0, split: false };
  if (signedArea(poly) < 0) poly = poly.slice().reverse();
  if (Math.abs(dist) < 1e-12) return { points: poly, ok: true, collapsed: 0, bevelled: 0, split: false };

  // Shifted line of every edge. CCW: outward is to the right of travel.
  const all: Line[] = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    return { p: { x: a.x + d.y * dist, y: a.y - d.x * dist }, d, length, a };
  });

  // 1. Edge collapse: remove edges that run backwards, earliest first.
  let active = all.map((_, i) => i);
  let collapsed = 0;
  for (let guard = 0; guard < all.length; guard++) {
    const m = active.length;
    if (m < 3) {
      return { points: [], ok: false, reason: 'The offset is larger than the shape allows.', collapsed, bevelled: 0, split: false };
    }
    const verts = active.map((e, k) => corner(all[active[(k - 1 + m) % m]!]!, all[e]!));
    let worst = -1;
    let worstTime = Infinity;
    for (let k = 0; k < m; k++) {
      const line = all[active[k]!]!;
      const a = verts[k]!, b = verts[(k + 1) % m]!;
      const len = (b.x - a.x) * line.d.x + (b.y - a.y) * line.d.y; // signed length along the edge
      if (len > 1e-9) continue;
      // Length shrinks linearly from the original; when did it reach zero?
      const rate = (len - line.length) / dist;
      const time = Math.abs(rate) > 1e-12 ? Math.abs(-line.length / rate) : 0;
      if (time < worstTime) { worstTime = time; worst = k; }
    }
    if (worst < 0) break;
    active = active.filter((_, k) => k !== worst);
    collapsed++;
  }
  if (active.length < 3) {
    return { points: [], ok: false, reason: 'The offset is larger than the shape allows.', collapsed, bevelled: 0, split: false };
  }

  // 2. Mitre limit: cut corners that reach too far from their original corner.
  const m = active.length;
  const out: Vec2[] = [];
  let bevelled = 0;
  const limit = miterLimit * Math.abs(dist);
  for (let k = 0; k < m; k++) {
    const prev = all[active[(k - 1 + m) % m]!]!;
    const next = all[active[k]!]!;
    const v = corner(prev, next);
    // The original corner these two edges met at (their neighbours may have collapsed between them).
    const apex = next.a;
    const reach = Math.hypot(v.x - apex.x, v.y - apex.y);
    // A spike forms on the side the offset moves towards: convex corners growing, reflex corners shrinking.
    const spikes = (prev.d.x * next.d.y - prev.d.y * next.d.x) * dist > 0;
    if (reach > limit + 1e-9 && spikes && active[(k - 1 + m) % m] === (active[k]! - 1 + all.length) % all.length) {
      const b = { x: (v.x - apex.x) / reach, y: (v.y - apex.y) / reach };
      const cut: Line = { p: { x: apex.x + b.x * limit, y: apex.y + b.y * limit }, d: { x: -b.y, y: b.x }, length: 0, a: apex };
      const p1 = intersect(prev, cut), p2 = intersect(cut, next);
      if (p1 && p2) {
        out.push(p1, p2);
        bevelled++;
        continue;
      }
    }
    out.push(v);
  }

  let points = cleanRing(out);
  let split = false;

  // 3. A pinch (two sides of a narrow neck passing each other) or anything else still
  // wrong: rebuild the exact region and keep its largest piece.
  if (points.length < 3 || selfIntersects(points) || signedArea(points) <= 0 || !isTrueOffset(points, poly, dist)) {
    let pieces: Vec2[][] = [];
    try {
      pieces = bandOffset(poly, dist);
    } catch {
      pieces = [];
    }
    pieces = pieces.map(cleanRing).filter((p) => p.length >= 3 && Math.abs(signedArea(p)) > 1e-9);
    if (!pieces.length) {
      return { points: [], ok: false, reason: 'The offset is larger than the shape allows.', collapsed, bevelled, split: false };
    }
    pieces.sort((p, q) => Math.abs(signedArea(q)) - Math.abs(signedArea(p)));
    split = pieces.length > 1;
    points = pieces[0]!;
    if (signedArea(points) < 0) points = points.slice().reverse();
  }

  if (points.length < 3 || Math.abs(signedArea(points)) < 1e-9) {
    return { points: [], ok: false, reason: 'The offset is larger than the shape allows.', collapsed, bevelled, split };
  }
  return { points, ok: true, collapsed, bevelled, split };
}
