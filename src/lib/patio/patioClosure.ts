/**
 * Closing a patio or deck outline against what it is drawn next to.
 *
 * Tracing a building's footprint corner by corner is slow, and any error
 * leaves a strip of bare ground between the paving and the wall. Instead
 * the user draws only the garden side; the rest of the outline follows the
 * thing it meets — a building, a fence or garden wall, or another patio —
 * and is offered as a ghost to accept.
 *
 * Everything the outline can follow is a "target": a path of points and
 * bulges (the patio's own edge format, so curves stay curves):
 *
 *  - A building is the outer outline of its ground-floor walls joined into
 *    one shape, pulled 10 mm inside the wall faces so the paving tucks
 *    under the wall and no hairline gap can show. Round buildings (made of
 *    many flat wall pieces) are followed with a true arc where that stays
 *    under the walls.
 *  - A fence is a line along each side of it, 10 mm under the fence.
 *  - Another patio is its exact outline, so the two share an edge.
 *
 * Everything here is pure and works in world X/Z (the patio tool's Vec2).
 */

import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Polygon } from 'polygon-clipping';
import type { Shape } from '../../types';
import { arcPoint, bulgeThrough, denseOutline, offsetPolygon, pointInPolygon, polygonArea, type Vec2 } from './patioGeometry';

// The package ships its functions as a default export object while its
// type declarations name them individually; support both shapes.
const clip = ((polygonClippingModule as unknown as { default?: typeof polygonClippingModule }).default
  ?? polygonClippingModule) as typeof polygonClippingModule;

/** How far paving runs under a wall or fence. */
export const TUCK = 0.01;
/** Loose ends this close (m) to something are joined to it. */
export const CLOSE_REACH = 2;
/** Assumed half thickness of a fence (styles vary; posts are about 100 mm). */
const FENCE_HALF = 0.05;
/** Walls with their floor this far above the ground under them belong to an upper storey. */
const GROUND_FLOOR_MAX = 1.0;
/** A round building's arc must stay this close under its walls, or its flat pieces are followed. */
const MAX_ARC_SAG = 0.08;

export type TargetKind = 'building' | 'fence' | 'patio';

export interface Path {
  points: Vec2[];
  /** Bulge of the edge from point i to point i + 1 (see arcPoint). */
  bulges: number[];
  closed: boolean;
}

export interface CloseTarget {
  id: string;
  kind: TargetKind;
  path: Path;
  /** Surface level a patio takes when joined here (building floor, neighbour patio level). */
  level?: number;
  /** The footprint the patio must not cover (buildings and patios). */
  area?: Vec2[];
}

// ---------------------------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------------------------

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const edgeCount = (p: Path) => (p.closed ? p.points.length : p.points.length - 1);
const pointAt = (p: Path, edge: number, t: number): Vec2 =>
  arcPoint(p.points[edge], p.points[(edge + 1) % p.points.length], p.bulges[edge] ?? 0, t);

/** Bulge of the part of an edge between t0 and t1. */
function partBulge(p: Path, edge: number, t0: number, t1: number): number {
  const bulge = p.bulges[edge] ?? 0;
  if (Math.abs(bulge) < 1e-4) return 0;
  return bulgeThrough(pointAt(p, edge, t0), pointAt(p, edge, t1), pointAt(p, edge, (t0 + t1) / 2));
}

export interface PathPoint {
  edge: number;
  t: number;
  point: Vec2;
  distance: number;
}

/** Nearest point on a path (the foot of the perpendicular on straight edges). */
export function projectOntoPath(p: Path, q: Vec2): PathPoint | null {
  let best: PathPoint | null = null;
  for (let e = 0; e < edgeCount(p); e++) {
    const a = p.points[e], b = p.points[(e + 1) % p.points.length];
    let t: number;
    if (Math.abs(p.bulges[e] ?? 0) < 1e-4) {
      const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1e-12;
      t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / len2));
    } else {
      // Sample the arc, then refine around the best sample.
      let bt = 0, bd = Infinity;
      for (let k = 0; k <= 48; k++) {
        const d = dist(pointAt(p, e, k / 48), q);
        if (d < bd) { bd = d; bt = k / 48; }
      }
      let lo = Math.max(0, bt - 1 / 48), hi = Math.min(1, bt + 1 / 48);
      for (let i = 0; i < 30; i++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (dist(pointAt(p, e, m1), q) < dist(pointAt(p, e, m2), q)) hi = m2; else lo = m1;
      }
      t = (lo + hi) / 2;
    }
    const point = pointAt(p, e, t);
    const d = dist(point, q);
    if (!best || d < best.distance) best = { edge: e, t, point, distance: d };
  }
  return best;
}

