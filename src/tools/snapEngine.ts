/**
 * PolyForm — the shared snap and inference function for the curve tools.
 *
 * One call answers "where does the pointer mean?" for Line, Arc, Bézier, Poly and the shape
 * tools alike. It works in three tiers, strongest first:
 *
 *  1. POINTS: a corner (endpoint), the point where two edges cross (intersection), the
 *     midpoint of an edge, a face centre, the origin - and, weakest, any point ON an edge or
 *     guide, which is what lets a line end exactly on another one so both split.
 *  2. DIRECTIONS from the point you are drawing from: along a red / green / blue axis; parallel
 *     or perpendicular to an edge you rested on; the continuation of an edge you are extending;
 *     lined up with a corner you rested on ("from point"). Where two of these lines meet, or
 *     one meets an edge, that point is offered instead (they are the useful ones).
 *  3. FREE: the raw pointer position.
 *
 * LOCKS keep one line fixed whatever the pointer does (arrow keys for an axis, Shift to hold
 * the inference showing, Down for the edge you rested on). A lock still lets you fetch corners,
 * midpoints and crossings that sit on the locked line, and lines a corner up with it - the
 * step the old letter-key lock skipped, which turned every snap off.
 *
 * Pure: three.js maths only, no DOM and no React, so every rule here is tested.
 */

import * as THREE from 'three';
import type { EdgeId, Graph } from '../lib/geometry/types';
import { edgePoints, loopPoints } from '../lib/geometry/topology';

export type V3 = THREE.Vector3;

export type SnapKind =
  | 'endpoint' | 'midpoint' | 'center' | 'origin' | 'close' | 'intersection' | 'edge' | 'guide'
  | 'axis' | 'parallel' | 'perpendicular' | 'extension' | 'from' | 'lock' | 'fillet';

export interface SnapLine {
  origin: V3;
  /** Unit direction. */
  dir: V3;
  color: string;
  label: string;
  kind: SnapKind;
}

export interface SnapGuide {
  a: V3;
  b: V3;
  color: string;
  dashed: boolean;
}

export interface HoverEdge {
  a: V3;
  b: V3;
  id: EdgeId | -1;
}

export interface SnapResult {
  /** Where the tool should put the point (on the drawing plane, when there is one). */
  point: V3;
  /** Where the marker sits: a snapped corner is shown at the corner itself. */
  marker: V3 | null;
  kind: SnapKind | 'none';
  label: string;
  guides: SnapGuide[];
  /** The inference line in force, if any: what Shift would hold. */
  line: SnapLine | null;
  /** The edge under the pointer, for highlighting and for resting on. */
  hoverEdge: HoverEdge | null;
}

export const AXES = {
  x: { dir: new THREE.Vector3(1, 0, 0), color: '#ef4444', name: 'Red axis' },
  z: { dir: new THREE.Vector3(0, 0, 1), color: '#22c55e', name: 'Green axis' },
  y: { dir: new THREE.Vector3(0, 1, 0), color: '#3b82f6', name: 'Blue axis' },
} as const;
export type AxisName = keyof typeof AXES;

const PARALLEL_COLOR = '#d946ef';
const EXTENSION_COLOR = '#71717a';
const POINT_COLOR = '#16a34a';

/** How close (px) the pointer must be to a point of each kind, and how much each kind is favoured. */
const RADIUS_PX: Record<string, number> = {
  close: 16, endpoint: 12, intersection: 12, origin: 12, midpoint: 8, center: 7, edge: 8, guide: 8,
};
const PREFER_PX: Record<string, number> = {
  close: 8, endpoint: 6, intersection: 5, origin: 4, midpoint: 2, center: 0, edge: -4, guide: -4,
};
/** How close (px) the pointer must be to an inference line to take it. */
const LINE_PX = 6;
const CROSSING_PX = 12;
/** Points closer than this to a line are "on" it. */
const ON_LINE = 2e-3;
const LINE_REACH = 500;
/** Edges considered for crossings: the nearest few by screen distance. */
const NEAR_EDGE_LIMIT = 40;
const NEAR_EDGE_PX = 40;
/** An on-edge snap put on the drawing plane may land this far (px) from the pointer, no more. */
const OFF_PLANE_EDGE_PX = 24;

