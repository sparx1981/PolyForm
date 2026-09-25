/**
 * Rounded edges for right prisms: any flat outline pushed straight up — cylinders (many-sided
 * outlines), triangular prisms, L-shapes and other extruded solids. The box fillet in fillet.ts
 * relies on every corner being three mutually perpendicular faces, which none of these have.
 *
 * A prism has a much simpler structure to exploit instead: every cross-section is the same
 * outline. Rounding it is:
 *  1. round the outline's corners in 2D (the vertical edges), skipping corners that are already
 *     nearly straight (a cylinder's facets), then
 *  2. rebuild the solid as a stack of that outline shrunk by r(1 - cos φ) at heights along a
 *     quarter circle at the bottom and top rims, joined by quads, with flat caps.
 *
 * Built with the same direct-face construction as the box fillet (every new face is
 * chamferLocked), and the original face boundaries are kept so the rounding can be re-applied
 * or removed later, like a box's.
 */
import type { EdgeId, FaceId, Graph, Vec2, Vec3 } from './types';
import { getVertex, loopEdgeIds, loopVertexIds, removeEdge, removeFace, removeOrphanVertices } from './topology';
import { add, dot, planeBasis, projectToBasis, scale, sub, tryNormalize, unprojectFromBasis } from './math';
import { offsetPolygon2D } from './faceOffset';
import type { InsertContext } from './insert';
import { createDirectFace } from './chamfer';

export interface PrismInfo { bottom: FaceId; top: FaceId }

const PARALLEL = 0.999;

function facePoints(g: Graph, fid: FaceId): Vec3[] {
  const f = g.faces.get(fid)!;
  return loopVertexIds(g, f.outerLoop).map(vid => getVertex(g, vid).position);
}

function centroid(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 } as Vec3);
  return scale(sum, 1 / Math.max(1, points.length));
}

/** Finds the two caps of a closed right prism, or says why these faces aren't one. */
export function validatePrism(g: Graph, faceIds: readonly FaceId[]): { ok: true; prism: PrismInfo } | { ok: false; reason: string } {
  if (faceIds.length < 5) return { ok: false, reason: 'not enough faces to form a closed solid' };
  const counts = new Map<FaceId, number>();
  for (const fid of faceIds) {
    const f = g.faces.get(fid);
    if (!f) return { ok: false, reason: `face ${fid} not found` };
    counts.set(fid, loopVertexIds(g, f.outerLoop).length);
  }
  for (let i = 0; i < faceIds.length; i++) {
    for (let j = i + 1; j < faceIds.length; j++) {
      const a = faceIds[i]!, b = faceIds[j]!;
      const n = counts.get(a)!;
      if (counts.get(b) !== n || faceIds.length !== n + 2) continue;
      const fa = g.faces.get(a)!, fb = g.faces.get(b)!;
      if (Math.abs(dot(fa.plane.normal, fb.plane.normal)) < PARALLEL) continue;
      if (fa.innerLoops.length || fb.innerLoops.length) return { ok: false, reason: 'rounding a solid with a hole through it is not supported yet' };
      const sides = faceIds.filter(f => f !== a && f !== b);
      if (!sides.every(f => counts.get(f) === 4)) continue;
      // Right prism: every top corner sits straight above a bottom corner.
      const bottom = facePoints(g, a), top = facePoints(g, b);
      let axis = tryNormalize(fa.plane.normal)!;
      const offset = sub(centroid(top), centroid(bottom));
      if (dot(axis, offset) < 0) axis = scale(axis, -1);
      const height = dot(axis, offset);
      if (height <= 1e-6) continue;
      const size = Math.max(height, ...bottom.map(p => Math.hypot(p.x - bottom[0]!.x, p.y - bottom[0]!.y, p.z - bottom[0]!.z)));
      const tol = size * 1e-4 + 1e-6;
      const straight = top.every(t => bottom.some(p => {
        const q = add(p, scale(axis, height));
        return Math.hypot(q.x - t.x, q.y - t.y, q.z - t.z) < tol;
      }));
      if (!straight) continue;
      return { ok: true, prism: { bottom: a, top: b } };
    }
  }
  return { ok: false, reason: 'rounded edges are supported on boxes and on straight extruded shapes (cylinders, prisms, extruded outlines)' };
}