/** The same path walked the other way. */
export function reversePath(p: Path): Path {
  const n = p.points.length;
  const points = p.points.slice().reverse();
  const bulges: number[] = [];
  for (let k = 0; k < edgeCount(p); k++) bulges.push(-(p.bulges[(n - 2 - k + n) % n] ?? 0));
  return { points, bulges, closed: p.closed };
}

/** Where a path point lands on the reversed path. */
function reversedPoint(p: Path, q: PathPoint): PathPoint {
  const n = p.points.length;
  return { ...q, edge: (n - 2 - q.edge + n) % n, t: 1 - q.t };
}

/**
 * The part of a path from one point on it to another, walking forward.
 * Returns points (including both ends) and a bulge for each edge between
 * them, or null when an open path would have to be walked backwards.
 */
export function subPath(p: Path, from: PathPoint, to: PathPoint): { points: Vec2[]; bulges: number[] } | null {
  const n = p.points.length;
  const before = from.edge < to.edge || (from.edge === to.edge && from.t <= to.t);
  if (!p.closed && !before) return null;
  const points: Vec2[] = [from.point];
  const bulges: number[] = [];
  if (from.edge === to.edge && from.t <= to.t) {
    bulges.push(partBulge(p, from.edge, from.t, to.t));
    points.push(to.point);
    return clean(points, bulges);
  }
  bulges.push(partBulge(p, from.edge, from.t, 1));
  let e = (from.edge + 1) % n;
  let guard = 0;
  while (e !== to.edge && guard++ <= n) {
    points.push(p.points[e]);
    bulges.push(p.bulges[e] ?? 0);
    e = (e + 1) % n;
  }
  points.push(p.points[to.edge]);
  bulges.push(partBulge(p, to.edge, 0, to.t));
  points.push(to.point);
  return clean(points, bulges);
}

/** Drops zero-length edges (keeping the bulge of the edge that survives). */
function clean(points: Vec2[], bulges: number[]): { points: Vec2[]; bulges: number[] } {
  const outP: Vec2[] = [points[0]];
  const outB: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (dist(points[i], outP[outP.length - 1]) < 1e-4) continue;
    outB.push(bulges[i - 1] ?? 0);
    outP.push(points[i]);
  }
  return { points: outP, bulges: outB };
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

/** A wall's footprint on the ground in world X/Z, using its true mitred corners when it has them. */
export function wallFootprint(s: Shape): Vec2[] | null {
  if (s.type !== 'wall' || !Array.isArray(s.args)) return null;
  const [length = 0, , thickness = 0.2] = s.args as number[];
  if (length < 0.05) return null;
  // Yaw only: walls turn about the vertical axis.
  let theta = 0;
  if (s.quaternion) theta = 2 * Math.atan2(s.quaternion[1], s.quaternion[3]);
  else if (s.rotation) theta = s.rotation[1];
  const ax: Vec2 = [Math.cos(theta), -Math.sin(theta)];
  const az: Vec2 = [Math.sin(theta), Math.cos(theta)];
  const local: [number, number][] = s.wallMiterFootprint
    ? s.wallMiterFootprint.map(([x, z]) => [x, z] as [number, number])
    : [[-length / 2, thickness / 2], [-length / 2, -thickness / 2], [length / 2, -thickness / 2], [length / 2, thickness / 2]];
  return local.map(([x, z]) => [s.position[0] + x * ax[0] + z * az[0], s.position[2] + x * ax[1] + z * az[1]] as Vec2);
}

const ccw = (poly: Vec2[]) => (polygonArea(poly) >= 0 ? poly : poly.slice().reverse());

function ringToVec(ring: [number, number][]): Vec2[] {
  const pts = ring.map(([x, z]) => [x, z] as Vec2);
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
  // Drop points on a straight line between their neighbours.
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-7 || dist(a, b) < 1e-9) out.push(b);
  }
  return out;
}

/**
 * The outlines of buildings, as closed rings: the ground-floor walls
 * joined into one shape per building (holes are courtyards).
 */