// ---------------------------------------------------------------------------
// Memory: the corners and edge you rested on
// ---------------------------------------------------------------------------

/**
 * SketchUp's "rest on a point to wake it": rest the pointer on a corner or an edge for a moment
 * and lines can then be taken from it (aligned with that corner; parallel to that edge). Holds
 * up to two points and one edge.
 */
export class SnapMemory {
  points: V3[] = [];
  edge: HoverEdge | null = null;
  private pending: { key: string; since: number; point: V3 | undefined; edge: HoverEdge | undefined } | null = null;

  constructor(private readonly dwellMs = 300) {}

  clear(): void {
    this.points = [];
    this.edge = null;
    this.pending = null;
  }

  /** Feed each pointer move's result; `now` is a millisecond clock. */
  update(result: Pick<SnapResult, 'kind' | 'marker' | 'hoverEdge'>, now: number): void {
    let key: string | null = null;
    let point: V3 | undefined;
    let edge: HoverEdge | undefined;
    if (result.marker && ['endpoint', 'midpoint', 'center', 'origin', 'intersection'].includes(result.kind)) {
      point = result.marker;
      key = `p:${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`;
    } else if (result.hoverEdge && (result.kind === 'edge' || result.kind === 'none')) {
      edge = result.hoverEdge;
      key = `e:${edge.id}:${edge.a.x.toFixed(3)},${edge.a.y.toFixed(3)},${edge.a.z.toFixed(3)}`;
    }
    if (!key) { this.pending = null; return; }
    if (!this.pending || this.pending.key !== key) {
      this.pending = { key, since: now, point, edge };
      return;
    }
    if (now - this.pending.since < this.dwellMs) return;
    if (point && !this.points.some(p => p.distanceTo(point!) < 1e-6)) {
      this.points = [...this.points, point.clone()].slice(-2);
    }
    if (edge) this.edge = { a: edge.a.clone(), b: edge.b.clone(), id: edge.id };
  }

  /** 0..1: how far the pointer is through waking what it rests on. */
  progress(now: number): number {
    return this.pending ? Math.min(1, (now - this.pending.since) / this.dwellMs) : 0;
  }

