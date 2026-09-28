/**
 * Roofs for any building outline, from its straight skeleton.
 *
 * The straight skeleton of the eave outline is the plan of a hip roof: one face per eave edge,
 * every face at the same pitch, with ridges, hips and valleys where faces meet. It works for L, T
 * and U plans, bays, and curved walls (drawn as many short straight pieces). A gable roof is the
 * same thing with each wing's end triangle turned up into a vertical gable: its top point moves
 * out along the ridge to the eave line, which keeps both side slopes flat.
 *
 * The skeleton itself comes from CGAL (the `straight-skeleton` package, WebAssembly), which is
 * robust where hand-written skeletons are not. It has to be loaded once with `initRoofSkeleton()`
 * before use; until then `buildRoofModel` returns null and callers keep their older roof.
 *
 * Everything is roof-local: x/z in plan, y up from the top of the walls (the eave line is y = 0).
 */
import type { V2 } from './roofSurface';

export type V3 = [number, number, number];
export type RoofEdgeKind = 'ridge' | 'hip' | 'valley' | 'rake' | 'wall';

export interface RoofFace {
  /** Index of the eave edge this face rises from (eave[edge] → eave[edge + 1]). */
  edge: number;
  /** Node indices round the face, starting with the eave edge's end corner. */
  verts: number[];
  /** A vertical gable end rather than a roof slope. */
  gable: boolean;
}

export interface RoofEdge {
  a: number;
  b: number;
  kind: RoofEdgeKind;
  /** The two faces either side. */
  faces: [number, number];
}

export interface RoofModel {
  /** Eave outline, counter-clockwise, with straight-through corners removed. */
  eave: V2[];
  /** The matching wall-top outline (same corners as `eave`). */
  wall: V2[];
  /** Skeleton nodes; the first `eave.length` are the eave corners (y = 0). */
  nodes: V3[];
  faces: RoofFace[];
  edges: RoofEdge[];
  /** Roof pitch, radians (every slope has it). */
  pitch: number;
  /** Height of the highest point above the eaves. */
  ridgeHeight: number;
}

interface Builder {
  buildFromPolygon(coordinates: number[][][]): { vertices: number[][]; polygons: number[][] } | null;
}

let builder: Builder | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the skeleton code (once). The package is built for browsers; under Node it needs
 * `self` and `window` to exist while it starts, so they're lent for that moment only.
 */
export function initRoofSkeleton(): Promise<void> {
  loading ??= (async () => {
    const g = globalThis as Record<string, unknown>;
    const lent = ['self', 'window'].filter(k => !(k in g));
    for (const k of lent) g[k] = g;
    try {
      const mod = (await import('straight-skeleton')) as unknown as { SkeletonBuilder?: unknown; default?: { SkeletonBuilder?: unknown } };
      const SB = (mod.SkeletonBuilder ?? mod.default?.SkeletonBuilder) as (Builder & { init(): Promise<void> }) | undefined;
      if (!SB) throw new Error('straight-skeleton did not load');
      await SB.init();
      builder = SB;
    } finally {
      for (const k of lent) delete g[k];
    }
  })().catch(err => {
    loading = null;
    console.warn('[roof] Roof skeleton unavailable; using simple roofs.', err);
  });
  return loading;
}

export const roofSkeletonReady = () => builder !== null;

// --- Small plan helpers --------------------------------------------------------------------------

const signedArea = (p: V2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
};
const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Unit direction along eave edge i, and its inward normal (into a counter-clockwise outline). */
export function edgeFrame(eave: V2[], i: number) {
  const a = eave[i], b = eave[(i + 1) % eave.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const inward: V2 = [-u[1], u[0]];
  return { a, b, u, inward, len };
}

/**
 * Drops repeated corners and corners the outline runs straight through (they'd make zero-width
 * roof faces), and returns the kept corner indices so the wall outline can follow.
 */
function cleanOutline(eave: V2[]): number[] {
  let keep = eave.map((_, i) => i);
  for (let pass = 0; pass < 3; pass++) {
    const next = keep.filter((idx, k) => {
      const prev = eave[keep[(k - 1 + keep.length) % keep.length]], cur = eave[idx], nxt = eave[keep[(k + 1) % keep.length]];
      if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) < 1e-4) return false;
      const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]), l2 = Math.hypot(nxt[0] - cur[0], nxt[1] - cur[1]);
      const sin = cross(prev, cur, nxt) / ((l1 * l2) || 1);
      const dot = (cur[0] - prev[0]) * (nxt[0] - cur[0]) + (cur[1] - prev[1]) * (nxt[1] - cur[1]);
      return !(Math.abs(sin) < 1e-4 && dot > 0);
    });
    if (next.length === keep.length) break;
    keep = next;
  }
  return keep;
}