export function buildingOutlines(shapes: Shape[], groundAt: (x: number, z: number) => number): { ring: Vec2[]; floor: number; hole: boolean }[] {
  const byFloor = new Map<number, Polygon[]>();
  for (const s of shapes) {
    if (s.type !== 'wall' || s.hidden) continue;
    const fp = wallFootprint(s);
    if (!fp) continue;
    const height = (s.args as number[])[1] ?? 0;
    const floor = s.position[1] - height / 2;
    if (floor - groundAt(s.position[0], s.position[2]) > GROUND_FLOOR_MAX) continue;
    const key = Math.round(floor * 20) / 20;
    // Grown by 1 mm so walls that only just meet still join into one shape.
    const grown = offsetPolygon(ccw(fp), 0.001);
    const list = byFloor.get(key) ?? [];
    list.push([[...grown.map(([x, z]) => [x, z] as [number, number]), [grown[0][0], grown[0][1]]]]);
    byFloor.set(key, list);
  }
  const out: { ring: Vec2[]; floor: number; hole: boolean }[] = [];
  for (const [floor, polys] of byFloor) {
    let merged: MultiPolygon;
    try {
      merged = polys.length === 1 ? [polys[0]] : clip.union(polys[0], ...polys.slice(1));
    } catch {
      continue;
    }
    for (const poly of merged) {
      poly.forEach((ring, k) => {
        const pts = ringToVec(ring as [number, number][]);
        if (pts.length >= 3 && Math.abs(polygonArea(pts)) > 0.05) out.push({ ring: ccw(pts), floor, hole: k > 0 });
      });
    }
  }
  return out;
}

/**
 * Replaces runs of short, evenly turning edges (a round wall made of flat
 * pieces) with a true arc just under the walls: tangent to the middle of
 * each flat piece, inside the wall at the joints. Where the pieces are too
 * coarse for that to stay under the walls, they are followed as drawn.
 */
export function smoothRoundRuns(ring: Vec2[]): Path {
  const n = ring.length;
  const straight = (): Path => ({ points: ring.slice(), bulges: ring.map(() => 0), closed: true });
  if (n < 6) return straight();
  const len = (i: number) => dist(ring[i], ring[(i + 1) % n]);
  const dir = (i: number) => Math.atan2(ring[(i + 1) % n][1] - ring[i][1], ring[(i + 1) % n][0] - ring[i][0]);
  const turn = (i: number) => { // turn at vertex i + 1, between edge i and edge i + 1
    let d = dir((i + 1) % n) - dir(i);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  // Edge i continues a round run from edge i - 1 when it is about as long and turns about as much.
  const links = Array.from({ length: n }, (_, i) => {
    const prev = (i - 1 + n) % n;
    const a = turn(prev), b = turn(i);
    const deg = Math.abs(a) * 180 / Math.PI;
    return deg > 0.5 && deg < 20 && Math.sign(a) === Math.sign(b)
      && Math.abs(len(i) - len(prev)) <= 0.1 * Math.max(len(i), len(prev))
      && Math.abs(Math.abs(a) - Math.abs(b)) <= 0.25 * Math.max(Math.abs(a), Math.abs(b));
  });
  const full = links.every(Boolean);
  // Runs of edges [start, start + count).
  const runs: { start: number; count: number }[] = [];
  if (full) runs.push({ start: 0, count: n });
  else {
    const first = links.findIndex((l) => !l);
    for (let k = 0; k < n; k++) {
      const i = (first + k) % n;
      if (links[(i + 1) % n] && !links[i]) {
        let count = 1;
        while (links[(i + count) % n] && count < n) count++;
        if (count >= 3) runs.push({ start: i, count });
      }
    }
  }
  if (!runs.length) return straight();

  const points: Vec2[] = [];
  const bulges: number[] = [];
  const inRun = new Map(runs.map((r) => [r.start, r]));

  const emitArc = (r: { start: number; count: number }) => {
    const a = ring[r.start], m = ring[(r.start + Math.floor(r.count / 2)) % n], b = ring[(r.start + r.count) % n];
    const centre = circumcentre(a, m, r.count === n ? ring[(r.start + Math.floor(r.count / 4)) % n] : b);
    if (!centre) return false;
    let apothem = 0, radius = 0;
    for (let k = 0; k < r.count; k++) {
      const p = ring[(r.start + k) % n], q = ring[(r.start + k + 1) % n];
      apothem += dist(centre, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
      radius += dist(centre, p);
    }
    apothem /= r.count; radius /= r.count;
    if (radius - apothem > MAX_ARC_SAG) return false;
    const angleOf = (p: Vec2) => Math.atan2(p[1] - centre[1], p[0] - centre[0]);
    const onArc = (angle: number): Vec2 => [centre[0] + Math.cos(angle) * apothem, centre[1] + Math.sin(angle) * apothem];
    const a0 = angleOf(a);
    let sweep = r.count === n ? 2 * Math.PI * Math.sign(turn(r.start)) : 0;
    if (r.count !== n) {
      for (let k = 0; k < r.count; k++) {
        let d = angleOf(ring[(r.start + k + 1) % n]) - angleOf(ring[(r.start + k) % n]);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        sweep += d;
      }
    }
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 3)));
    if (r.count !== n) { points.push(a); bulges.push(0); }
    for (let k = 0; k < pieces; k++) {
      const s = a0 + (sweep * k) / pieces, e = a0 + (sweep * (k + 1)) / pieces;
      points.push(onArc(s));
      bulges.push(bulgeThrough(onArc(s), onArc(e), onArc((s + e) / 2)));
    }
    if (r.count !== n) { points.push(onArc(a0 + sweep)); bulges.push(0); }
    return true;
  };

  if (full) {
    if (!emitArc(runs[0])) return straight();
    return { points, bulges, closed: true };
  }
  for (let i = 0; i < n; i++) {
    const r = inRun.get(i);
    if (r) {
      const before = points.length;
      if (emitArc(r)) {
        i += r.count - 1;
        continue;
      }
      points.length = before;
      bulges.length = before;
    }
    points.push(ring[i]);
    bulges.push(0);
  }
  return clean2(points, bulges);
}

