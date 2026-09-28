/**
 * Roofs over extensions: the part of a storey that sticks out beyond the storey above, so its
 * roof meets the house wall instead of rising to a ridge of its own.
 *
 * - Lean-to: one slope (or, round a canted bay, a few) rising from the eaves to the house wall,
 *   with a verge and a gable cheek at each side.
 * - Pitched: a gable roof whose ridge runs back into the house wall (a gable-fronted extension),
 *   made by roofing the extension continued back through the house and cutting it at the wall.
 *
 * Both come out as a RoofModel (see roofSkeleton.ts), so slopes, tiles, caps, fascia, soffits and
 * timber all work the same as for any roof. Where the roof meets the house, its top line is a
 * 'wall' line (a ledger and lead flashing, no fascia or gutter). Everything is roof-local.
 */
import { buildRoofModel, pointInPolygon, planeHeight, type RoofEdge, type RoofEdgeKind, type RoofFace, type RoofModel, type V3 } from './roofSkeleton';
import type { V2 } from './roofSurface';

export type ExtensionKind = 'lean-to' | 'pitched';

export interface ExtensionOptions {
  kind: ExtensionKind;
  overhang: number;
  /** Thickness of the house wall the roof meets (the roof stops at its outer face). */
  wallThickness: number;
  pitchDeg?: number;
  /** Rise of the roof where it meets the house wall (instead of a pitch). */
  ridgeHeight?: number;
}

const signedArea = (p: V2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
};
const ccw = (p: V2[]) => (signedArea(p) >= 0 ? p : [...p].reverse());

/** A polygon (2D or 3D, in plan) cut to the side of a line where `side(p) >= 0`. */
function clip<P extends number[]>(poly: P[], side: (p: P) => number, mix: (a: P, b: P, t: number) => P): P[] {
  const out: P[] = [];
  for (let k = 0; k < poly.length; k++) {
    const cur = poly[k], nxt = poly[(k + 1) % poly.length];
    const dc = side(cur), dn = side(nxt);
    if (dc >= -1e-9) out.push(cur);
    if ((dc > 1e-9 && dn < -1e-9) || (dc < -1e-9 && dn > 1e-9)) out.push(mix(cur, nxt, dc / (dc - dn)));
  }
  return out;
}
const mix2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Drops repeated points and straight-through corners (from an outline). */
export function tidy(p: V2[]): V2[] {
  let out = p.filter((q, i) => Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]) > 1e-6);
  for (let pass = 0; pass < 3; pass++) {
    out = out.filter((q, i) => {
      const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length];
      const cr = (q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0]);
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]) * Math.hypot(b[0] - q[0], b[1] - q[1]) || 1;
      return Math.abs(cr / len) > 1e-6;
    });
  }
  return out;
}

/** Each edge moved out by its own distance (0 against the house), corners where they meet. */
function offsetEdges(poly: V2[], dist: number[]): V2[] {
  const n = poly.length;
  const line = (i: number) => {
    const a = poly[i], b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const out: V2 = [u[1], -u[0]];
    return { p: [a[0] + out[0] * dist[i], a[1] + out[1] * dist[i]] as V2, u };
  };
  return poly.map((_, k) => {
    const L1 = line((k - 1 + n) % n), L2 = line(k);
    const den = L1.u[0] * L2.u[1] - L1.u[1] * L2.u[0];
    if (Math.abs(den) < 1e-9) return L2.p;
    const t = ((L2.p[0] - L1.p[0]) * L2.u[1] - (L2.p[1] - L1.p[1]) * L2.u[0]) / den;
    return [L1.p[0] + L1.u[0] * t, L1.p[1] + L1.u[1] * t];
  });
}

/**
 * The roof over an extension's walls (`wall`, its outline on the wall centre lines), which meets
 * the house along `abut` (a stretch of the house wall's centre line). Null if the outline isn't
 * one the extension roofs handle (it meets the house along more than one line, or is too small).
 */