/** A repeatable tiny nudge (for outlines too symmetric for the skeleton maths, like a circle). */
const nudge = (i: number, k: number) => {
  const s = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};

// --- The model -----------------------------------------------------------------------------------

export interface RoofModelOptions {
  /** Gable ends on each wing (otherwise hipped all round). */
  gable?: boolean;
  /** Pitch in degrees. Used unless `ridgeHeight` is given. */
  pitchDeg?: number;
  /** Height of the highest point above the eaves; the pitch follows from it. */
  ridgeHeight?: number;
}

/** The roof over an eave outline (with its wall outline), or null if the skeleton isn't loaded or fails. */
export function buildRoofModel(eaveIn: V2[], wallIn: V2[], opts: RoofModelOptions = {}): RoofModel | null {
  if (!builder || eaveIn.length < 3 || wallIn.length !== eaveIn.length) return null;
  const ccw = signedArea(eaveIn) > 0;
  const order = ccw ? eaveIn.map((_, i) => i) : eaveIn.map((_, i) => eaveIn.length - 1 - i);
  const eave0 = order.map(i => eaveIn[i]);
  const wall0 = order.map(i => wallIn[i]);
  const keep = cleanOutline(eave0);
  if (keep.length < 3) return null;
  const eave = keep.map(i => eave0[i]);
  const wall = keep.map(i => wall0[i]);
  const n = eave.length;

  // CGAL, with a tiny repeatable nudge if an outline is too symmetric for it.
  let result: { vertices: number[][]; polygons: number[][] } | null = null;
  for (const amp of [0, 1e-6, 1e-5, 1e-4, 1e-3]) {
    const ring = eave.map(([x, z], i) => [x + amp * nudge(i, 0), z + amp * nudge(i, 1)]);
    try { result = builder.buildFromPolygon([[...ring, ring[0]]]); } catch { result = null; }
    if (result && result.polygons.length === n) break;
    result = null;
  }
  if (!result) return null;

  // Nodes: the eave corners exactly as given, then the skeleton's own points.
  const map = new Map<number, number>();
  const times: number[] = eave.map(() => 0);
  const plan: V2[] = eave.map(p => [p[0], p[1]]);
  result.vertices.forEach((v, idx) => {
    if (v[2] < 1e-9) {
      let best = -1, bd = Infinity;
      eave.forEach((p, i) => { const d = Math.hypot(p[0] - v[0], p[1] - v[1]); if (d < bd) { bd = d; best = i; } });
      if (bd < 1e-2) { map.set(idx, best); return; }
    }
    map.set(idx, plan.length);
    plan.push([v[0], v[1]]);
    times.push(v[2]);
  });

  // One face per eave edge.
  const faces: RoofFace[] = [];
  for (const poly of result.polygons) {
    const verts = poly.map(i => map.get(i)!);
    const m = verts.length;
    let edge = -1, start = 0;
    for (let k = 0; k < m; k++) {
      const s = verts[k], e = verts[(k + 1) % m];
      if (s < n && e < n && (s + 1) % n === e) { edge = s; start = (k + 1) % m; break; }
    }
    if (edge < 0) return null;
    // Rotate so it starts at the edge's end corner (…, then the edge's start corner last).
    faces.push({ edge, verts: [...verts.slice(start), ...verts.slice(0, start)], gable: false });
  }
  faces.sort((a, b) => a.edge - b.edge);
  if (faces.some((f, i) => f.edge !== i)) return null;

  const maxTime = Math.max(...times);
  if (!(maxTime > 1e-6)) return null;
  const tan = opts.ridgeHeight !== undefined
    ? Math.max(0.05, opts.ridgeHeight) / maxTime
    : Math.tan(((opts.pitchDeg ?? 35) * Math.PI) / 180);
  const nodes: V3[] = plan.map((p, i) => [p[0], times[i] * tan, p[1]]);

  // Neighbouring nodes along skeleton lines (not along eave edges).
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!links.has(a)) links.set(a, new Set());
    links.get(a)!.add(b);
  };
  for (const f of faces) {
    for (let k = 0; k < f.verts.length; k++) {
      const a = f.verts[k], b = f.verts[(k + 1) % f.verts.length];
      if (a < n && b < n && ((a + 1) % n === b || (b + 1) % n === a)) continue;
      link(a, b); link(b, a);
    }
  }

  // Gable ends: a wing's end triangle whose top point starts a level ridge running straight
  // back from that end. The top point slides out along the ridge to the eave line.
  if (opts.gable) {
    const convex = (i: number) => cross(eave[(i - 1 + n) % n], eave[i], eave[(i + 1) % n]) > 1e-9;
    for (const f of faces) {
      if (f.verts.length !== 3) continue;
      const { a, b, inward, len } = edgeFrame(eave, f.edge);
      if (len < 1.2 || !convex(f.edge) || !convex((f.edge + 1) % n)) continue;
      const apex = f.verts[1];
      if (apex < n) continue;
      const others = [...(links.get(apex) ?? [])].filter(x => x !== f.edge && x !== (f.edge + 1) % n);
      if (others.length !== 1) continue;
      const r = others[0];
      const [ax, ay, az] = nodes[apex], [rx, ry, rz] = nodes[r];
      const run = Math.hypot(rx - ax, rz - az);
      // The ridge has to run back from this end, near enough square to it and near enough level
      // (walls drawn by hand are rarely exact).
      if (run < 0.3 || Math.abs(ry - ay) / run > 0.1) continue;
      const along = ((rx - ax) * inward[0] + (rz - az) * inward[1]) / run;
      if (along < Math.cos((20 * Math.PI) / 180)) continue;
      // Slide the top point out along the ridge line (which lies in both side slopes, so they
      // stay flat) until it reaches the eave edge's line.
      const back = (ax - a[0]) * inward[0] + (az - a[1]) * inward[1];
      const k = back / (along * run);
      const px = ax + (ax - rx) * k, py = ay + (ay - ry) * k, pz = az + (az - rz) * k;
      const t = ((px - a[0]) * (b[0] - a[0]) + (pz - a[1]) * (b[1] - a[1])) / (len * len);
      if (t < 0.05 || t > 0.95) continue;
      nodes[apex] = [px, py, pz];
      f.gable = true;
    }
    // A square's skeleton is a pyramid, with no ridge to slide along: give it one, running
    // across (along x, like a rectangle that's as wide as it is deep), with gables at its ends.
    if (n === 4 && !faces.some(f => f.gable) && faces.every(f => f.verts.length === 3 && f.verts[1] === faces[0].verts[1])) {
      const apex = faces[0].verts[1];
      const [ax, ay, az] = nodes[apex];
      const ends = [0, 1, 2, 3].filter(i => Math.abs(edgeFrame(eave, i).u[1]) > Math.abs(edgeFrame(eave, i).u[0]));
      if (ends.length === 2 && (ends[1] - ends[0]) === 2) {
        const top = ends.map(i => {
          const { a, inward } = edgeFrame(eave, i);
          const back = (ax - a[0]) * inward[0] + (az - a[1]) * inward[1];
          nodes.push([ax - inward[0] * back, ay, az - inward[1] * back]);
          return nodes.length - 1;
        });
        const onPlane = (fi: number, v: number) => Math.abs(planeHeight(eave, fi, [nodes[v][0], nodes[v][2]], tan) - nodes[v][1]) < 1e-6 * Math.max(1, ay);
        const sides = [0, 1, 2, 3].filter(i => !ends.includes(i));
        if (sides.every(s => top.every(v => onPlane(s, v)))) {
          ends.forEach((i, k) => { faces[i].verts = [(i + 1) % n, top[k], i]; faces[i].gable = true; });
          for (const s of sides) {
            // From this edge's end corner up to the gable top beside it, across the ridge, and down.
            const endCorner = (s + 1) % n;
            const near = ends.findIndex(i => i === endCorner);
            const first = top[near], second = top[1 - near];
            faces[s].verts = [endCorner, first, second, s];
          }
        } else nodes.length -= 2;
      }
    }
  }

  // Skeleton lines, and what each one is on the roof.
  const faceOf = new Map<string, number[]>();
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.verts.length; k++) {
      const a = f.verts[k], b = f.verts[(k + 1) % f.verts.length];
      if (a < n && b < n && ((a + 1) % n === b || (b + 1) % n === a)) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!faceOf.has(key)) faceOf.set(key, []);
      faceOf.get(key)!.push(fi);
    }
  });
  const edges: RoofEdge[] = [];
  for (const [key, fs] of faceOf) {
    const [a, b] = key.split(',').map(Number);
    const pair: [number, number] = [fs[0], fs[1] ?? fs[0]];
    let kind: RoofEdgeKind;
    if (fs.some(fi => faces[fi].gable)) kind = 'rake';
    else if (a < n || b < n) {
      const c = a < n ? a : b;
      kind = cross(eave[(c - 1 + n) % n], eave[c], eave[(c + 1) % n]) > 0 ? 'hip' : 'valley';
    } else {
      const run = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][2] - nodes[b][2]);
      const level = Math.abs(nodes[a][1] - nodes[b][1]) <= Math.max(1e-6, run * 0.05);
      // Just inside one face, is that face's slope the lower of the two (a crest) or the higher (a valley)?
      const mid: V2 = [(nodes[a][0] + nodes[b][0]) / 2, (nodes[a][2] + nodes[b][2]) / 2];
      const f0 = faces[pair[0]], f1 = faces[pair[1]];
      const into = faceCentroid(nodes, f0);
      const p: V2 = [mid[0] + (into[0] - mid[0]) * 0.05, mid[1] + (into[1] - mid[1]) * 0.05];
      const h0 = planeHeight(eave, f0.edge, p, tan), h1 = planeHeight(eave, f1.edge, p, tan);
      const crest = h0 <= h1 + 1e-9;
      kind = crest ? (level ? 'ridge' : 'hip') : 'valley';
    }
    edges.push({ a, b, kind, faces: pair });
  }

  return { eave, wall, nodes, faces, edges, pitch: Math.atan(tan), ridgeHeight: maxTime * tan };
}