/** Like clean(), for a closed path (the last edge wraps to the first point). */
function clean2(points: Vec2[], bulges: number[]): Path {
  const outP: Vec2[] = [];
  const outB: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (outP.length && dist(points[i], outP[outP.length - 1]) < 1e-4) {
      outB[outB.length - 1] = bulges[i] ?? 0;
      continue;
    }
    outP.push(points[i]);
    outB.push(bulges[i] ?? 0);
  }
  if (outP.length > 1 && dist(outP[0], outP[outP.length - 1]) < 1e-4) { outP.pop(); outB.pop(); }
  return { points: outP, bulges: outB, closed: true };
}

function circumcentre(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  return [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
}

/** Offsets an open polyline sideways (positive = to the left of travel), mitring its bends. */
function offsetPolyline(points: Vec2[], distance: number): Vec2[] {
  const n = points.length;
  return points.map((p, i) => {
    const normalOf = (a: Vec2, b: Vec2): Vec2 => {
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    };
    const n1 = i > 0 ? normalOf(points[i - 1], p) : null;
    const n2 = i < n - 1 ? normalOf(p, points[i + 1]) : null;
    let nx = (n1?.[0] ?? 0) + (n2?.[0] ?? 0), nz = (n1?.[1] ?? 0) + (n2?.[1] ?? 0);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const ref = n1 ?? n2!;
    const scale = Math.min(3, 1 / Math.max(0.25, nx * ref[0] + nz * ref[1]));
    return [p[0] + nx * distance * scale, p[1] + nz * distance * scale] as Vec2;
  });
}

/** A patio or deck's outline in world X/Z. */
export function patioWorldPath(s: Shape): Path | null {
  const d = s.patioData;
  if (!d || d.points.length < 3) return null;
  return {
    points: d.points.map(([x, z]) => [x + s.position[0], z + s.position[2]] as Vec2),
    bulges: d.points.map((_, i) => d.bulges[i] ?? 0),
    closed: true,
  };
}

/** Everything a patio outline can close against. */
export function buildCloseTargets(
  shapes: Shape[],
  groundAt: (x: number, z: number) => number,
  opts: { excludeId?: string } = {},
): CloseTarget[] {
  const targets: CloseTarget[] = [];
  buildingOutlines(shapes, groundAt).forEach(({ ring, floor, hole }, i) => {
    // Pulled into the walls so paving tucks under them: inward for a
    // building's outline, outward for a courtyard (or room) inside it. The
    // extra 1 mm undoes the growth used to join the walls.
    const tucked = offsetPolygon(ring, hole ? TUCK + 0.001 : -(TUCK + 0.001));
    targets.push({
      id: `building-${i}`,
      kind: 'building',
      path: smoothRoundRuns(tucked),
      level: floor,
      // A patio may fill a courtyard, but never cover a building. Shrunk past
      // the tuck, so paving meant to run under a long wall never counts as covering it.
      ...(hole ? {} : { area: offsetPolygon(ring, -(TUCK + 0.02)) }),
    });
  });
  for (const s of shapes) {
    if (s.hidden || s.id === opts.excludeId) continue;
    if (s.type === 'fence' && s.fenceData && s.fenceData.points.length >= 2) {
      const centre = s.fenceData.points.map(([x, z]) => [x + s.position[0], z + s.position[2]] as Vec2);
      if (s.fenceData.closed) centre.push(centre[0]);
      else {
        // A fence drawn up to a wall stops at its face; run each end on a
        // little so it meets the building's outline (tucked under the wall).
        const extend = (end: Vec2, from: Vec2): Vec2 => {
          const l = dist(end, from) || 1;
          return [end[0] + ((end[0] - from[0]) / l) * 0.1, end[1] + ((end[1] - from[1]) / l) * 0.1];
        };
        centre[0] = extend(centre[0], centre[1]);
        centre[centre.length - 1] = extend(centre[centre.length - 1], centre[centre.length - 2]);
      }
      for (const side of [1, -1]) {
        targets.push({
          id: `fence-${s.id}-${side}`,
          kind: 'fence',
          path: { points: offsetPolyline(centre, side * (FENCE_HALF - TUCK)), bulges: centre.map(() => 0).slice(1), closed: false },
        });
      }
    } else if (s.type === 'patio') {
      const path = patioWorldPath(s);
      if (!path) continue;
      const outline = denseOutline(path.points, path.bulges, 0.2).points;
      targets.push({ id: `patio-${s.id}`, kind: 'patio', path, level: s.position[1], area: offsetPolygon(outline, -0.02) });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------------------------
// Closing an outline
// ---------------------------------------------------------------------------------------------

export interface CloseCandidate {
  points: Vec2[];
  bulges: number[];
  /** Edges that run along a target: no kerb, railing or steps. */
  joined: boolean[];
  /** Level to take, from the building or neighbouring patio it joins. */
  level?: number;
  /** The route along the target(s), for the ghost preview. */
  route: Vec2[];
  area: number;
}

interface Attach { target: CloseTarget; at: PathPoint }

function nearestTarget(q: Vec2, targets: CloseTarget[], reach: number): Attach | null {
  let best: Attach | null = null;
  for (const target of targets) {
    const at = projectOntoPath(target.path, q);
    if (at && at.distance <= reach && (!best || at.distance < best.at.distance)) best = { target, at };
  }
  return best;
}

/** Where two paths cross, as a point on each. */
function crossings(p: Path, q: Path): { onP: PathPoint; onQ: PathPoint }[] {
  const sample = (path: Path) => {
    const out: { pt: Vec2; edge: number; t: number }[] = [];
    for (let e = 0; e < edgeCount(path); e++) {
      const steps = Math.abs(path.bulges[e] ?? 0) < 1e-4 ? 1 : 24;
      for (let k = 0; k < steps; k++) out.push({ pt: pointAt(path, e, k / steps), edge: e, t: k / steps });
    }
    const last = path.closed ? out[0] : { pt: path.points[path.points.length - 1], edge: edgeCount(path) - 1, t: 1 };
    out.push({ ...last, edge: last.edge, t: last.t });
    return out;
  };
  const a = sample(p), b = sample(q);
  const found: { onP: PathPoint; onQ: PathPoint }[] = [];
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const hit = segmentHit(a[i].pt, a[i + 1].pt, b[j].pt, b[j + 1].pt);
      if (!hit) continue;
      const pt: Vec2 = [a[i].pt[0] + (a[i + 1].pt[0] - a[i].pt[0]) * hit.s, a[i].pt[1] + (a[i + 1].pt[1] - a[i].pt[1]) * hit.s];
      const onP = projectOntoPath(p, pt), onQ = projectOntoPath(q, pt);
      if (onP && onQ) found.push({ onP, onQ });
    }
  }
  return found;
}

function segmentHit(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { s: number; u: number } | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]], sv: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * sv[1] - r[1] * sv[0];
  if (Math.abs(den) < 1e-12) return null;
  const s = ((c[0] - a[0]) * sv[1] - (c[1] - a[1]) * sv[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return s >= 0 && s <= 1 && u >= 0 && u <= 1 ? { s, u } : null;
}

/** Routes along one path between two of its points: both ways round a closed path. */
function routesAlong(path: Path, from: PathPoint, to: PathPoint): { points: Vec2[]; bulges: number[] }[] {
  const out: { points: Vec2[]; bulges: number[] }[] = [];
  const fwd = subPath(path, from, to);
  if (fwd) out.push(fwd);
  const rev = reversePath(path);
  const back = subPath(rev, reversedPoint(path, from), reversedPoint(path, to));
  if (back) out.push(back);
  return out;
}

function areaOverlap(a: Vec2[], b: Vec2[]): number {
  try {
    const hit = clip.intersection([ringOf(a)], [ringOf(b)]);
    return hit.reduce((sum, poly) => sum + poly.reduce((s, ring, k) => s + (k === 0 ? 1 : -1) * Math.abs(polygonArea(ringToVec(ring as [number, number][]))), 0), 0);
  } catch {
    return 0;
  }
}

const ringOf = (pts: Vec2[]): [number, number][] => [...pts.map(([x, z]) => [x, z] as [number, number]), [pts[0][0], pts[0][1]]];

/**
 * Ways to close a drawn chain — the corners so far, from the first point to
 * the loose end `last` — along whatever the two ends are near. Best first:
 * the smallest outline that does not cover a building or another patio.
 * Empty when either end is out of reach.
 */
export function closeCandidates(opts: {
  chain: Vec2[];
  chainBulges: number[];
  targets: CloseTarget[];
  reach?: number;
}): CloseCandidate[] {
  const { chain, chainBulges, targets } = opts;
  const reach = opts.reach ?? CLOSE_REACH;
  if (chain.length < 2 || !targets.length) return [];
  const first = chain[0], last = chain[chain.length - 1];
  const atLast = nearestTarget(last, targets, reach);
  const atFirst = nearestTarget(first, targets, reach);
  if (!atLast || !atFirst) return [];

  // Routes from where the loose end meets its target to where the first point meets its own.
  // `bridge` marks a straight edge across open ground (no kerb-free join there).
  const routes: { points: Vec2[]; bulges: number[]; targets: CloseTarget[]; bridge?: boolean }[] = [];
  if (atLast.target.id === atFirst.target.id) {
    for (const r of routesAlong(atLast.target.path, atLast.at, atFirst.at)) routes.push({ ...r, targets: [atLast.target] });
  } else {
    for (const x of crossings(atLast.target.path, atFirst.target.path)) {
      for (const r1 of routesAlong(atLast.target.path, atLast.at, x.onP)) {
        for (const r2 of routesAlong(atFirst.target.path, x.onQ, atFirst.at)) {
          routes.push({
            points: [...r1.points, ...r2.points.slice(1)],
            bulges: [...r1.bulges, ...r2.bulges],
            targets: [atLast.target, atFirst.target],
          });
        }
      }
    }
    // Two things that never meet (a fence stopping short of the house, two separate
    // buildings): close straight across between where each end meets its own.
    if (!routes.length) {
      routes.push({ points: [atLast.at.point, atFirst.at.point], bulges: [0], targets: [atLast.target, atFirst.target], bridge: true });
    }
  }

  const candidates: CloseCandidate[] = [];
  const onTarget = 0.03; // an end already this close is moved onto its target, not joined by a stub
  for (const route of routes) {
    const points: Vec2[] = [];
    const bulges: number[] = [];
    const joined: boolean[] = [];
    const push = (p: Vec2, bulgeToNext: number, isJoined: boolean) => {
      if (points.length && dist(points[points.length - 1], p) < 1e-4) {
        bulges[bulges.length - 1] = bulgeToNext;
        joined[joined.length - 1] = isJoined;
        return;
      }
      points.push(p); bulges.push(bulgeToNext); joined.push(isJoined);
    };
    const startOnTarget = atFirst.at.distance <= onTarget;
    const endOnTarget = atLast.at.distance <= onTarget;
    // The drawn chain (its first point replaced by where it meets the target, when already on it).
    for (let i = 0; i < chain.length - 1; i++) push(i === 0 && startOnTarget ? atFirst.at.point : chain[i], chainBulges[i] ?? 0, false);
    if (!endOnTarget) push(last, 0, false); // straight in to the target
    for (let i = 0; i < route.points.length - 1; i++) push(route.points[i], route.bulges[i] ?? 0, !route.bridge);
    if (!startOnTarget) push(route.points[route.points.length - 1], 0, false); // straight back out to the first point
    // Closing edge: from the last point back to the first.
    if (points.length && dist(points[points.length - 1], points[0]) < 1e-4) { points.pop(); bulges.pop(); joined.pop(); }
    if (points.length < 3) continue;
    const dense = denseOutline(points, bulges, 0.25).points;
    const area = Math.abs(polygonArea(dense));
    if (area < 0.05) continue;
    // Never wrap round (or across) a building or another patio.
    const covers = targets.some((t) => t.area && areaOverlap(dense, t.area) > 0.05);
    if (covers) continue;
    const levels = route.targets.filter((t) => t.kind === 'building' && t.level !== undefined).map((t) => t.level!);
    const patioLevels = route.targets.filter((t) => t.kind === 'patio' && t.level !== undefined).map((t) => t.level!);
    const level = levels.length ? Math.max(...levels) : patioLevels.length ? patioLevels[0] : undefined;
    candidates.push({ points, bulges, joined, level, route: route.points, area });
  }
  candidates.sort((a, b) => a.area - b.area);
  return candidates;
}

// ---------------------------------------------------------------------------------------------
// Other helpers for the tool
// ---------------------------------------------------------------------------------------------

/**
 * Cuts a new outline back where it overlaps existing patios and decks, so
 * the two share an edge instead of overlapping. Returns null when nothing
 * overlaps, and an empty outline when the new one is entirely covered.
 */
export function trimAgainstPatios(points: Vec2[], bulges: number[], others: Path[]): { points: Vec2[]; bulges: number[] } | null {
  if (!others.length) return null;
  const mine = denseOutline(points, bulges, 0.1).points;
  const theirs = others.map((o) => denseOutline(o.points, o.bulges, 0.1).points);
  const overlap = theirs.reduce((sum, t) => sum + areaOverlap(mine, t), 0);
  if (overlap < 0.01) return null;
  let result: MultiPolygon;
  try {
    result = clip.difference([ringOf(mine)], ...theirs.map((t) => [ringOf(t)] as Polygon));
  } catch {
    return null;
  }
  let best: Vec2[] = [];
  for (const poly of result) {
    const ring = ringToVec(poly[0] as [number, number][]);
    if (Math.abs(polygonArea(ring)) > Math.abs(polygonArea(best.length ? best : [[0, 0], [0, 0], [0, 0]]))) best = ring;
  }
  if (best.length < 3 || Math.abs(polygonArea(best)) < 0.05) return { points: [], bulges: [] };
  // Curved edges come back as short straight pieces: fine for a trimmed
  // outline, and the corners all stay exactly where they were.
  return { points: best, bulges: best.map(() => 0) };
}

/** For each edge, whether it runs along one of the targets (so it gets no kerb or railing). */
export function joinedEdges(points: Vec2[], bulges: number[], targets: CloseTarget[], tolerance = 0.02): boolean[] {
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const mid = arcPoint(a, b, bulges[i] ?? 0, 0.5);
    const q1 = arcPoint(a, b, bulges[i] ?? 0, 0.2), q2 = arcPoint(a, b, bulges[i] ?? 0, 0.8);
    return targets.some((t) => [mid, q1, q2].every((q) => (projectOntoPath(t.path, q)?.distance ?? Infinity) <= tolerance));
  });
}

