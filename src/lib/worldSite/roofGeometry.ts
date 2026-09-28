/**
 * PolyForm — World View: the solid of an existing building with a pitched roof.
 *
 * The roof is the lowest of its planes at each point (see SiteRoof). Each plane's part of the
 * roof is the outline clipped to where that plane is lowest; walls rise from the building's
 * underside to the roof edge, with a corner wherever the edge passes from one plane to the next
 * (a gable's triangle). Every triangle is wound to face outwards.
 */

import * as THREE from 'three';
import type { SiteBuildingData } from '../../types';

type P = [number, number];
type Plane = [number, number, number];

const planeAt = (p: Plane, x: number, z: number) => p[0] * x + p[1] * z + p[2];

/** The roof height at a plan point. */
export function roofHeightAt(planes: Plane[], x: number, z: number): number {
  let h = Infinity;
  for (const p of planes) h = Math.min(h, planeAt(p, x, z));
  return h;
}

/** Keeps the part of a polygon where f(x, z) <= 0, for a linear f (Sutherland-Hodgman). */
export function clipPolygon(poly: P[], f: (x: number, z: number) => number): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const fa = f(a[0], a[1]), fb = f(b[0], b[1]);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function polygonArea(poly: P[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!, [x1, z1] = poly[(i + 1) % poly.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Each plane with the part of the outline where it is the lowest (its piece of the roof). */
export function roofRegions(planes: Plane[], ring: P[]): { plane: Plane; region: P[] }[] {
  const out: { plane: Plane; region: P[] }[] = [];
  for (let k = 0; k < planes.length; k++) {
    let region: P[] = ring.map(p => [p[0], p[1]]);
    for (let j = 0; j < planes.length && region.length >= 3; j++) {
      if (j === k) continue;
      const pk = planes[k]!, pj = planes[j]!;
      region = clipPolygon(region, (x, z) => planeAt(pk, x, z) - planeAt(pj, x, z));
    }
    if (region.length >= 3 && Math.abs(polygonArea(region)) >= 1e-4) out.push({ plane: planes[k]!, region });
  }
  return out;
}

/** The highest point of a roof over an outline (at a corner of one of its pieces). */
export function roofTop(planes: Plane[], ring: P[]): number {
  let top = -Infinity;
  for (const { region } of roofRegions(planes, ring)) for (const [x, z] of region) top = Math.max(top, roofHeightAt(planes, x, z));
  return Number.isFinite(top) ? top : Math.max(...ring.map(([x, z]) => roofHeightAt(planes, x, z)));
}

/** Where along a wall edge (0-1) the lowest plane changes. */
function edgeBreaks(a: P, b: P, planes: Plane[]): number[] {
  const ts: number[] = [];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
    const di = (t: number) => planeAt(planes[i]!, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
      - planeAt(planes[j]!, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    const d0 = di(0), d1 = di(1);
    if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) {
      const t = d0 / (d0 - d1);
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      // Only where these two are the lowest there (a real crease of the roof).
      if (Math.abs(roofHeightAt(planes, x, z) - planeAt(planes[i]!, x, z)) < 1e-6) ts.push(t);
    }
  }
  return ts.sort((p, q) => p - q);
}

/**
 * The building's solid in its own frame (plan x/z, y up from its position), or null when it
 * has no pitched roof (drawn as a plain block instead).
 */
export function pitchedBuildingGeometry(data: SiteBuildingData): THREE.BufferGeometry | null {
  const roof = data.roof;
  if (!roof || roof.planes.length === 0 || data.footprint.length < 3) return null;
  const planes = roof.planes;
  const ring = data.footprint;
  const bottom = Math.max(0, data.minHeight ?? 0);
  const pos: number[] = [];
  /** Adds a triangle, flipped if needed so it faces along `out` (x, y, z). */
  const tri = (a: number[], b: number[], c: number[], out: [number, number, number]) => {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) pos.push(...a, ...c, ...b);
    else pos.push(...a, ...b, ...c);
  };
  // Which side of each wall is outside: the outline's winding in plan.
  const wind = Math.sign(polygonArea(ring)) || 1;

  // Roof: each plane over the part of the outline where it is lowest.
  for (const { plane: k, region } of roofRegions(planes, ring)) {
    const contour = region.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const v = [i0!, i1!, i2!].map(i => { const [x, z] = region[i]!; return [x, Math.max(bottom, planeAt(k, x, z)), z]; });
      tri(v[0]!, v[1]!, v[2]!, [0, 1, 0]);
    }
  }

  // Walls: up to the roof edge, with a corner at every crease the edge crosses.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ts = [0, ...edgeBreaks(a, b, planes), 1];
    // Outward in plan: the edge turned a quarter away from the inside.
    const out: [number, number, number] = [(b[1] - a[1]) * wind, 0, -(b[0] - a[0]) * wind];
    for (let s = 0; s + 1 < ts.length; s++) {
      const p0: P = [a[0] + (b[0] - a[0]) * ts[s]!, a[1] + (b[1] - a[1]) * ts[s]!];
      const p1: P = [a[0] + (b[0] - a[0]) * ts[s + 1]!, a[1] + (b[1] - a[1]) * ts[s + 1]!];
      const h0 = Math.max(bottom, roofHeightAt(planes, p0[0], p0[1]));
      const h1 = Math.max(bottom, roofHeightAt(planes, p1[0], p1[1]));
      tri([p0[0], bottom, p0[1]], [p1[0], bottom, p1[1]], [p1[0], h1, p1[1]], out);
      tri([p0[0], bottom, p0[1]], [p1[0], h1, p1[1]], [p0[0], h0, p0[1]], out);
    }
  }

  // Underside.
  const base = ring.map(([x, z]) => new THREE.Vector2(x, z));
  for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(base, [])) {
    const [a, b, c] = [i0!, i1!, i2!].map(i => [ring[i]![0], bottom, ring[i]![1]]);
    tri(a!, b!, c!, [0, -1, 0]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}