/** Height of eave edge i's roof plane over a plan point (it rises inward at the pitch). */
export function planeHeight(eave: V2[], i: number, p: V2, tan: number) {
  const { a, inward } = edgeFrame(eave, i);
  return ((p[0] - a[0]) * inward[0] + (p[1] - a[1]) * inward[1]) * tan;
}

function faceCentroid(nodes: V3[], f: RoofFace): V2 {
  let x = 0, z = 0;
  for (const v of f.verts) { x += nodes[v][0]; z += nodes[v][2]; }
  return [x / f.verts.length, z / f.verts.length];
}

/** A face's outline in plan. */
export const facePlan = (m: RoofModel, f: RoofFace): V2[] => f.verts.map(v => [m.nodes[v][0], m.nodes[v][2]]);

/** Top of the roof over a plan point, or null outside it. */
export function roofHeightAt(m: RoofModel, x: number, z: number): number | null {
  const tan = Math.tan(m.pitch);
  for (const f of m.faces) {
    if (f.gable) continue;
    if (pointInPolygon([x, z], facePlan(m, f))) return planeHeight(m.eave, f.edge, [x, z], tan);
  }
  return null;
}

/** Neighbouring faces meeting at less than this in plan are a curve's facets, not a real hip. */
const CURVE_CREASE = Math.sin((20 * Math.PI) / 180);

/** Whether a skeleton line is just the crease between two facets of a curved wall's roof. */
export function isCurveCrease(m: RoofModel, e: { faces: [number, number] }): boolean {
  const u1 = edgeFrame(m.eave, m.faces[e.faces[0]].edge).u, u2 = edgeFrame(m.eave, m.faces[e.faces[1]].edge).u;
  return Math.abs(u1[0] * u2[1] - u1[1] * u2[0]) < CURVE_CREASE && u1[0] * u2[0] + u1[1] * u2[1] > 0;
}