interface Line { point: Vec2; dir: Vec2 }

/** Straight target edges near and parallel to a segment, nearest first. */
function parallelLine(a: Vec2, b: Vec2, targets: CloseTarget[], maxDistance: number, kinds: TargetKind[]): Line | null {
  const len = dist(a, b);
  if (len < 1e-6) return null;
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  let best: { line: Line; d: number } | null = null;
  for (const t of targets) {
    if (!kinds.includes(t.kind)) continue;
    const p = t.path;
    for (let e = 0; e < edgeCount(p); e++) {
      if (Math.abs(p.bulges[e] ?? 0) > 1e-4) continue;
      const c = p.points[e], d = p.points[(e + 1) % p.points.length];
      const l = dist(c, d);
      if (l < 0.05) continue;
      const v: Vec2 = [(d[0] - c[0]) / l, (d[1] - c[1]) / l];
      if (Math.abs(u[0] * v[1] - u[1] * v[0]) > Math.sin((3 * Math.PI) / 180)) continue;
      // Perpendicular distance of both ends of the segment from the target line.
      const off = (q: Vec2) => (q[0] - c[0]) * -v[1] + (q[1] - c[1]) * v[0];
      const da = off(a), db = off(b);
      if (Math.abs(da) > maxDistance || Math.abs(db) > maxDistance) continue;
      // The segment must run alongside the edge, not just be in line with it.
      const along = (q: Vec2) => (q[0] - c[0]) * v[0] + (q[1] - c[1]) * v[1];
      const lo = Math.min(along(a), along(b)), hi = Math.max(along(a), along(b));
      if (hi < 0.05 || lo > l - 0.05) continue;
      const dd = Math.max(Math.abs(da), Math.abs(db));
      if (!best || dd < best.d) best = { line: { point: c, dir: v }, d: dd };
    }
  }
  return best?.line ?? null;
}

