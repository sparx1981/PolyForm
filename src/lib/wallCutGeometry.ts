import * as THREE from 'three';
import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';

const clip = ((polygonClippingModule as unknown as { default?: typeof polygonClippingModule }).default
  ?? polygonClippingModule) as typeof polygonClippingModule;

/**
 * A wall with openings, built face by face: each face is one flat polygon with the openings
 * cut out of it (triangulated as a whole), plus the reveals round each opening. Unlike boxes
 * stacked round each opening, or a CSG cut, no face is split into pieces that don't share
 * their edges, so edge lines are drawn only where the wall really has an edge.
 *
 * Everything is in the wall's local frame: x along its length, y up (centred on the wall's
 * middle), z through its thickness with +z the outside face.
 */

/** An opening's cut: x and y extents in the wall's local frame (may run past the wall's ends). */
export interface WallCut { xMin: number; xMax: number; yMin: number; yMax: number }

type V2 = [number, number];
const EPS = 1e-6;

function ring(points: V2[]): Ring {
  return [...points, points[0]!] as Ring;
}

function open(r: Ring): V2[] {
  const pts = r.map(p => [p[0], p[1]] as V2);
  const a = pts[0], b = pts[pts.length - 1];
  if (a && b && Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) pts.pop();
  return pts;
}

function rect(x0: number, y0: number, x1: number, y1: number): Polygon {
  return [ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])];
}

/** A polygon (outer ring then holes) with rectangles removed. */
function minus(base: Polygon, cuts: Polygon[]): MultiPolygon {
  if (!cuts.length) return [base];
  try {
    return clip.difference(base, ...cuts);
  } catch {
    return [base];
  }
}

class Builder {
  positions: number[] = [];
  normals: number[] = [];