export function extensionRoofModel(wallIn: V2[], abut: { a: V2; b: V2 }, opts: ExtensionOptions): RoofModel | null {
  const wall0 = ccw(tidy(wallIn));
  const len = Math.hypot(abut.b[0] - abut.a[0], abut.b[1] - abut.a[1]);
  if (wall0.length < 3 || len < 0.5) return null;
  // Normal to the house wall, pointing out into the extension.
  let nrm: V2 = [-(abut.b[1] - abut.a[1]) / len, (abut.b[0] - abut.a[0]) / len];
  const c = wall0.reduce((s, p) => [s[0] + p[0] / wall0.length, s[1] + p[1] / wall0.length], [0, 0]);
  if ((c[0] - abut.a[0]) * nrm[0] + (c[1] - abut.a[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
  // The roof stops at the house wall's outer face.
  const q: V2 = [abut.a[0] + nrm[0] * opts.wallThickness / 2, abut.a[1] + nrm[1] * opts.wallThickness / 2];
  const side = (p: number[]) => (p[0] - q[0]) * nrm[0] + (p[p.length === 3 ? 2 : 1] - q[1]) * nrm[1];
  const wall = tidy(clip<V2>(wall0, side, mix2));
  if (wall.length < 3 || Math.abs(signedArea(wall)) < 1) return null;
  const n = wall.length;
  const onWall = wall.map((p, i) => Math.abs(side(p)) < 1e-6 && Math.abs(side(wall[(i + 1) % n])) < 1e-6);
  if (onWall.filter(Boolean).length !== 1) return null;
  const eave = offsetEdges(wall, onWall.map(w => (w ? 0 : opts.overhang)));

  let faces3: { edge: number; pts: V3[]; gable: boolean }[] | null;
  let tan: number;
  if (opts.kind === 'lean-to') {
    const r = leanTo(eave, onWall, nrm, opts);
    if (!r) return null;
    ({ faces3, tan } = r);
  } else {
    const r = pitched(wall, eave, onWall, nrm, side, opts);
    if (!r) return null;
    ({ faces3, tan } = r);
  }
  return assemble(eave, wall, faces3, tan, side);
}

/** Lean-to: the eaves facing away from the house slope up to it; the side edges are verges. */
function leanTo(eave: V2[], onWall: boolean[], nrm: V2, opts: ExtensionOptions) {
  const n = eave.length;
  const outward = (i: number): V2 => {
    const a = eave[i], b = eave[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  };
  const sloped = eave.map((_, i) => !onWall[i] && outward(i)[0] * nrm[0] + outward(i)[1] * nrm[1] > 0.26);
  if (!sloped.some(Boolean)) return null;
  // Heights for a pitch of 1 first; scaled once the rise at the wall is known.
  const h = (i: number, p: V2) => planeHeight(eave, i, p, 1);
  const faces3: { edge: number; pts: V3[]; gable: boolean }[] = [];
  eave.forEach((_, i) => {
    if (!sloped[i]) return;
    let poly: V2[] = eave.map(p => [p[0], p[1]]);
    for (let j = 0; j < n; j++) {
      if (j === i || !sloped[j]) continue;
      poly = clip<V2>(poly, p => h(j, p) - h(i, p), mix2);
    }
    poly = tidy(poly);
    if (poly.length >= 3) faces3.push({ edge: i, pts: poly.map(p => [p[0], h(i, p), p[1]] as V3), gable: false });
  });
  const top = Math.max(...faces3.flatMap(f => f.pts.map(p => p[1])));
  if (!(top > 1e-6)) return null;
  const tan = opts.ridgeHeight !== undefined ? Math.max(0.05, opts.ridgeHeight) / top : Math.tan(((opts.pitchDeg ?? 20) * Math.PI) / 180);
  for (const f of faces3) for (const p of f.pts) p[1] *= tan;
  // Verges: vertical cheeks under the roof's edge along each side.
  eave.forEach((_, j) => {
    if (sloped[j] || onWall[j]) return;
    const a = eave[j], b = eave[(j + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const along = (p: number[]) => ((p[0] - b[0]) * (a[0] - b[0]) + (p[2] - b[1]) * (a[1] - b[1])) / (l * l);
    const off = (p: number[]) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[2] - a[1]) * (b[0] - a[0])) / l;
    const profile = faces3.flatMap(f => f.pts).filter(p => p[1] > 1e-6 && off(p) < 1e-6);
    const uniq = profile.filter((p, k) => profile.findIndex(r => Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]) < 1e-6) === k)
      .sort((p1, p2) => along(p1) - along(p2));
    if (!uniq.length) return;
    faces3.push({ edge: j, pts: [[b[0], 0, b[1]], ...uniq, [a[0], 0, a[1]]], gable: true });
  });
  return { faces3, tan };
}

/** Pitched: roof the extension continued back through the house, then cut it at the wall. */
function pitched(wall: V2[], eave: V2[], onWall: boolean[], nrm: V2, side: (p: number[]) => number, opts: ExtensionOptions) {
  const n = wall.length;
  const k = onWall.indexOf(true);
  const A = wall[k], B = wall[(k + 1) % n];
  const reach = 3 * Math.max(...wall.map(p => Math.hypot(p[0] - A[0], p[1] - A[1])));
  // The outline with its house-side edge pushed back through the house.
  const through: V2[] = [];
  wall.forEach((p, i) => {
    through.push(p);
    if (i === k) through.push([A[0] - nrm[0] * reach, A[1] - nrm[1] * reach], [B[0] - nrm[0] * reach, B[1] - nrm[1] * reach]);
  });
  const W2 = tidy(ccw(through));
  const E2 = offsetEdges(W2, W2.map(() => opts.overhang));
  const m = buildRoofModel(E2, W2, { gable: true, ...(opts.ridgeHeight !== undefined ? { ridgeHeight: opts.ridgeHeight } : { pitchDeg: opts.pitchDeg ?? 35 }) });
  if (!m) return null;
  // Cut each face at the house wall, and match it to the extension's own eave edge.
  const faces3: { edge: number; pts: V3[]; gable: boolean }[] = [];
  for (const f of m.faces) {
    const pts = clip<V3>(f.verts.map(v => [...m.nodes[v]] as V3), side, mix3);
    if (pts.length < 3) continue;
    const e0 = m.eave[f.edge], e1 = m.eave[(f.edge + 1) % m.eave.length];
    const edge = eave.findIndex((p, i) => {
      if (onWall[i]) return false;
      const qn = eave[(i + 1) % n];
      const off = (r: V2) => Math.abs((r[0] - p[0]) * (qn[1] - p[1]) - (r[1] - p[1]) * (qn[0] - p[0])) / (Math.hypot(qn[0] - p[0], qn[1] - p[1]) || 1);
      return off(e0) < 1e-3 && off(e1) < 1e-3;
    });
    if (edge < 0) return null;
    faces3.push({ edge, pts, gable: f.gable });
  }
  // The face that ran up to the (now cut) far end inside the house is gone; heights stay as built.
  return { faces3, tan: Math.tan(m.pitch) };
}

/** A RoofModel from faces given as 3D outlines: nodes shared, each face starting at its edge's end corner. */
function assemble(eave: V2[], wall: V2[], faces3: { edge: number; pts: V3[]; gable: boolean }[], tan: number, side: (p: number[]) => number): RoofModel | null {
  const n = eave.length;
  const nodes: V3[] = eave.map(p => [p[0], 0, p[1]]);
  const nodeOf = (p: V3) => {
    const i = nodes.findIndex(r => Math.hypot(r[0] - p[0], r[2] - p[2]) < 1e-5 && Math.abs(r[1] - p[1]) < 1e-5);
    if (i >= 0) return i;
    nodes.push([p[0], p[1], p[2]]);
    return nodes.length - 1;
  };
  const faces: RoofFace[] = [];
  for (const f of faces3) {
    let verts = f.pts.map(nodeOf).filter((v, i, arr) => v !== arr[(i + 1) % arr.length]);
    const end = (f.edge + 1) % n;
    if (!f.gable) {
      // Counter-clockwise in plan, starting at the edge's end corner.
      let a = 0;
      for (let i = 0; i < verts.length; i++) { const p = nodes[verts[i]], q = nodes[verts[(i + 1) % verts.length]]; a += p[0] * q[2] - q[0] * p[2]; }
      if (a < 0) verts.reverse();
    }
    const s = verts.indexOf(end);
    if (s < 0 || !verts.includes(f.edge)) return null;
    verts = [...verts.slice(s), ...verts.slice(0, s)];
    faces.push({ edge: f.edge, verts, gable: f.gable });
  }
  const isEave = (a: number, b: number) => a < n && b < n && ((a + 1) % n === b || (b + 1) % n === a);
  const faceOf = new Map<string, number[]>();
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.verts.length; k++) {
      const a = f.verts[k], b = f.verts[(k + 1) % f.verts.length];
      if (isEave(a, b)) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!faceOf.has(key)) faceOf.set(key, []);
      faceOf.get(key)!.push(fi);
    }
  });
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const edges: RoofEdge[] = [];
  for (const [key, fs] of faceOf) {
    const [a, b] = key.split(',').map(Number);
    const pair: [number, number] = [fs[0], fs[1] ?? fs[0]];
    let kind: RoofEdgeKind;
    const onHouse = Math.abs(side(nodes[a])) < 1e-5 && Math.abs(side(nodes[b])) < 1e-5;
    if (fs.some(fi => faces[fi].gable)) kind = onHouse && nodes[a][1] > 1e-6 && nodes[b][1] > 1e-6 && fs.length === 1 ? 'wall' : 'rake';
    else if (onHouse) kind = 'wall';
    else if (a < n || b < n) {
      const c = a < n ? a : b;
      kind = cross(eave[(c - 1 + n) % n], eave[c], eave[(c + 1) % n]) > 0 ? 'hip' : 'valley';
    } else {
      const mid: V2 = [(nodes[a][0] + nodes[b][0]) / 2, (nodes[a][2] + nodes[b][2]) / 2];
      const f0 = faces[pair[0]], f1 = faces[pair[1]];
      const cen = f0.verts.reduce((s2, v) => [s2[0] + nodes[v][0] / f0.verts.length, s2[1] + nodes[v][2] / f0.verts.length], [0, 0]);
      const p: V2 = [mid[0] + (cen[0] - mid[0]) * 0.05, mid[1] + (cen[1] - mid[1]) * 0.05];
      const crest = planeHeight(eave, f0.edge, p, tan) <= planeHeight(eave, f1.edge, p, tan) + 1e-9;
      const run = Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][2] - nodes[b][2]);
      kind = crest ? (Math.abs(nodes[a][1] - nodes[b][1]) <= Math.max(1e-6, run * 0.05) ? 'ridge' : 'hip') : 'valley';
    }
    edges.push({ a, b, kind, faces: pair });
  }
  const ridgeHeight = Math.max(...nodes.map(p => p[1]));
  // Sanity: every sloped face covers part of the outline.
  if (!faces.some(f => !f.gable) || !faces.every(f => f.gable || pointInPolygon(
    [f.verts.reduce((s2, v) => s2 + nodes[v][0], 0) / f.verts.length, f.verts.reduce((s2, v) => s2 + nodes[v][2], 0) / f.verts.length], eave))) return null;
  return { eave, wall, nodes, faces, edges, pitch: Math.atan(tan), ridgeHeight };
}