const projectOnLine = (q: Vec2, l: Line): Vec2 => {
  const s = (q[0] - l.point[0]) * l.dir[0] + (q[1] - l.point[1]) * l.dir[1];
  return [l.point[0] + l.dir[0] * s, l.point[1] + l.dir[1] * s];
};

function lineIntersection(l1: Line, l2: Line): Vec2 | null {
  const den = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
  if (Math.abs(den) < Math.sin((5 * Math.PI) / 180)) return null;
  const s = ((l2.point[0] - l1.point[0]) * l2.dir[1] - (l2.point[1] - l1.point[1]) * l2.dir[0]) / den;
  return [l1.point[0] + l1.dir[0] * s, l1.point[1] + l1.dir[1] * s];
}

/**
 * The side of a dragged rectangle nearest a parallel wall or fence, moved
 * onto it (tucked under it). Returns null when no side is within reach.
 */
export function snapRectangleSide(corners: Vec2[], targets: CloseTarget[], reach = CLOSE_REACH): Vec2[] | null {
  let best: { side: number; line: Line; d: number } | null = null;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const line = parallelLine(a, b, targets, reach, ['building', 'fence']);
    if (!line) continue;
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(mid, projectOnLine(mid, line));
    // Only a side facing the target: the rectangle must not be dragged across it.
    const inside: Vec2 = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
    const sideOf = (q: Vec2) => Math.sign((q[0] - line.point[0]) * -line.dir[1] + (q[1] - line.point[1]) * line.dir[0]);
    if (sideOf(mid) !== sideOf(inside) && d > 1e-6) continue;
    if (!best || d < best.d) best = { side: i, line, d };
  }
  if (!best || best.d < 1e-6) return null;
  const out = corners.map((c) => [c[0], c[1]] as Vec2);
  for (const k of [best.side, (best.side + 1) % 4]) out[k] = projectOnLine(corners[k], best.line);
  return out;
}

