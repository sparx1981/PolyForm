import * as THREE from 'three';
import type { Shape } from '../types';

/**
 * Reading a roof built by the roof tool: its surface (heights and slope, by casting down onto
 * its own geometry) and its eaves. Shared by roof extras, dormers, the roof cut-outs and the
 * timber frame, so they all agree on where the roof is.
 */
export type V2 = [number, number];
export type Facing = 'south' | 'north' | 'east' | 'west';
export const FACING: Record<Facing, V2> = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] };


export class RoofSurface {
  private mesh: THREE.Mesh | null = null;
  private ray = new THREE.Raycaster();
  constructor(roof: Shape) {
    const pos = roof.geometryData?.positions as number[] | undefined;
    if (pos && pos.length >= 9) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      this.mesh.updateMatrixWorld();
    }
  }
  /** Top of the roof at a local plan point, with its upward normal; null off the roof. */
  at(x: number, z: number): { y: number; normal: THREE.Vector3 } | null {
    if (!this.mesh) return null;
    this.ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    const hit = this.ray.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone();
    if (n.y < 0) n.negate();
    return { y: hit.point.y, normal: n };
  }
  dispose() { this.mesh?.geometry.dispose(); }
}

export function eavePolygon(roof: Shape): V2[] {
  const rd = roof.roofData ?? {};
  if (Array.isArray(rd.localEavePoly) && rd.localEavePoly.length >= 3) return rd.localEavePoly as V2[];
  const [w = 8, , d = 8] = Array.isArray(roof.args) ? roof.args as number[] : [];
  const o = rd.eaveOverhang ?? 0.3;
  return [[-w / 2 - o, -d / 2 - o], [w / 2 + o, -d / 2 - o], [w / 2 + o, d / 2 + o], [-w / 2 - o, d / 2 + o]];
}

export function wallPolygon(roof: Shape): V2[] {
  const rd = roof.roofData ?? {};
  if (Array.isArray(rd.localWallPoly) && rd.localWallPoly.length >= 3) return rd.localWallPoly as V2[];
  const [w = 8, , d = 8] = Array.isArray(roof.args) ? roof.args as number[] : [];
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
}

export function signedArea(p: V2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
}

export interface Edge { a: V2; b: V2; u: V2; out: V2; length: number; sloped: boolean }

/** The roof's eave edges, each with its outward direction and whether the roof rises from it (not a gable end). */
export function roofEdges(poly: V2[], surface: RoofSurface): Edge[] {
  const ccw = signedArea(poly) > 0;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: V2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    // Outward normal: for a counter-clockwise (x, z) polygon, (u.z, -u.x).
    const out: V2 = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const near = surface.at(mid[0] - out[0] * 0.15, mid[1] - out[1] * 0.15);
    const far = surface.at(mid[0] - out[0] * 1.2, mid[1] - out[1] * 1.2);
    const sloped = !!near && !!far && far.y - near.y > 0.15;
    return { a, b, u, out, length, sloped };
  });
}

export function facingEdge(all: Edge[], facing: Facing): Edge | null {
  const [fx, fz] = FACING[facing];
  let best: Edge | null = null, score = -Infinity;
  for (const e of all) {
    if (!e.sloped) continue;
    const s = e.out[0] * fx + e.out[1] * fz + e.length * 0.001;
    if (s > score) { score = s; best = e; }
  }
  return best;
}

