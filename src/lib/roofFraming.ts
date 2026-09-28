/**
 * Timber for a skeleton roof (see roofSkeleton.ts), laid out the way a carpenter frames a cut roof.
 *
 * - A ridge board along every ridge; hip and valley rafters along every hip and valley.
 * - On every slope, rafters square to its eave at the rafter spacing: common rafters from the eave
 *   to the ridge, jack rafters stopping on a hip, valley jacks starting on a valley. Rafters are
 *   set out from one grid per ridge direction, so rafters on opposite slopes pair up.
 * - Each pair across a ridge gets a ceiling tie at plate level (it stops the rafters spreading the
 *   walls) and a collar tie high up.
 * - Sizes come from span tables (C24 softwood, tiled roof): the rafters are sized for the longest
 *   slope; where no size is enough, purlins are added part way up (held on struts) to shorten it.
 * - A curved wall's roof is framed with a radial rafter on every facet line.
 *
 * Everything is roof-local, with rafters drawn on the roof surface line (the timber generator
 * tucks each member under the surface by its own depth).
 */
import * as THREE from 'three';
import { edgeFrame, facePlan, isCurveCrease, type RoofEdgeKind, type RoofModel } from './roofSkeleton';
import type { V2 } from './roofSurface';

export interface RoofMember {
  name: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
  depth: number;
  subTag: string;
}

export interface RoofFraming {
  members: RoofMember[];
  /** Plain-language notes about spans, supports and sizes. */
  warnings: string[];
  sizes: { rafter: [number, number]; hip: [number, number]; valley: [number, number]; ridge: [number, number]; ceiling: [number, number] };
  /** Longest rafter span between supports, along the slope (m). */
  rafterSpan: number;
  purlinRows: number;
}

/** Largest span (m, along the slope) of a 47 mm wide C24 rafter at 400 mm centres under tiles, by depth (mm). */
const RAFTER_SPANS: [number, number][] = [[100, 2.4], [125, 3.0], [150, 3.6], [175, 4.2], [200, 4.7], [225, 5.2]];
/** Largest clear span (m) of a 47 mm wide C24 ceiling joist at 400 mm centres, by depth (mm). */
const CEILING_SPANS: [number, number][] = [[97, 2.0], [122, 2.7], [147, 3.4], [170, 4.0], [195, 4.7], [220, 5.3]];
const WIDTH = 0.047;
/** Longest purlin span between struts (m). */
const STRUT_SPACING = 2.4;
const PURLIN: [number, number] = [0.075, 0.2];
const STRUT: [number, number] = [0.075, 0.1];

/** Span tables are for 400 mm centres; wider spacing carries more roof per rafter. */
const spacingFactor = (spacing: number) => Math.sqrt(0.4 / Math.max(0.3, spacing));

function pick(table: [number, number][], span: number, factor: number): { depth: number; ok: boolean } {
  for (const [d, max] of table) if (span <= max * factor) return { depth: d / 1000, ok: true };
  return { depth: table[table.length - 1][0] / 1000, ok: false };
}

const v3 = (p: V2, y: number) => new THREE.Vector3(p[0], y, p[1]);
const m1 = (n: number) => `${n.toFixed(1)} m`;

interface RafterLine {
  face: number;
  /** Plan points along the line: start (on the eave, t = 0) and direction (up the slope). */
  origin: V2;
  dir: V2;
  tLo: number;
  tHi: number;
  lo: SideKind;
  hi: SideKind;
  /** The skeleton line (node pair) the top end lands on. */
  hiEdge: string | null;
}
type SideKind = 'eave' | RoofEdgeKind | 'crease' | 'ring';