/**
 * Pulls the straight edges of an existing outline that run close to and
 * alongside a wall or fence onto it (tucked under it), and edges along
 * another patio onto that patio's edge. Corners between two pulled edges
 * move to where the two lines meet. Returns the new points and how many
 * edges moved.
 */
export function snapOutlineToTargets(points: Vec2[], bulges: number[], targets: CloseTarget[], tolerance = 0.3): { points: Vec2[]; moved: number } {
  const n = points.length;
  const lines: (Line | null)[] = points.map((a, i) =>
    Math.abs(bulges[i] ?? 0) > 1e-4 ? null : parallelLine(a, points[(i + 1) % n], targets, tolerance, ['building', 'fence', 'patio']));
  const moved = lines.filter((l, i) => l && [points[i], points[(i + 1) % n]].some((q) => dist(q, projectOnLine(q, l)) > 1e-4)).length;
  const out = points.map((p, i) => {
    const before = lines[(i - 1 + n) % n], after = lines[i];
    if (before && after) return lineIntersection(before, after) ?? projectOnLine(p, after);
    if (after) return projectOnLine(p, after);
    if (before) return projectOnLine(p, before);
    return [p[0], p[1]] as Vec2;
  });
  return { points: out, moved };
}

/**
 * Where a cursor over a building meets it from outside: the nearest point
 * on the outline of the building it is on or inside (the ground point under
 * a cursor over a wall is often just behind the wall, on its inner face).
 */