  acquireEdge(edge: HoverEdge | null): void {
    if (edge) this.edge = { a: edge.a.clone(), b: edge.b.clone(), id: edge.id };
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SnapInput {
  graph: Graph;
  /** Bump when the graph changes so the cached point lists rebuild. */
  revision?: number;
  camera: THREE.Camera;
  size: { width: number; height: number };
  /** Pointer position in pixels, from the canvas's top-left. */
  pointer: { x: number; y: number };
  ray: THREE.Ray;
  /** The raw 3-D position under the pointer (drawing-plane hit, surface hit or the ground). */
  cursor: V3;
  /** The plane being drawn on. Snapped points are put on it; only lines lying in it are offered. */
  plane?: THREE.Plane | null;
  /** The point being drawn from. Direction inferences need it. */
  from?: V3 | null;
  /** More points to snap to (object corners, guide ends ...). */
  extraPoints?: readonly { point: V3; kind: 'endpoint' | 'midpoint' | 'center'; label?: string }[];
  /** Guide lines: snapped onto like edges. */
  guides?: readonly (readonly [V3, V3])[];
  guideCrossings?: readonly V3[];
  memory?: SnapMemory | null;
  /** An edge chosen to be parallel or perpendicular to (overrides the one in memory). */
  refEdge?: HoverEdge | null;
  /** A line held by a lock. */
  lockLine?: SnapLine | null;
  /** The chain's first point, offered as "close". */
  closePoint?: V3 | null;
  /** False turns direction inferences off (points still snap). */
  inference?: boolean;
}

// ---------------------------------------------------------------------------
// Screen helpers
// ---------------------------------------------------------------------------

interface Screen {
  toPx(v: V3): THREE.Vector2 | null;
  pointDist(v: V3): number;
  /** Pixels from the pointer to a segment, or to the whole line through it. */
  segmentDist(a: V3, b: V3, infinite?: boolean): number;
  /** The point on a segment that appears under the pointer (null if it can't be told). */
  segmentPointUnderPointer(a: V3, b: V3): V3 | null;
  /** Whether a point is in front of the camera and inside the canvas. */
  onScreen(v: V3): boolean;
}

function makeScreen(inp: SnapInput): Screen {
  const { camera, size } = inp;
  const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
  const near = persp ? (camera as THREE.PerspectiveCamera).near * 1.01 : -Infinity;
  const W = size.width, H = size.height;
  const px = inp.pointer.x, py = inp.pointer.y;
  // View-projection, applied by hand: this runs for every edge on every pointer move.
  const e = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const cx = (v: V3) => e[0]! * v.x + e[4]! * v.y + e[8]! * v.z + e[12]!;
  const cy = (v: V3) => e[1]! * v.x + e[5]! * v.y + e[9]! * v.z + e[13]!;
  const cw = (v: V3) => e[3]! * v.x + e[7]! * v.y + e[11]! * v.z + e[15]!;
  const tmp = new THREE.Vector3();
  const toPx = (v: V3): THREE.Vector2 | null => {
    const p = tmp.copy(v).project(camera);
    if (p.z >= 1 || p.z <= -1) return null;
    return new THREE.Vector2(((p.x + 1) / 2) * W, ((-p.y + 1) / 2) * H);
  };
  return {
    toPx,
    pointDist: v => {
      const w = cw(v);
      if (persp ? w < near : false) return Infinity;
      return Math.hypot(((cx(v) / w + 1) / 2) * W - px, ((1 - cy(v) / w) / 2) * H - py);
    },
    segmentDist: (a, b, infinite = false) => {
      let ax = cx(a), ay = cy(a), aw = cw(a);
      let bx = cx(b), by = cy(b), bw = cw(b);
      if (persp) {
        // Clip to what's in front of the camera, so a long line running past it still projects.
        if (aw < near && bw < near) return Infinity;
        if (aw < near) { const t = (near - aw) / (bw - aw); ax += (bx - ax) * t; ay += (by - ay) * t; aw = near; }
        else if (bw < near) { const t = (near - bw) / (aw - bw); bx += (ax - bx) * t; by += (ay - by) * t; bw = near; }
      }
      const sax = ((ax / aw + 1) / 2) * W, say = ((1 - ay / aw) / 2) * H;
      const sbx = ((bx / bw + 1) / 2) * W, sby = ((1 - by / bw) / 2) * H;
      const dx = sbx - sax, dy = sby - say;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) return Math.hypot(sax - px, say - py);
      let t = ((px - sax) * dx + (py - say) * dy) / len2;
      if (!infinite) t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(sax + dx * t - px, say + dy * t - py);
    },
    segmentPointUnderPointer: (a, b) => {
      const ax = cx(a), ay = cy(a), aw = cw(a);
      const bx = cx(b), by = cy(b), bw = cw(b);
      if (persp && (aw < near || bw < near)) return null;
      const sax = ((ax / aw + 1) / 2) * W, say = ((1 - ay / aw) / 2) * H;
      const sbx = ((bx / bw + 1) / 2) * W, sby = ((1 - by / bw) / 2) * H;
      const dx = sbx - sax, dy = sby - say;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) return null;
      const ts = Math.min(1, Math.max(0, ((px - sax) * dx + (py - say) * dy) / len2));
      // Screen-space fraction back to a fraction of the 3-D segment (perspective-correct).
      const denom = ts * aw + (1 - ts) * bw;
      if (!persp || Math.abs(denom) < 1e-12) return a.clone().lerp(b, ts);
      return a.clone().lerp(b, (ts * aw) / denom);
    },
    onScreen: v => {
      const w = cw(v);
      if (persp ? w < near : false) return false;
      const x = cx(v) / w, y = cy(v) / w;
      return Number.isFinite(x) && Number.isFinite(y) && x >= -1 && x <= 1 && y >= -1 && y <= 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** The point on the infinite line nearest the pointer's ray. */
function nearestOnLineToRay(origin: V3, dir: V3, ray: THREE.Ray): V3 {
  const w0 = origin.clone().sub(ray.origin);
  const b = dir.dot(ray.direction);
  const d = dir.dot(w0), e = ray.direction.dot(w0);
  const denom = 1 - b * b;
  if (denom < 1e-9) return origin.clone();
  // Looking almost along the line, the nearest point is anywhere far along it: keep it near.
  const s = Math.max(-LINE_REACH, Math.min(LINE_REACH, (b * e - d) / denom));
  return origin.clone().addScaledVector(dir, s);
}

/** Closest points between two infinite lines; null if parallel. */
function lineLine(o1: V3, d1: V3, o2: V3, d2: V3): { p1: V3; p2: V3; gap: number } | null {
  const w0 = o1.clone().sub(o2);
  const a = d1.dot(d1), b = d1.dot(d2), c = d2.dot(d2), d = d1.dot(w0), e = d2.dot(w0);
  const denom = a * c - b * b;
  if (denom < 1e-9) return null;
  const s = (b * e - c * d) / denom;
  const t = (a * e - b * d) / denom;
  const p1 = o1.clone().addScaledVector(d1, s), p2 = o2.clone().addScaledVector(d2, t);
  return { p1, p2, gap: p1.distanceTo(p2) };
}

/** Where an infinite line crosses a segment (within a millimetre), or null. */
function lineSegmentCrossing(o: V3, dir: V3, a: V3, b: V3): V3 | null {
  const sd = b.clone().sub(a);
  const len = sd.length();
  if (len < 1e-9) return null;
  const u = sd.clone().divideScalar(len);
  const r = lineLine(o, dir, a, u);
  if (!r || r.gap > ON_LINE) return null;
  const t = r.p2.clone().sub(a).dot(u);
  if (t < -ON_LINE || t > len + ON_LINE) return null;
  return r.p2;
}

const distToLine = (p: V3, o: V3, dir: V3): number => {
  const rel = p.clone().sub(o);
  return rel.sub(dir.clone().multiplyScalar(rel.dot(dir))).length();
};
const footOnLine = (p: V3, o: V3, dir: V3): V3 => o.clone().addScaledVector(dir, p.clone().sub(o).dot(dir));

// ---------------------------------------------------------------------------
// The model's snappable things, cached per revision
// ---------------------------------------------------------------------------

interface Cached {
  revision: number;
  points: { p: V3; kind: 'endpoint' | 'midpoint' | 'center' }[];
  edges: { id: EdgeId; a: V3; b: V3 }[];
}
const cache = new WeakMap<Graph, Cached>();
const POINT_CAP = 3000;

function model(g: Graph, revision: number | undefined): Cached {
  const hit = cache.get(g);
  if (hit && revision !== undefined && hit.revision === revision) return hit;
  const points: Cached['points'] = [];
  const edges: Cached['edges'] = [];
  let n = 0;
  for (const v of g.vertices.values()) {
    if (v.edges.length === 0 || n++ >= POINT_CAP) continue;
    points.push({ p: new THREE.Vector3(v.position.x, v.position.y, v.position.z), kind: 'endpoint' });
  }
  n = 0;
  for (const [id, e] of g.edges) {
    if (e.hidden) continue;
    const [a, b] = edgePoints(g, e);
    const va = new THREE.Vector3(a.x, a.y, a.z), vb = new THREE.Vector3(b.x, b.y, b.z);
    edges.push({ id, a: va, b: vb });
    if (n++ < POINT_CAP) points.push({ p: va.clone().add(vb).multiplyScalar(0.5), kind: 'midpoint' });
  }
  n = 0;
  for (const f of g.faces.values()) {
    if (n++ >= POINT_CAP || f.attributes.hidden) continue;
    const pts = loopPoints(g, f.outerLoop);
    if (pts.length < 3) continue;
    const c = new THREE.Vector3();
    for (const p of pts) c.add(new THREE.Vector3(p.x, p.y, p.z));
    points.push({ p: c.divideScalar(pts.length), kind: 'center' });
  }
  const entry: Cached = { revision: revision ?? -1, points, edges };
  cache.set(g, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// The function
// ---------------------------------------------------------------------------

interface PointCandidate {
  p: V3;
  marker: V3;
  kind: SnapKind;
  label: string;
  rank: number;
}

const labelOf = (kind: SnapKind, custom?: string): string =>
  custom ?? ({
    endpoint: 'Endpoint', midpoint: 'Midpoint', center: 'Center', origin: 'Origin', close: 'Close',
    intersection: 'Intersection', edge: 'On edge', guide: 'On guide',
  } as Record<string, string>)[kind] ?? kind;

/**
 * A snap is where the pointer means; one that lands off the canvas (or behind the camera, or
 * isn't a number) never is, so it is dropped in favour of the plain pointer position. A held
 * lock is exempt: it keeps its line whatever the pointer does.
 */
export function computeSnap(inp: SnapInput): SnapResult {
  const result = computeSnapUnguarded(inp);
  if (result.kind === 'none' || result.kind === 'lock') return result;
  const p = result.point;
  const finite = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  if (finite) {
    const screen = makeScreen(inp);
    const pointerOnCanvas = inp.pointer.x >= 0 && inp.pointer.x <= inp.size.width && inp.pointer.y >= 0 && inp.pointer.y <= inp.size.height;
    if (!pointerOnCanvas || screen.onScreen(p)) return result;
  }
  return { point: inp.cursor.clone(), marker: null, kind: 'none', label: '', guides: [], line: null, hoverEdge: result.hoverEdge };
}

function computeSnapUnguarded(inp: SnapInput): SnapResult {
  const screen = makeScreen(inp);
  const plane = inp.plane ?? null;
  const from = inp.from ?? null;
  const m = model(inp.graph, inp.revision);
  const guides = inp.guides ?? [];

  const onPlane = (p: V3): V3 => (plane ? plane.projectPoint(p, new THREE.Vector3()) : p.clone());
  const free: SnapResult = { point: inp.cursor.clone(), marker: null, kind: 'none', label: '', guides: [], line: null, hoverEdge: null };

  // The edge under the pointer (for highlighting, resting on, and crossings).
  const near: { a: V3; b: V3; id: EdgeId | -1; dist: number; guide: boolean }[] = [];
  for (const e of m.edges) {
    const d = screen.segmentDist(e.a, e.b);
    if (d <= NEAR_EDGE_PX) near.push({ a: e.a, b: e.b, id: e.id, dist: d, guide: false });
  }
  for (const [a, b] of guides) {
    const d = screen.segmentDist(a, b);
    if (d <= NEAR_EDGE_PX) near.push({ a, b, id: -1, dist: d, guide: true });
  }
  near.sort((x, y) => x.dist - y.dist);
  near.length = Math.min(near.length, NEAR_EDGE_LIMIT);
  const hovered = near.find(e => !e.guide && e.dist <= (RADIUS_PX.edge ?? 8)) ?? null;
  const hoverEdge: HoverEdge | null = hovered ? { a: hovered.a, b: hovered.b, id: hovered.id } : null;
  free.hoverEdge = hoverEdge;

  // ---- Point candidates -------------------------------------------------------------------
  const points: PointCandidate[] = [];
  const offer = (marker: V3, kind: SnapKind, label: string, dist: number) => {
    const radius = RADIUS_PX[kind];
    if (radius === undefined || dist > radius) return;
    points.push({ p: onPlane(marker), marker, kind, label, rank: dist - (PREFER_PX[kind] ?? 0) });
  };

  for (const c of m.points) offer(c.p, c.kind, labelOf(c.kind), screen.pointDist(c.p));
  for (const c of inp.extraPoints ?? []) offer(c.point, c.kind, labelOf(c.kind, c.label), screen.pointDist(c.point));
  offer(new THREE.Vector3(0, 0, 0), 'origin', 'Origin', screen.pointDist(new THREE.Vector3()));
  if (inp.closePoint) offer(inp.closePoint, 'close', 'Close', screen.pointDist(inp.closePoint));
  for (const c of inp.guideCrossings ?? []) offer(c, 'intersection', 'Guide crossing', screen.pointDist(c));

  // Where two edges (or guides) cross, in space.
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const x = segmentCrossing(near[i]!.a, near[i]!.b, near[j]!.a, near[j]!.b);
      if (x) offer(x, 'intersection', 'Intersection', screen.pointDist(x));
    }
  }

  // Any point ON an edge or guide - the weakest snap, and what splits an edge.
  for (const e of near) {
    // The point that appears under the pointer. (The nearest point to the ray in 3-D can be
    // anywhere along an edge that points towards the camera, and put the snap far off.)
    let target = screen.segmentPointUnderPointer(e.a, e.b);
    if (!target) { target = new THREE.Vector3(); inp.ray.distanceSqToSegment(e.a, e.b, undefined, target); }
    // Put on the drawing plane, it must still be about where the pointer is: an edge standing
    // off the plane would otherwise pull the point somewhere else on screen.
    if (plane && screen.pointDist(onPlane(target)) > OFF_PLANE_EDGE_PX) continue;
    offer(target, e.guide ? 'guide' : 'edge', e.guide ? 'On guide' : 'On edge', e.dist);
  }

  points.sort((x, y) => x.rank - y.rank);
  const strong = points.find(p => p.kind !== 'edge' && p.kind !== 'guide') ?? null;
  const weak = points.find(p => p.kind === 'edge' || p.kind === 'guide') ?? null;

  const result = (c: PointCandidate, extra: Partial<SnapResult> = {}): SnapResult => ({
    point: c.p, marker: c.marker, kind: c.kind, label: c.label, guides: [], line: null, hoverEdge, ...extra,
  });

  // ---- A held lock -------------------------------------------------------------------------
  if (inp.lockLine) return lockedSnap(inp, screen, plane, inp.lockLine, points, near, hoverEdge);

  // ---- Strong points win outright ---------------------------------------------------------
  if (strong) return result(strong);

  // ---- Direction inferences ---------------------------------------------------------------
  if (inp.inference !== false) {
    const lines = inferenceLines(inp, plane, m);
    const hit = bestInference(inp, screen, plane, lines, near);
    if (hit) {
      // A crossing or an on-line edge-point beats sliding along a line; an on-edge point only
      // beats a plain line when the pointer is nearer to it.
      if (hit.crossing || !weak || hit.dist < weak.rank) return { ...hit.result, hoverEdge };
    }
  }

  if (weak) return result(weak);
  return free;
}

/** Where two segments cross (within a millimetre), or null - parallel and skew pairs miss. */
function segmentCrossing(a0: V3, a1: V3, b0: V3, b1: V3): V3 | null {
  const da = a1.clone().sub(a0), db = b1.clone().sub(b0);
  const la = da.length(), lb = db.length();
  if (la < 1e-9 || lb < 1e-9) return null;
  da.divideScalar(la); db.divideScalar(lb);
  const r = lineLine(a0, da, b0, db);
  if (!r || r.gap > ON_LINE) return null;
  const ta = r.p1.clone().sub(a0).dot(da), tb = r.p2.clone().sub(b0).dot(db);
  if (ta < -ON_LINE || ta > la + ON_LINE || tb < -ON_LINE || tb > lb + ON_LINE) return null;
  // Meeting at an end of both is a corner, and the corner is offered already.
  const atEnd = (t: number, l: number) => t < ON_LINE || t > l - ON_LINE;
  if (atEnd(ta, la) && atEnd(tb, lb)) return null;
  return r.p1.clone().add(r.p2).multiplyScalar(0.5);
}

// ---------------------------------------------------------------------------
// Inference lines
// ---------------------------------------------------------------------------

function axisLines(origin: V3, plane: THREE.Plane | null, kind: SnapKind, prefix: string): SnapLine[] {
  const out: SnapLine[] = [];
  for (const key of ['x', 'z', 'y'] as AxisName[]) {
    const a = AXES[key];
    if (plane && Math.abs(a.dir.dot(plane.normal)) > 0.02) continue; // must lie in the drawing plane
    out.push({ origin, dir: a.dir.clone(), color: a.color, label: `${prefix}${a.name}`, kind });
  }
  return out;
}

function inferenceLines(inp: SnapInput, plane: THREE.Plane | null, m: Cached): SnapLine[] {
  const out: SnapLine[] = [];
  const from = inp.from ?? null;
  if (from) {
    out.push(...axisLines(from, plane, 'axis', 'On '));

    // Parallel / perpendicular to the edge you rested on.
    const ref = inp.refEdge ?? inp.memory?.edge ?? null;
    if (ref) {
      const d = ref.b.clone().sub(ref.a);
      if (d.lengthSq() > 1e-12) {
        d.normalize();
        out.push({ origin: from, dir: d, color: PARALLEL_COLOR, label: 'Parallel to edge', kind: 'parallel' });
        const n = plane?.normal ?? new THREE.Vector3(0, 1, 0);
        const perp = new THREE.Vector3().crossVectors(n, d);
        if (perp.lengthSq() > 1e-9) {
          out.push({ origin: from, dir: perp.normalize(), color: PARALLEL_COLOR, label: 'Perpendicular to edge', kind: 'perpendicular' });
        }
      }
    }

    // Continuing an edge: the pen sits on an edge's line, so its continuation is offered.
    for (const e of m.edges) {
      const d = e.b.clone().sub(e.a);
      const len = d.length();
      if (len < 1e-9) continue;
      d.divideScalar(len);
      if (distToLine(from, e.a, d) > ON_LINE) continue;
      if (plane && Math.abs(d.dot(plane.normal)) > 0.02) continue;
      out.push({ origin: from, dir: d, color: EXTENSION_COLOR, label: 'On edge extension', kind: 'extension' });
    }
  }
  // Lined up with a corner you rested on.
  for (const q of inp.memory?.points ?? []) {
    if (from && q.distanceTo(from) < ON_LINE) continue;
    out.push(...axisLines(q, plane, 'from', 'From point on '));
  }
  return out;
}

interface InferenceHit {
  result: SnapResult;
  dist: number;
  crossing: boolean;
}

function bestInference(
  inp: SnapInput,
  screen: Screen,
  plane: THREE.Plane | null,
  lines: SnapLine[],
  near: { a: V3; b: V3; guide: boolean }[],
): InferenceHit | null {
  const reach = (l: SnapLine): [V3, V3] => [
    l.origin.clone().addScaledVector(l.dir, -LINE_REACH),
    l.origin.clone().addScaledVector(l.dir, LINE_REACH),
  ];
  const guideTo = (l: SnapLine, p: V3): SnapGuide => ({ a: l.origin, b: p, color: l.color, dashed: true });
  const candidates: InferenceHit[] = [];
  const inPlane = (p: V3) => !plane || Math.abs(plane.distanceToPoint(p)) < 1e-3;

  // Two lines meeting (from different origins): the point lined up with both.
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!, b = lines[j]!;
      if (a.origin.distanceTo(b.origin) < ON_LINE) continue;
      const r = lineLine(a.origin, a.dir, b.origin, b.dir);
      if (!r || r.gap > ON_LINE) continue;
      const p = r.p1.clone().add(r.p2).multiplyScalar(0.5);
      if (!inPlane(p)) continue;
      const d = screen.pointDist(p);
      if (d > CROSSING_PX) continue;
      candidates.push({
        dist: d - 6, crossing: true,
        result: {
          point: p, marker: p, kind: 'from', label: 'Aligned with both', hoverEdge: null,
          guides: [guideTo(a, p), guideTo(b, p)], line: null,
        },
      });
    }
  }

  // A line meeting an edge: exactly where they cross.
  for (const l of lines) {
    for (const e of near) {
      const x = lineSegmentCrossing(l.origin, l.dir, e.a, e.b);
      if (!x || !inPlane(x)) continue;
      const d = screen.pointDist(x);
      if (d > CROSSING_PX) continue;
      candidates.push({
        dist: d - 4, crossing: true,
        result: {
          point: x, marker: x, kind: 'intersection', label: `${l.label} meets edge`, hoverEdge: null,
          guides: [guideTo(l, x)], line: l,
        },
      });
    }
  }

  // A single line: slide along it.
  for (const l of lines) {
    const [a, b] = reach(l);
    const d = screen.segmentDist(a, b, true);
    if (d > LINE_PX) continue;
    const p = plane ? footOnLine(inp.cursor, l.origin, l.dir) : nearestOnLineToRay(l.origin, l.dir, inp.ray);
    candidates.push({
      dist: d + (l.kind === 'axis' ? 0 : -1), crossing: false,
      result: {
        point: p, marker: null, kind: l.kind, label: l.label, hoverEdge: null,
        guides: [guideTo(l, p)], line: l,
      },
    });
  }

  candidates.sort((x, y) => x.dist - y.dist);
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// A held lock
// ---------------------------------------------------------------------------

function lockedSnap(
  inp: SnapInput,
  screen: Screen,
  plane: THREE.Plane | null,
  line: SnapLine,
  points: { p: V3; marker: V3; kind: SnapKind; label: string; rank: number }[],
  near: { a: V3; b: V3; guide: boolean }[],
  hoverEdge: HoverEdge | null,
): SnapResult {
  const dir = line.dir.clone().normalize();
  const guide: SnapGuide = {
    a: line.origin.clone().addScaledVector(dir, -LINE_REACH),
    b: line.origin.clone().addScaledVector(dir, LINE_REACH),
    color: line.color, dashed: false,
  };
  const out = (point: V3, kind: SnapKind, label: string, marker: V3 | null, extra: SnapGuide[] = []): SnapResult =>
    ({ point, marker, kind, label, guides: [guide, ...extra], line, hoverEdge });

  // A corner (or midpoint ...) the pointer is near: the point on the line lined up with it, or
  // the corner itself when it already sits on the line.
  let best: { r: number; res: SnapResult } | null = null;
  for (const c of points) {
    if (c.kind === 'edge' || c.kind === 'guide') continue;
    const foot = footOnLine(c.marker, line.origin, dir);
    const onLine = distToLine(c.marker, line.origin, dir) <= ON_LINE;
    const res = onLine
      ? out(c.marker.clone(), c.kind, c.label, c.marker)
      : out(foot, 'from', `Aligned with ${c.label.toLowerCase()}`, foot, [{ a: c.marker, b: foot, color: line.color, dashed: true }]);
    const r = c.rank + (onLine ? 0 : 3);
    if (!best || r < best.r) best = { r, res };
  }
  // Where the line crosses an edge.
  for (const e of near) {
    const x = lineSegmentCrossing(line.origin, dir, e.a, e.b);
    if (!x) continue;
    const d = screen.pointDist(x);
    if (d > CROSSING_PX) continue;
    const r = d - PREFER_PX.intersection!;
    if (!best || r < best.r) best = { r, res: out(x, 'intersection', 'Intersection', x) };
  }
  if (best) return best.res;

  const p = plane ? footOnLine(inp.cursor, line.origin, dir) : nearestOnLineToRay(line.origin, dir, inp.ray);
  return out(p, 'lock', `Locked: ${line.label}`, null);
}

/** A held axis line through `origin`. */
export function axisLock(origin: V3, axis: AxisName): SnapLine {
  const a = AXES[axis];
  return { origin: origin.clone(), dir: a.dir.clone(), color: a.color, label: a.name, kind: 'axis' };
}

/** A line through `origin` parallel or perpendicular to an edge, for the Down-arrow lock. */
export function edgeLock(origin: V3, edge: HoverEdge, mode: 'parallel' | 'perpendicular', plane?: THREE.Plane | null): SnapLine | null {
  const d = edge.b.clone().sub(edge.a);
  if (d.lengthSq() < 1e-12) return null;
  d.normalize();
  let dir = d;
  if (mode === 'perpendicular') {
    dir = new THREE.Vector3().crossVectors(plane?.normal ?? new THREE.Vector3(0, 1, 0), d);
    if (dir.lengthSq() < 1e-9) return null;
    dir.normalize();
  }
  return { origin: origin.clone(), dir, color: PARALLEL_COLOR, label: mode === 'parallel' ? 'Parallel to edge' : 'Perpendicular to edge', kind: mode };
}

export const SNAP_MARKER_COLOR = POINT_COLOR;