const v2 = (x: number, y: number): Vec2 => ({ x, y });

function area2D(points: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function distanceToOutline(p: Vec2, outline: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}

function insideOutline(p: Vec2, outline: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!, b = outline[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Radius of the largest circle that fits inside the outline (coarse grid search). */
export function inscribedRadius2D(outline: readonly Vec2[]): number {
  const xs = outline.map(p => p.x), ys = outline.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = 0;
  const steps = 24;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
    const p = v2(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * j / steps);
    if (insideOutline(p, outline)) best = Math.max(best, distanceToOutline(p, outline));
  }
  return best;
}

/**
 * Rounds each corner of a CCW outline with radius r (clamped so neighbouring roundings never
 * overlap). Corners that already turn by less than `minTurn` are left alone.
 */
export function roundOutlineCorners(outline: readonly Vec2[], r: number, segments: number, minTurnDeg = 25): Vec2[] {
  const n = outline.length;
  const lengths = outline.map((p, i) => { const q = outline[(i + 1) % n]!; return Math.hypot(q.x - p.x, q.y - p.y); });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v = outline[i]!, prev = outline[(i + n - 1) % n]!, next = outline[(i + 1) % n]!;
    const l1 = Math.hypot(prev.x - v.x, prev.y - v.y), l2 = Math.hypot(next.x - v.x, next.y - v.y);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push(v); continue; }
    const u1 = v2((prev.x - v.x) / l1, (prev.y - v.y) / l1), u2 = v2((next.x - v.x) / l2, (next.y - v.y) / l2);
    const beta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    if (Math.PI - beta < (minTurnDeg * Math.PI) / 180 || beta < 1e-3) { out.push(v); continue; }
    // Tangent distance for this radius; shrink the radius if the edges are too short for it.
    const maxTrim = 0.49 * Math.min(lengths[(i + n - 1) % n]!, lengths[i]!);
    let radius = r, trim = radius / Math.tan(beta / 2);
    if (trim > maxTrim) { trim = maxTrim; radius = trim * Math.tan(beta / 2); }
    const a = v2(v.x + u1.x * trim, v.y + u1.y * trim), b = v2(v.x + u2.x * trim, v.y + u2.y * trim);
    const bis = v2(u1.x + u2.x, u1.y + u2.y), bl = Math.hypot(bis.x, bis.y) || 1;
    const c = v2(v.x + (bis.x / bl) * (radius / Math.sin(beta / 2)), v.y + (bis.y / bl) * (radius / Math.sin(beta / 2)));
    const angA = Math.atan2(a.y - c.y, a.x - c.x);
    let sweep = Math.atan2(b.y - c.y, b.x - c.x) - angA;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    for (let k = 0; k <= segments; k++) {
      const ang = angA + sweep * (k / segments);
      out.push(v2(c.x + Math.cos(ang) * radius, c.y + Math.sin(ang) * radius));
    }
  }
  return out;
}

export function prismMaxRadius(g: Graph, prism: PrismInfo): number {
  const bottom = facePoints(g, prism.bottom), top = facePoints(g, prism.top);
  const f = g.faces.get(prism.bottom)!;
  const basis = planeBasis(f.plane);
  const height = Math.abs(dot(f.plane.normal, sub(centroid(top), centroid(bottom))));
  const outline = bottom.map(p => projectToBasis(p, basis));
  return Math.max(0, Math.min(height / 2, inscribedRadius2D(outline)) * 0.95);
}