export function buildingEdgePoint(q: Vec2, targets: CloseTarget[], reach: number): Vec2 | null {
  let best: { p: Vec2; d: number } | null = null;
  for (const t of targets) {
    if (t.kind !== 'building' || !t.area) continue;
    const at = projectOntoPath(t.path, q);
    if (!at) continue;
    const inside = pointInPolygon(q[0], q[1], t.area);
    if (!inside && at.distance > reach) continue;
    if (!best || at.distance < best.d) best = { p: at.point, d: at.distance };
  }
  return best?.p ?? null;
}

/**
 * "Snap To Building" for one patio or deck: its edges near a wall, fence or
 * another patio pulled onto it. Returns the updated shape (or null when no
 * edge needs moving) and how many edges moved.
 */
export function snapPatioToBuilding(
  patio: Shape,
  shapes: Shape[],
  groundAt: (x: number, z: number) => number,
): { shape: Shape | null; moved: number } {
  const data = patio.patioData;
  if (!data) return { shape: null, moved: 0 };
  const targets = buildCloseTargets(shapes, groundAt, { excludeId: patio.id });
  const world = data.points.map(([x, z]) => [x + patio.position[0], z + patio.position[2]] as Vec2);
  const bulges = data.points.map((_, i) => data.bulges[i] ?? 0);
  const result = snapOutlineToTargets(world, bulges, targets);
  if (!result.moved) return { shape: null, moved: 0 };
  const joined = joinedEdges(result.points, bulges, targets);
  return {
    moved: result.moved,
    shape: {
      ...patio,
      patioData: {
        ...data,
        points: result.points.map(([x, z]) => [x - patio.position[0], z - patio.position[2]] as [number, number]),
        wallEdges: data.points.map((_, i) => !!(data.wallEdges[i] || joined[i])),
      },
    },
  };
}