export function frameSkeletonRoof(m: RoofModel, opts: { spacing?: number } = {}): RoofFraming {
  const spacing = Math.max(0.3, opts.spacing ?? 0.4);
  const n = m.eave.length;
  const tan = Math.tan(m.pitch), cos = Math.cos(m.pitch);
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const edgeByKey = new Map(m.edges.map(e => [key(e.a, e.b), e]));
  const kindOf = (a: number, b: number): SideKind => {
    if (a < n && b < n && ((a + 1) % n === b || (b + 1) % n === a)) return 'eave';
    const e = edgeByKey.get(key(a, b));
    if (!e) return 'ridge';
    return e.kind === 'hip' && isCurveCrease(m, e) ? 'crease' : e.kind;
  };
  const faceFrames = m.faces.map(f => {
    const fr = edgeFrame(m.eave, f.edge);
    const w = m.wall[f.edge];
    // How far in from the eave the wall line (where the rafters bear) is.
    const inset = (w[0] - fr.a[0]) * fr.inward[0] + (w[1] - fr.a[1]) * fr.inward[1];
    return { ...fr, inset: Math.max(0, inset) };
  });

  // Facets of a curved wall's roof: both sides are creases, and they narrow to a point.
  const curveFacet = m.faces.map(f => !f.gable && f.verts.length >= 3
    && kindOf(f.verts[0], f.verts[1]) === 'crease' && kindOf(f.verts[f.verts.length - 2], f.verts[f.verts.length - 1]) === 'crease');
  /** How far up a curve facet (from its eave) it is still wide enough for rafters between its radial ones. */
  const curveStop = m.faces.map((f, fi) => {
    if (!curveFacet[fi]) return Infinity;
    const { a, inward, len } = faceFrames[fi];
    const tA = Math.max(...facePlan(m, f).map(p => (p[0] - a[0]) * inward[0] + (p[1] - a[1]) * inward[1]));
    return tA * (1 - Math.min(1, 0.5 / Math.max(len, 1e-6)));
  });

  // --- Rafter lines on every slope ---------------------------------------------------------------
  const lines: RafterLine[] = [];
  m.faces.forEach((f, fi) => {
    if (f.gable) return;
    const { a, u, inward } = faceFrames[fi];
    const plan = facePlan(m, f);
    const uAt = (p: V2) => (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
    const us = plan.map(uAt);
    const uMin = Math.min(...us), uMax = Math.max(...us);
    // A grid shared by every slope square to the same direction, so opposite rafters pair up.
    const base = a[0] * u[0] + a[1] * u[1];
    for (let k = Math.ceil((base + uMin) / spacing); k * spacing <= base + uMax; k++) {
      const uu = k * spacing - base;
      if (uu < uMin + 0.03 || uu > uMax - 0.03) continue;
      const origin: V2 = [a[0] + u[0] * uu, a[1] + u[1] * uu];
      // Where this line crosses the face's outline (the face is one piece along any such line).
      let tLo = Infinity, tHi = -Infinity, lo: SideKind = 'eave', hi: SideKind = 'ridge', hiEdge: string | null = null;
      for (let s = 0; s < f.verts.length; s++) {
        const i = f.verts[s], j = f.verts[(s + 1) % f.verts.length];
        const P = plan[s], Q = plan[(s + 1) % plan.length];
        const ex = Q[0] - P[0], ez = Q[1] - P[1];
        const den = inward[0] * ez - inward[1] * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((P[0] - origin[0]) * ez - (P[1] - origin[1]) * ex) / den;
        const w = ((P[0] - origin[0]) * inward[1] - (P[1] - origin[1]) * inward[0]) / den;
        if (w < -1e-7 || w > 1 + 1e-7) continue;
        const kind = kindOf(i, j);
        if (t < tLo) { tLo = t; lo = kind; }
        if (t > tHi) { tHi = t; hi = kind; hiEdge = kind === 'eave' ? null : key(i, j); }
      }
      if (!(tHi - tLo > 0.25)) continue;
      // On a curve facet the rafters between the radial ones stop at a ring of trimmers.
      if (tHi > curveStop[fi]) { tHi = curveStop[fi]; hi = 'ring'; hiEdge = null; }
      if (!(tHi - tLo > 0.25)) continue;
      lines.push({ face: fi, origin, dir: inward, tLo: Math.max(0, tLo), tHi, lo, hi, hiEdge });
    }
  });

  // --- Supports and sizes --------------------------------------------------------------------------
  const factor = spacingFactor(spacing);
  const bottomSupport = (l: RafterLine) => (l.lo === 'eave' ? Math.max(l.tLo, faceFrames[l.face].inset) : l.tLo);
  const spanOf = (l: RafterLine, cuts: number[]) => {
    const stops = [bottomSupport(l), ...cuts.filter(t => t > bottomSupport(l) + 0.2 && t < l.tHi - 0.2), l.tHi].sort((x, y) => x - y);
    let worst = 0;
    for (let k = 1; k < stops.length; k++) worst = Math.max(worst, (stops[k] - stops[k - 1]) / cos);
    return worst;
  };
  // Purlin rows are set at fixed heights up each slope (fractions of the tallest rise).
  const topT = Math.max(0, ...lines.map(l => l.tHi));
  let purlinRows = 0;
  let cuts: number[] = [];
  let rafterSpan = Math.max(0, ...lines.map(l => spanOf(l, [])));
  let size = pick(RAFTER_SPANS, rafterSpan, factor);
  while (!size.ok && purlinRows < 3) {
    purlinRows++;
    const wallT = Math.min(...faceFrames.map(f => f.inset));
    cuts = Array.from({ length: purlinRows }, (_, k) => wallT + ((topT - wallT) * (k + 1)) / (purlinRows + 1));
    rafterSpan = Math.max(0, ...lines.map(l => spanOf(l, cuts)));
    size = pick(RAFTER_SPANS, rafterSpan, factor);
  }
  const dr = size.depth;
  const sizes: RoofFraming['sizes'] = {
    rafter: [WIDTH, dr],
    hip: [WIDTH, dr + 0.05],
    valley: [0.075, dr + 0.05],
    ridge: [WIDTH, dr + 0.025],
    ceiling: [WIDTH, 0.097],
  };
  const warnings: string[] = [];
  if (purlinRows > 0) {
    warnings.push(`Rafters would span ${m1(Math.max(0, ...lines.map(l => spanOf(l, []))))} on the longest slope, so ${purlinRows === 1 ? 'a purlin runs' : `${purlinRows} purlins run`} across each slope to shorten it, held up on struts. The struts need a load-bearing wall or beam below them.`);
  }
  if (!size.ok) warnings.push(`Even with purlins the rafters span ${m1(rafterSpan)}, more than the ${RAFTER_SPANS[RAFTER_SPANS.length - 1][0]} mm rafters allow; the roof needs an engineer's design (for example trusses or steel).`);

  // --- Members ---------------------------------------------------------------------------------------
  const members: RoofMember[] = [];
  const add = (name: string, a: THREE.Vector3, b: THREE.Vector3, [w, d]: [number, number], subTag: string) => {
    if (a.distanceTo(b) > 0.05) members.push({ name, a, b, width: w, depth: d, subTag });
  };
  const at = (l: RafterLine, t: number, y = t * tan) => v3([l.origin[0] + l.dir[0] * t, l.origin[1] + l.dir[1] * t], y);

  // Ridges, hips, valleys, and the gable verges.
  for (const e of m.edges) {
    const A = new THREE.Vector3(...m.nodes[e.a]), B = new THREE.Vector3(...m.nodes[e.b]);
    if (e.kind === 'ridge') {
      add('Ridge Board', A.clone().setY(A.y - sizes.ridge[1] / 2), B.clone().setY(B.y - sizes.ridge[1] / 2), sizes.ridge, 'timber-ridge-beam');
    } else if (e.kind === 'hip') {
      if (isCurveCrease(m, e)) add('Radial Rafter', A, B, sizes.rafter, 'timber-common-rafter');
      else add('Hip Rafter', A, B, sizes.hip, 'timber-hip-rafter');
    } else if (e.kind === 'valley') add('Valley Rafter', A, B, sizes.valley, 'timber-valley-rafter');
    else if (e.kind === 'wall') {
      // Where a lean-to meets the house: a ledger bolted to the wall carries the rafters' tops.
      const drop = dr / cos + 0.075;
      add('Wall Plate (Ledger)', A.clone().setY(A.y - drop), B.clone().setY(B.y - drop), [0.075, 0.15], 'timber-wall-plate');
    } else add('Verge Rafter', A, B, sizes.rafter, 'timber-rake-rafter');
  }

  // Rafters on each slope.
  for (const l of lines) {
    const A = at(l, l.tLo), B = at(l, l.tHi);
    if (l.lo === 'valley') add('Valley Jack Rafter', A, B, sizes.rafter, 'timber-valley-jack-rafter');
    else if (l.hi === 'hip') add('Hip Jack Rafter', A, B, sizes.rafter, 'timber-hip-jack-rafter');
    else add('Common Rafter', A, B, sizes.rafter, 'timber-common-rafter');
  }

  // Round roofs: the trimmer ring those rafters stop on, a ring beam on the wall head to take the
  // rafters' outward push, and a boss where the radial rafters meet.
  const crossAt = (fi: number, t: number): [THREE.Vector3, THREE.Vector3] | null => {
    const { a, u, inward } = faceFrames[fi];
    const plan = facePlan(m, m.faces[fi]);
    const us: number[] = [];
    for (let s2 = 0; s2 < plan.length; s2++) {
      const P = plan[s2], Q = plan[(s2 + 1) % plan.length];
      const tp = (P[0] - a[0]) * inward[0] + (P[1] - a[1]) * inward[1];
      const tq = (Q[0] - a[0]) * inward[0] + (Q[1] - a[1]) * inward[1];
      if ((tp - t) * (tq - t) > 0 || tp === tq) continue;
      const k = (t - tp) / (tq - tp);
      us.push((P[0] + (Q[0] - P[0]) * k - a[0]) * u[0] + (P[1] + (Q[1] - P[1]) * k - a[1]) * u[1]);
    }
    if (us.length < 2) return null;
    const pt = (uu: number) => v3([a[0] + u[0] * uu + inward[0] * t, a[1] + u[1] * uu + inward[1] * t], t * tan);
    return [pt(Math.min(...us)), pt(Math.max(...us))];
  };
  let curved = false;
  m.faces.forEach((f, fi) => {
    if (!curveFacet[fi]) return;
    curved = true;
    const ends = Number.isFinite(curveStop[fi]) && lines.some(l => l.face === fi && l.hi === 'ring') ? crossAt(fi, curveStop[fi]) : null;
    if (ends) add('Ring Trimmer', ends[0], ends[1], sizes.rafter, 'timber-trimmer-rafter');
    const w0 = m.wall[f.edge], w1 = m.wall[(f.edge + 1) % n];
    add('Ring Beam (Wall Plate)', v3(w0, 0.04), v3(w1, 0.04), [0.15, 0.075], 'timber-wall-plate');
  });
  if (curved) {
    // Radial rafters meet at (or, on a nudged outline, very near) a point: group ends within 30 cm.
    const groups: { top: THREE.Vector3; count: number }[] = [];
    for (const e of m.edges) {
      if (e.kind !== 'hip' || !isCurveCrease(m, e)) continue;
      for (const v of [e.a, e.b]) {
        if (v < n) continue;
        const p = new THREE.Vector3(...m.nodes[v]);
        const g = groups.find(x => Math.hypot(x.top.x - p.x, x.top.z - p.z) < 0.3);
        if (!g) groups.push({ top: p, count: 1 });
        else { g.count++; if (p.y > g.top.y) g.top = p; }
      }
    }
    for (const { top, count } of groups) {
      if (count < 5) continue;
      add('Roof Boss', top.clone().setY(top.y - 0.1), top.clone().setY(top.y - 0.6), [0.15, 0.15], 'timber-roof-boss');
    }
    warnings.push('Round roof: the rafters push outwards at the eaves, so the ring beam on the wall head has to hold them in; its joints must be made to take tension.');
  }

  // Noggins (blocking) between neighbouring rafters on the same slope, half way up where both run.
  for (let k = 1; k < lines.length; k++) {
    const p = lines[k - 1], q = lines[k];
    if (p.face !== q.face) continue;
    const lo = Math.max(p.tLo, q.tLo), hi = Math.min(p.tHi, q.tHi);
    if (hi - lo < 0.5) continue;
    const t = (lo + hi) / 2;
    add('Roof Noggin', at(p, t), at(q, t), [WIDTH, dr * 0.6], 'timber-roof-noggin');
  }

  // Ties across each ridge: rafters that meet their partner on the far slope.
  let longestTie = 0;
  const ridgePairs = new Map<string, [number, number]>();
  for (const e of m.edges) if (e.kind === 'ridge') ridgePairs.set(key(e.a, e.b), e.faces);
  for (const l of lines) {
    if (l.hi !== 'ridge' || !l.hiEdge) continue;
    const pair = ridgePairs.get(l.hiEdge);
    if (!pair) continue;
    const g = pair[0] === l.face ? pair[1] : pair[0];
    if (g === l.face || g < l.face) continue;
    const gf = faceFrames[g];
    // Continue the line over the ridge and down the far slope: its height there falls away.
    const c1 = l.dir[0] * gf.inward[0] + l.dir[1] * gf.inward[1];
    if (c1 > -0.95) continue;
    const c0 = (l.origin[0] - gf.a[0]) * gf.inward[0] + (l.origin[1] - gf.a[1]) * gf.inward[1];
    // Far side's wall line, and the collar height two thirds of the way up.
    const tWallFar = (gf.inset - c0) / c1;
    const tWallNear = faceFrames[l.face].inset;
    const top = l.tHi * tan;
    const collarY = (top * 2) / 3;
    const tCollarNear = collarY / tan, tCollarFar = (collarY / tan - c0) / c1;
    if (!(tWallFar > l.tHi) || !(tCollarFar > l.tHi)) continue;
    const tieLen = tWallFar - tWallNear;
    longestTie = Math.max(longestTie, tieLen);
    add('Ceiling Joist', at(l, tWallNear, 0.04), at(l, tWallFar, 0.04), sizes.ceiling, 'timber-ceiling-joist');
    const drop = dr / cos;
    if (collarY - drop > 0.6) add('Collar Tie', at(l, tCollarNear, collarY - drop), at(l, tCollarFar, collarY - drop), [WIDTH, 0.1], 'timber-collar-tie');
  }
  if (longestTie > 0) {
    const cj = pick(CEILING_SPANS, longestTie, factor);
    sizes.ceiling = [WIDTH, cj.depth];
    for (const mm of members) if (mm.subTag === 'timber-ceiling-joist') mm.depth = cj.depth;
    if (!cj.ok) warnings.push(`Ceiling joists span ${m1(longestTie)} between the walls, more than ${CEILING_SPANS[CEILING_SPANS.length - 1][0]} mm joists allow; they need a load-bearing wall or a binder beam part way across.`);
  }
  const untied = lines.some(l => l.hi === 'ridge' && l.lo === 'eave') && longestTie === 0;
  if (untied) warnings.push('The rafters have no ties across the building, so the ridge must be a structural beam carried at its ends.');

  // Purlins across each slope, with struts under them.
  if (cuts.length) {
    m.faces.forEach((f, fi) => {
      if (f.gable) return;
      const { a, u, inward } = faceFrames[fi];
      const plan = facePlan(m, f);
      const nrm = new THREE.Vector3(-inward[0] * Math.sin(m.pitch), Math.cos(m.pitch), -inward[1] * Math.sin(m.pitch));
      for (const t of cuts) {
        // The purlin runs along the slope at this distance in from the eave, between the face's sides.
        const us: number[] = [];
        for (let s = 0; s < plan.length; s++) {
          const P = plan[s], Q = plan[(s + 1) % plan.length];
          const tp = (P[0] - a[0]) * inward[0] + (P[1] - a[1]) * inward[1];
          const tq = (Q[0] - a[0]) * inward[0] + (Q[1] - a[1]) * inward[1];
          if ((tp - t) * (tq - t) > 0 || tp === tq) continue;
          const k = (t - tp) / (tq - tp);
          us.push((P[0] + (Q[0] - P[0]) * k - a[0]) * u[0] + (P[1] + (Q[1] - P[1]) * k - a[1]) * u[1]);
        }
        if (us.length < 2) continue;
        const u0 = Math.min(...us) + 0.05, u1 = Math.max(...us) - 0.05;
        if (u1 - u0 < 0.5) continue;
        const point = (uu: number) => v3([a[0] + u[0] * uu + inward[0] * t, a[1] + u[1] * uu + inward[1] * t], t * tan)
          .addScaledVector(nrm, -(dr + PURLIN[1] / 2));
        add('Purlin', point(u0), point(u1), PURLIN, 'timber-roof-purlin');
        const bays = Math.max(1, Math.ceil((u1 - u0) / STRUT_SPACING));
        for (let k = 1; k < bays || (bays === 1 && k === 1); k++) {
          const uu = bays === 1 ? (u0 + u1) / 2 : u0 + ((u1 - u0) * k) / bays;
          const top = point(uu).addScaledVector(nrm, -PURLIN[1] / 2);
          add('Purlin Strut', top, top.clone().setY(0.1), STRUT, 'timber-roof-strut');
          if (bays === 1) break;
        }
      }
    });
  }

  return { members, warnings, sizes, rafterSpan, purlinRows };
}