export function filletPrism(
  ctx: InsertContext,
  faceIds: readonly FaceId[],
  radius: number,
  segments = 6,
): { ok: boolean; reason?: string; touched: Set<EdgeId> } {
  const g = ctx.graph;
  const validated = validatePrism(g, faceIds);
  if (!validated.ok) return { ok: false, reason: (validated as { ok: false; reason: string }).reason, touched: new Set() };
  const { prism } = validated;
  if (radius <= 0) return { ok: false, reason: 'radius must be positive', touched: new Set() };
  const r = Math.min(radius, prismMaxRadius(g, prism));
  if (r <= 1e-6) return { ok: false, reason: 'this solid is too thin to round', touched: new Set() };

  const bottomFace = g.faces.get(prism.bottom)!;
  const bottom = facePoints(g, prism.bottom), top = facePoints(g, prism.top);
  const cBottom = centroid(bottom);
  let axis = tryNormalize(bottomFace.plane.normal)!;
  const offset = sub(centroid(top), cBottom);
  if (dot(axis, offset) < 0) axis = scale(axis, -1);
  const height = dot(axis, offset);
  const basis = planeBasis({ point: cBottom, normal: axis });
  let outline = bottom.map(p => projectToBasis(p, basis));
  if (area2D(outline) < 0) outline = outline.slice().reverse();

  // 1. The vertical edges: corners rounded in plan.
  const rounded = roundOutlineCorners(outline, r, segments);
  // 2. Rings up the solid: bottom rim (cap inset by r) up to the wall, then the top rim.
  const rings: { y: number; inset: number }[] = [];
  for (let k = segments; k >= 0; k--) {
    const phi = (k / segments) * (Math.PI / 2);
    rings.push({ y: r * (1 - Math.sin(phi)), inset: r * (1 - Math.cos(phi)) });
  }
  for (let k = 0; k <= segments; k++) {
    const phi = (k / segments) * (Math.PI / 2);
    const ring = { y: height - r + r * Math.sin(phi), inset: r * (1 - Math.cos(phi)) };
    if (Math.abs(ring.y - rings[rings.length - 1]!.y) > 1e-7 || k > 0) rings.push(ring);
  }
  const ringPoints = rings.map(({ y, inset }) => {
    const plan = inset > 1e-9 ? offsetPolygon2D(rounded, -inset) : rounded;
    return plan.map(p => add(unprojectFromBasis(p, basis), scale(axis, y)));
  });

  const touched = new Set<EdgeId>();
  const created: FaceId[] = [];
  const minEdge = ctx.tolerances.MIN_EDGE_LENGTH;
  const tooShort = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < minEdge * 2;
  const face = (points: Vec3[], hint: Vec3) => {
    const id = createDirectFace(ctx, points, hint, touched);
    if (id !== null) created.push(id);
    return id;
  };

  // Caps.
  face(ringPoints[0]!, scale(axis, -1));
  const topCap = face(ringPoints[ringPoints.length - 1]!, axis);

  // Bands between rings; a quad whose edge along a ring has collapsed becomes a triangle.
  const m = rounded.length;
  for (let j = 0; j + 1 < ringPoints.length; j++) {
    const lo = ringPoints[j]!, hi = ringPoints[j + 1]!;
    for (let i = 0; i < m; i++) {
      const i2 = (i + 1) % m;
      const e = sub(unprojectFromBasis(rounded[i2]!, basis), unprojectFromBasis(rounded[i]!, basis));
      // Outward in plan (the outline is CCW about the axis), tilted up or down with the rim.
      const outward = tryNormalize({ x: e.y * axis.z - e.z * axis.y, y: e.z * axis.x - e.x * axis.z, z: e.x * axis.y - e.y * axis.x });
      if (!outward) continue;
      const mid = (rings[j]!.y + rings[j + 1]!.y) / 2;
      const hint = add(outward, scale(axis, mid < height / 2 ? -0.3 : 0.3));
      const loShort = tooShort(lo[i]!, lo[i2]!), hiShort = tooShort(hi[i]!, hi[i2]!);
      if (loShort && hiShort) continue;
      if (loShort) face([lo[i]!, hi[i2]!, hi[i]!], hint);
      else if (hiShort) face([lo[i]!, lo[i2]!, hi[i]!], hint);
      else face([lo[i]!, lo[i2]!, hi[i2]!, hi[i]!], hint);
    }
  }

  // Keep every original face's boundary so the rounding can be re-applied or removed.
  const originals = faceIds.map(fid => facePoints(g, fid));
  if (topCap !== null) g.faces.get(topCap)!.attributes.custom.originalBoundaries = originals;

  // Remove the original faces and their now-unused edges and vertices.
  const oldEdges = new Set<EdgeId>();
  for (const fid of faceIds) {
    const f = g.faces.get(fid);
    if (!f) continue;
    for (const eid of loopEdgeIds(g, f.outerLoop)) oldEdges.add(eid);
    removeFace(g, fid);
  }
  for (const eid of oldEdges) {
    const e = g.edges.get(eid);
    if (e && e.uses.length === 0) removeEdge(g, eid);
  }
  removeOrphanVertices(g);
  return { ok: true, touched };
}