  /** Triangulates polygons in a plane, mapping 2D (a, b) to 3D, facing `normal`. */
  polygons(polys: MultiPolygon, to3: (a: number, b: number) => THREE.Vector3, normal: THREE.Vector3) {
    for (const poly of polys) {
      const rings = poly.map(open).filter(r => r.length >= 3);
      if (!rings.length) continue;
      const [outer, ...holes] = rings;
      const contour = outer!.map(([a, b]) => new THREE.Vector2(a, b));
      const holeVs = holes.map(h => h.map(([a, b]) => new THREE.Vector2(a, b)));
      const all = [...contour, ...holeVs.flat()];
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holeVs)) {
        this.tri(to3(all[i]!.x, all[i]!.y), to3(all[j]!.x, all[j]!.y), to3(all[k]!.x, all[k]!.y), normal);
      }
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normal: THREE.Vector3) {
    this.tri(a, b, c, normal);
    this.tri(a, c, d, normal);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-16) return;
    // Wind to face the requested way.
    if (n.dot(normal) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((this.positions.length / 3) * 2).fill(0), 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Where the vertical line at x crosses the footprint polygon: its z extent, or null. */
function zExtentAt(footprint: V2[], x: number): [number, number] | null {
  const zs: number[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const [ax, az] = footprint[i]!, [bx, bz] = footprint[(i + 1) % footprint.length]!;
    if ((x < Math.min(ax, bx) - EPS) || (x > Math.max(ax, bx) + EPS)) continue;
    if (Math.abs(bx - ax) < EPS) { zs.push(az, bz); continue; }
    const t = (x - ax) / (bx - ax);
    zs.push(az + (bz - az) * t);
  }
  if (zs.length < 2) return null;
  return [Math.min(...zs), Math.max(...zs)];
}

/**
 * Builds a wall of the given footprint (4 corners in local x/z: outer-start, inner-start,
 * inner-end, outer-end, with the long faces running along x) and height, with openings cut
 * through it. Returns null for footprints it can't handle (the caller falls back).
 */
export function buildWallWithCuts(footprint: V2[], height: number, cuts: WallCut[]): THREE.BufferGeometry | null {
  if (footprint.length !== 4) return null;
  const [os, is, ie, oe] = footprint as [V2, V2, V2, V2];
  // Long faces must run along x (constant z), which every wall footprint does.
  if (Math.abs(os[1] - oe[1]) > 1e-4 || Math.abs(is[1] - ie[1]) > 1e-4) return null;
  if (Math.abs(oe[0] - os[0]) < 1e-4 || Math.abs(ie[0] - is[0]) < 1e-4) return null;
  const h = height / 2;
  const xs = footprint.map(p => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);

  // Clip the cuts to the wall and merge any that overlap into one.
  const clipped = cuts
    .map(c => ({ xMin: Math.max(minX, c.xMin), xMax: Math.min(maxX, c.xMax), yMin: Math.max(-h, c.yMin), yMax: Math.min(h, c.yMax) }))
    .filter(c => c.xMax - c.xMin > 0.01 && c.yMax - c.yMin > 0.01)
    .sort((a, b) => a.xMin - b.xMin);
  const merged: WallCut[] = [];
  for (const c of clipped) {
    const last = merged[merged.length - 1];
    if (last && c.xMin <= last.xMax + 0.005) {
      last.xMax = Math.max(last.xMax, c.xMax);
      last.yMin = Math.min(last.yMin, c.yMin);
      last.yMax = Math.max(last.yMax, c.yMax);
    } else merged.push({ ...c });
  }

  const b = new Builder();
  const cutRects = merged.map(c => rect(c.xMin, c.yMin, c.xMax, c.yMax));

  // Long faces: outer (+z side) and inner.
  const outerZ = os[1], innerZ = is[1];
  const outward = outerZ >= innerZ ? 1 : -1;
  for (const [a, e, z, sign] of [[os, oe, outerZ, outward], [is, ie, innerZ, -outward]] as [V2, V2, number, number][]) {
    const x0 = Math.min(a[0], e[0]), x1 = Math.max(a[0], e[0]);
    const face = minus(rect(x0, -h, x1, h), cutRects);
    b.polygons(face, (x, y) => new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, sign));
  }

  // Top and bottom: the footprint, less the openings that reach them.
  const foot: Polygon = [ring(footprint.slice())];
  for (const [y, sign] of [[h, 1], [-h, -1]] as [number, number][]) {
    const bands = merged
      .filter(c => (sign > 0 ? c.yMax >= h - 1e-4 : c.yMin <= -h + 1e-4))
      .map(c => rect(c.xMin, -1e3, c.xMax, 1e3));
    b.polygons(minus(foot, bands), (x, z) => new THREE.Vector3(x, y, z), new THREE.Vector3(0, sign, 0));
  }

  // Ends: the faces joining outer to inner at each end (square or mitred), less any opening
  // crossing them (an opening that runs on into the next wall piece).
  for (const [p, q] of [[os, is], [ie, oe]] as [V2, V2][]) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < EPS) continue;
    const u = new THREE.Vector2((q[0] - p[0]) / len, (q[1] - p[1]) / len);
    // Outward: away from the footprint's middle.
    const mid = footprint.reduce((m, v) => [m[0] + v[0] / 4, m[1] + v[1] / 4] as V2, [0, 0] as V2);
    let n = new THREE.Vector3(u.y, 0, -u.x);
    if ((p[0] - mid[0]) * n.x + (p[1] - mid[1]) * n.z < 0) n = n.negate();
    // In the end face's own (s, y) coordinates, a cut covers the s-range where x is in the cut.
    const bands: Polygon[] = [];
    for (const c of merged) {
      const dx = q[0] - p[0];
      let s0: number, s1: number;
      if (Math.abs(dx) < EPS) {
        if (p[0] < c.xMin - EPS || p[0] > c.xMax + EPS) continue;
        s0 = 0; s1 = len;
      } else {
        const ta = (c.xMin - p[0]) / dx * len, tb = (c.xMax - p[0]) / dx * len;
        s0 = Math.max(0, Math.min(ta, tb)); s1 = Math.min(len, Math.max(ta, tb));
      }
      if (s1 - s0 > 1e-4) bands.push(rect(s0, c.yMin, s1, c.yMax));
    }
    b.polygons(minus(rect(0, -h, len, h), bands),
      (s, y) => new THREE.Vector3(p[0] + u.x * s, y, p[1] + u.y * s), n);
  }

  // Reveals round each opening: the sides (where they are inside the wall), sill and head.
  for (const c of merged) {
    for (const [x, sign] of [[c.xMin, 1], [c.xMax, -1]] as [number, number][]) {
      if (x <= minX + 1e-4 || x >= maxX - 1e-4) continue;
      const zr = zExtentAt(footprint, x);
      if (!zr || zr[1] - zr[0] < EPS) continue;
      b.quad(new THREE.Vector3(x, c.yMin, zr[0]), new THREE.Vector3(x, c.yMin, zr[1]),
        new THREE.Vector3(x, c.yMax, zr[1]), new THREE.Vector3(x, c.yMax, zr[0]), new THREE.Vector3(sign, 0, 0));
    }
    const band = rect(c.xMin, -1e3, c.xMax, 1e3);
    let within: MultiPolygon;
    try { within = clip.intersection(foot, band); } catch { within = []; }
    if (c.yMin > -h + 1e-4) b.polygons(within, (x, z) => new THREE.Vector3(x, c.yMin, z), new THREE.Vector3(0, 1, 0));
    if (c.yMax < h - 1e-4) b.polygons(within, (x, z) => new THREE.Vector3(x, c.yMax, z), new THREE.Vector3(0, -1, 0));
  }

  return b.build();
}

/** A plain wall's footprint (a box) in the same corner order as a mitred one. */
export function boxFootprint(length: number, thickness: number): V2[] {
  const l = length / 2, t = thickness / 2;
  return [[-l, t], [-l, -t], [l, -t], [l, t]];
}
