import * as THREE from 'three';
import type { Shape } from '../types';
import { RoofSurface, eavePolygon, facingEdge, roofEdges, wallPolygon, type Edge, type Facing, type V2 } from './roofSurface';

/**
 * Dormers: windows that stand up out of a pitched roof, each with its own small roof.
 *
 * One `dormerLayout` places a dormer on the roof - where its front wall stands, how deep its
 * side walls (cheeks) run back into the slope before they meet it, and the plan outline of the
 * hole it needs in the main roof. The dormer's 3D model, the cut in the main roof and its tiles,
 * the timber framing (trimmed rafters and the dormer's own frame) and the headroom used for the
 * usable floor area all read the same layout, so they always agree.
 *
 * Everything here is in the roof shape's local frame: x/z in plan, y up from the top of the walls.
 */

export type DormerType = 'gable' | 'flat' | 'hipped';

export interface Dormer {
  id: string;
  /** Plan position of the middle of the front wall, roof-local. */
  x: number;
  z: number;
  type: DormerType;
  /** Front wall width, metres. */
  width: number;
  /** Front wall height (floor of the dormer to its eaves), metres. */
  height: number;
  /** Front wall straight up from the wall below (breaks the eave), rather than set back on the slope. */
  flush: boolean;
}

export const DORMER_DEFAULTS: Omit<Dormer, 'id' | 'x' | 'z'> = { type: 'gable', width: 1.6, height: 1.3, flush: false };

/** Pitch of a gable or hipped dormer's own roof. */
const DORMER_PITCH = THREE.MathUtils.degToRad(40);
/** How far the dormer roof oversails its walls. */
const EAVE = 0.15;
/** Depth of the main roof build-up (covering on rafters) under its top surface. */
export const ROOF_BUILDUP = 0.2;
const CHEEK = 0.08;
const FRONT = 0.1;

export interface DormerLayout {
  dormer: Dormer;
  /** Across the dormer (along the eave). */
  X: THREE.Vector3;
  /** Into the roof, up the slope (horizontal). */
  Z: THREE.Vector3;
  /** Middle of the front wall's base. */
  origin: THREE.Vector3;
  /** Slope of the main roof, radians. */
  slope: number;
  /** Main roof top surface at the front line, relative to `origin.y`. */
  roofAtFront: number;
  width: number;
  /** Front wall height, from origin.y. */
  height: number;
  /** How far back the cheeks run before the main roof covers them (at the plate), metres. */
  depthCheek: number;
  /** How far back the dormer's roof runs before it meets the main roof. */
  depthRoof: number;
  /** Height of the dormer's ridge (or flat roof top) above origin.y. */
  top: number;
  /** Plan outline of the hole in the main roof. */
  footprint: V2[];
  /** The eave this dormer faces out over. */
  edge: Edge;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Dormers saved on a roof, including ones made with the older "count and side" setting. */
export function dormersOf(roof: Shape): Dormer[] {
  const extras = roof.roofData?.extras ?? {};
  if (Array.isArray(extras.dormerList)) return extras.dormerList as Dormer[];
  const n = Math.min(3, Number(extras.dormers) || 0);
  return n ? evenlySpaced(roof, n, (extras.dormerFacing as Facing) ?? 'south') : [];
}

/** `count` dormers spaced evenly along the eave facing `facing`, set back 0.7 m up the slope. */
export function evenlySpaced(roof: Shape, count: number, facing: Facing, base: Partial<Dormer> = {}): Dormer[] {
  const surface = new RoofSurface(roof);
  try {
    const edge = facingEdge(roofEdges(eavePolygon(roof), surface), facing);
    if (!edge) return [];
    const overhang = roof.roofData?.eaveOverhang ?? 0.3;
    const inward: V2 = [-edge.out[0], -edge.out[1]];
    const width = base.width ?? DORMER_DEFAULTS.width;
    // Grouped round the middle of the slope, a metre apart: hipped slopes narrow towards the top.
    const step = Math.min(width + 1, edge.length / count);
    return Array.from({ length: count }, (_, k) => {
      const along = edge.length / 2 + (k - (count - 1) / 2) * step;
      return {
        ...DORMER_DEFAULTS, ...base,
        id: `d${k + 1}-${Math.random().toString(36).slice(2, 7)}`,
        x: +(edge.a[0] + edge.u[0] * along + inward[0] * (overhang + 0.7)).toFixed(3),
        z: +(edge.a[1] + edge.u[1] * along + inward[1] * (overhang + 0.7)).toFixed(3),
      };
    });
  } finally {
    surface.dispose();
  }
}

/** The eave whose slope a point sits on: faces the way the roof falls there, and is nearest. */
function eaveUnder(edges: Edge[], p: V2, downhill: V2): Edge | null {
  let best: Edge | null = null, score = -Infinity;
  for (const e of edges) {
    if (!e.sloped) continue;
    const align = e.out[0] * downhill[0] + e.out[1] * downhill[1];
    if (align < 0.7) continue;
    const dist = Math.abs((p[0] - e.a[0]) * e.out[0] + (p[1] - e.a[1]) * e.out[1]);
    const s = align * 10 - dist;
    if (s > score) { score = s; best = e; }
  }
  return best;
}

/** Where a dormer sits on its roof, or null if it doesn't fit (off the roof, on a hip line, past the ridge). */
export function dormerLayout(roof: Shape, dormer: Dormer, surface = new RoofSurface(roof), dispose = true): DormerLayout | null {
  try {
    const at = surface.at(dormer.x, dormer.z);
    if (!at) return null;
    const horiz = Math.hypot(at.normal.x, at.normal.z);
    if (horiz < 0.1) return null;
    const downhill: V2 = [at.normal.x / horiz, at.normal.z / horiz];
    const edge = eaveUnder(roofEdges(eavePolygon(roof), surface), [dormer.x, dormer.z], downhill);
    if (!edge) return null;
    const X = v(edge.u[0], 0, edge.u[1]);
    const Z = v(-edge.out[0], 0, -edge.out[1]);
    const slope = Math.atan2(horiz, at.normal.y);
    const tan = Math.tan(slope);
    const w = dormer.width, hf = dormer.height;

    // Front line: where the dormer was put, or straight above the wall below.
    let origin = v(dormer.x, at.y, dormer.z);
    let roofAtFront = 0;
    if (dormer.flush) {
      let best = Infinity, run = 0;
      const walls = wallPolygon(roof);
      for (let i = 0; i < walls.length; i++) {
        const a = walls[i], b = walls[(i + 1) % walls.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        if (Math.abs(u[0] * edge.u[0] + u[1] * edge.u[1]) < 0.95) continue;
        // Distance up the slope from this wall line to the dormer's point.
        const d = (dormer.x - a[0]) * Z.x + (dormer.z - a[1]) * Z.z;
        if (d >= -0.05 && d < best) { best = d; run = d; }
      }
      if (!Number.isFinite(best)) return null;
      const front = v(dormer.x - Z.x * run, 0, dormer.z - Z.z * run);
      const s = surface.at(front.x + Z.x * 0.05, front.z + Z.z * 0.05);
      if (!s) return null;
      origin = front;
      roofAtFront = s.y - 0.05 * tan;
    }

    // Cheeks run back until the roof's underside reaches the dormer's plate.
    const depthCheek = Math.max(0.3, (hf - roofAtFront + ROOF_BUILDUP) / tan);
    const rise = dormer.type === 'flat' ? 0.22 : (w / 2 + EAVE) * Math.tan(DORMER_PITCH) - EAVE * Math.tan(DORMER_PITCH);
    const top = hf + rise;
    const depthRoof = Math.max(depthCheek, (top - roofAtFront) / tan);

    // The whole dormer must stay on this one slope, clear of hips and the ridge.
    // (A gable or hipped dormer's roof narrows to its ridge, so only the ridge reaches depthRoof.)
    const lx = X.clone().multiplyScalar(w / 2 + EAVE);
    const sides = dormer.type === 'flat' ? depthRoof : depthCheek;
    for (const [sx, d] of [[-1, 0.1], [1, 0.1], [-1, sides], [1, sides], [0, depthRoof]] as const) {
      const p = origin.clone().addScaledVector(Z, d).addScaledVector(lx, sx);
      const s = surface.at(p.x, p.z);
      if (!s) return null;
      const h = Math.hypot(s.normal.x, s.normal.z) || 1;
      if ((s.normal.x / h) * downhill[0] + (s.normal.z / h) * downhill[1] < 0.97) return null;
    }

    const P = (x: number, d: number): V2 => {
      const p = origin.clone().addScaledVector(X, x).addScaledVector(Z, d);
      return [+p.x.toFixed(4), +p.z.toFixed(4)];
    };
    // A flush dormer also cuts through the eave in front of it (fascia, soffit, gutter).
    const front = dormer.flush ? -((roof.roofData?.eaveOverhang ?? 0.3) + 0.2) : 0;
    const footprint: V2[] = dormer.type === 'flat'
      ? [P(-w / 2, front), P(w / 2, front), P(w / 2, depthCheek), P(-w / 2, depthCheek)]
      : [P(-w / 2, front), P(w / 2, front), P(w / 2, depthCheek), P(0, depthRoof), P(-w / 2, depthCheek)];

    return { dormer, X, Z, origin, slope, roofAtFront, width: w, height: hf, depthCheek, depthRoof, top, footprint, edge };
  } finally {
    if (dispose) surface.dispose();
  }
}

export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// --- 3D model ----------------------------------------------------------------------------------

export interface DormerMeshes {
  walls: THREE.BufferGeometry[];
  roofs: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  /** Plastered linings and ceiling, seen from inside the room. */
  lining: THREE.BufferGeometry[];
}

/** Triangles from a list of quads/triangles (each an array of points), both sides drawn by the viewer. */
function surfaces(polys: THREE.Vector3[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const p of polys) {
    for (let i = 1; i + 1 < p.length; i++) for (const q of [p[0], p[i], p[i + 1]]) pos.push(q.x, q.y, q.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A thin slab between four corners (a roof plane with thickness). */
function slab(corners: THREE.Vector3[], thickness: number): THREE.BufferGeometry {
  const n = new THREE.Vector3().crossVectors(corners[1].clone().sub(corners[0]), corners[2].clone().sub(corners[0])).normalize();
  if (n.y < 0) n.negate();
  const top = corners, bot = corners.map(c => c.clone().addScaledVector(n, -thickness));
  const sides = top.map((c, i) => [c, top[(i + 1) % top.length], bot[(i + 1) % bot.length], bot[i]]);
  return surfaces([top, [...bot].reverse(), ...sides]);
}

/** A dormer's walls, roof, glass and inside linings, in the roof's local frame. */
export function dormerMeshes(L: DormerLayout): DormerMeshes {
  const { width: w, height: hf, depthCheek, depthRoof, roofAtFront } = L;
  const tan = Math.tan(L.slope);
  const basis = new THREE.Matrix4().makeBasis(L.X, new THREE.Vector3(0, 1, 0), L.Z);
  const place = (g: THREE.BufferGeometry) => { g.applyMatrix4(basis); g.translate(L.origin.x, L.origin.y, L.origin.z); return g; };
  const out: DormerMeshes = { walls: [], roofs: [], glass: [], lining: [] };

  // Front wall round a window.
  const win = { w: w - 0.4, h: hf - 0.45, sill: 0.25 };
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => place(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  out.walls.push(box(w, win.sill, FRONT, 0, win.sill / 2, FRONT / 2));
  out.walls.push(box(w, hf - win.sill - win.h, FRONT, 0, win.sill + win.h + (hf - win.sill - win.h) / 2, FRONT / 2));
  for (const sx of [-1, 1]) out.walls.push(box((w - win.w) / 2, win.h, FRONT, sx * (w + win.w) / 4, win.sill + win.h / 2, FRONT / 2));
  out.glass.push(box(win.w, win.h, 0.02, 0, win.sill + win.h / 2, FRONT / 2));
  // Window frame.
  for (const [sx, sy, x, y] of [[win.w, 0.05, 0, win.sill + 0.025], [win.w, 0.05, 0, win.sill + win.h - 0.025], [0.05, win.h, -win.w / 2 + 0.025, win.sill + win.h / 2], [0.05, win.h, win.w / 2 - 0.025, win.sill + win.h / 2], [0.04, win.h, 0, win.sill + win.h / 2]] as const) {
    out.walls.push(box(sx, sy, FRONT + 0.02, x, y, FRONT / 2));
  }

  // Cheeks: from the front, back along the roof's underside to the plate.
  const under = (d: number) => roofAtFront - ROOF_BUILDUP + d * tan;
  for (const sx of [-1, 1]) {
    const outer = sx * w / 2, inner = sx * (w / 2 - CHEEK);
    const tri = (xx: number) => [new THREE.Vector3(xx, under(0), 0), new THREE.Vector3(xx, hf, 0), new THREE.Vector3(xx, hf, depthCheek)];
    const a = tri(outer), b = tri(inner);
    out.walls.push(place(surfaces([a, b, [a[0], a[1], b[1], b[0]], [a[1], a[2], b[2], b[1]], [a[2], a[0], b[0], b[2]]])));
    // Plaster on the inside face.
    out.lining.push(place(surfaces([tri(inner - sx * 0.012)])));
  }
  // Ceiling inside, just under the plate.
  out.lining.push(place(new THREE.BoxGeometry(w - 2 * CHEEK, 0.015, depthCheek - FRONT).translate(0, hf - 0.03, FRONT + (depthCheek - FRONT) / 2)));

  // The dormer's roof.
  const eaveY = hf - EAVE * (L.dormer.type === 'flat' ? 0 : Math.tan(DORMER_PITCH));
  const ex = w / 2 + EAVE;
  const back = depthRoof + 0.05;
  if (L.dormer.type === 'flat') {
    out.roofs.push(box(2 * ex, 0.2, back + EAVE, 0, hf + 0.1, (back - EAVE) / 2));
  } else {
    const ridgeY = L.top;
    const ridgeFront = L.dormer.type === 'hipped' ? w / 2 : -EAVE;
    for (const sx of [-1, 1]) {
      const eFront = new THREE.Vector3(sx * ex, eaveY, -EAVE), eBack = new THREE.Vector3(sx * ex, eaveY, back);
      const rFront = new THREE.Vector3(0, ridgeY, ridgeFront), rBack = new THREE.Vector3(0, ridgeY, back);
      out.roofs.push(place(slab(sx < 0 ? [eFront, rFront, rBack, eBack] : [rFront, eFront, eBack, rBack], 0.06)));
    }
    if (L.dormer.type === 'hipped') {
      out.roofs.push(place(slab([new THREE.Vector3(-ex, eaveY, -EAVE), new THREE.Vector3(ex, eaveY, -EAVE), new THREE.Vector3(0, ridgeY, ridgeFront)], 0.06)));
    } else {
      // Gable over the front wall.
      const g = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, ridgeY - hf)]);
      out.walls.push(place(new THREE.ExtrudeGeometry(g, { depth: FRONT, bevelEnabled: false }).translate(0, hf, 0)));
    }
  }
  return out;
}

// --- Timber ------------------------------------------------------------------------------------

export interface FrameMember {
  name: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  width: number;
  depth: number;
  subTag: string;
}

const STUD: [number, number] = [0.045, 0.095];
const RAFTER: [number, number] = [0.045, 0.145];

/** The dormer's own frame, roof-local: cheek and front studs, lintel, plates, ridge and rafters. */
export function dormerFrame(L: DormerLayout, spacing = 0.4): FrameMember[] {
  const { width: w, height: hf, depthCheek, depthRoof } = L;
  const tan = Math.tan(L.slope);
  const at = (x: number, y: number, d: number) => L.origin.clone().addScaledVector(L.X, x).addScaledVector(L.Z, d).setY(L.origin.y + y);
  const under = (d: number) => L.roofAtFront - ROOF_BUILDUP + d * tan;
  const out: FrameMember[] = [];
  const add = (name: string, a: THREE.Vector3, b: THREE.Vector3, size: [number, number], subTag: string) =>
    out.push({ name, a, b, width: size[0], depth: size[1], subTag });

  // Front: corner posts, studs beside the window, lintel, sill.
  const win = { w: w - 0.4, h: hf - 0.45, sill: 0.25 };
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03, -win.w / 2 - 0.03, win.w / 2 + 0.03]) add('Dormer Front Stud', at(x, 0, FRONT / 2), at(x, hf, FRONT / 2), STUD, 'timber-dormer-stud');
  add('Dormer Lintel', at(-w / 2, win.sill + win.h + 0.07, FRONT / 2), at(w / 2, win.sill + win.h + 0.07, FRONT / 2), [0.045, 0.145], 'timber-dormer-lintel');
  add('Dormer Sill Plate', at(-w / 2, 0.03, FRONT / 2), at(w / 2, 0.03, FRONT / 2), STUD, 'timber-dormer-plate');
  // Cheeks: studs from the rafter below up to the wall plate, and the plate itself.
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.03);
    for (let d = spacing; d < depthCheek - 0.05; d += spacing) add('Dormer Cheek Stud', at(x, Math.max(0, under(d)), d), at(x, hf, d), STUD, 'timber-dormer-stud');
    add('Dormer Wall Plate', at(x, hf, 0), at(x, hf, depthCheek), STUD, 'timber-dormer-plate');
  }
  // Roof.
  if (L.dormer.type === 'flat') {
    for (let d = 0.05; d <= depthRoof; d += spacing) add('Dormer Roof Joist', at(-w / 2 - EAVE, hf + 0.08, d), at(w / 2 + EAVE, hf + 0.08, d), RAFTER, 'timber-dormer-joist');
  } else {
    const ridgeFront = L.dormer.type === 'hipped' ? w / 2 : 0;
    add('Dormer Ridge', at(0, L.top - 0.08, ridgeFront), at(0, L.top - 0.08, depthRoof), [0.045, 0.17], 'timber-dormer-ridge');
    for (let d = ridgeFront + 0.02; d <= depthRoof; d += spacing) {
      for (const sx of [-1, 1]) add('Dormer Rafter', at(sx * (w / 2 + EAVE), hf - EAVE * Math.tan(DORMER_PITCH), d), at(0, L.top, d), RAFTER, 'timber-dormer-rafter');
    }
    if (L.dormer.type === 'hipped') {
      for (const sx of [-1, 1]) add('Dormer Hip Rafter', at(sx * (w / 2 + EAVE), hf - EAVE * Math.tan(DORMER_PITCH), -EAVE), at(0, L.top, ridgeFront), [0.045, 0.17], 'timber-dormer-rafter');
    }
  }
  return out;
}

/**
 * What the main roof's framing needs round its dormer openings: `members` are the doubled trimmer
 * rafters either side of each hole and the headers across its top and bottom; `trim` takes one of
 * the main roof's own members (roof-local, on the roof surface line like the generator draws
 * them) and returns the pieces of it to keep - rafters and noggins lose the length inside a hole,
 * and a rafter that would sit where a trimmer now goes is dropped. Other members pass through.
 */
export function dormerOpenings(layouts: DormerLayout[], ridgeHeight: number) {
  const [rw] = RAFTER;
  const plans = layouts.map(L => {
    const tan = Math.tan(L.slope);
    const y0 = L.origin.y + L.roofAtFront;
    const rel = L.footprint.map(([x, z]) => {
      const dx = x - L.origin.x, dz = z - L.origin.z;
      return { x: dx * L.X.x + dz * L.X.z, d: dx * L.Z.x + dz * L.Z.z };
    });
    return {
      L, tan, y0,
      sideX: Math.max(...rel.map(p => Math.abs(p.x))) + rw / 2 + 0.005,
      dFront: Math.min(...rel.map(p => p.d)),
      dBack: Math.max(...rel.map(p => p.d)),
      dEave: -y0 / tan,
      dRidge: (ridgeHeight - y0) / tan,
    };
  });
  type Plan = typeof plans[number];
  const point = (p: Plan, x: number, d: number) =>
    p.L.origin.clone().addScaledVector(p.L.X, x).addScaledVector(p.L.Z, d).setY(p.y0 + d * p.tan);

  const members: FrameMember[] = [];
  for (const p of plans) {
    if (p.dRidge <= p.dEave) continue;
    for (const sx of [-1, 1]) {
      for (const k of [0, 1]) {
        const x = sx * (p.sideX + k * rw);
        members.push({ name: 'Dormer Trimmer Rafter', a: point(p, x, p.dEave), b: point(p, x, p.dRidge), width: rw, depth: RAFTER[1], subTag: 'timber-trimmer-rafter' });
      }
    }
    const header = (d: number) => members.push({
      name: 'Dormer Header', a: point(p, -p.sideX, d), b: point(p, p.sideX, d), width: rw, depth: RAFTER[1], subTag: 'timber-header-rafter',
    });
    if (p.dFront > p.dEave + 0.1) header(p.dFront - rw / 2);
    if (p.dBack < p.dRidge - 0.1) header(p.dBack + rw / 2);
  }

  const trimmable = (subTag: string) => (subTag.includes('rafter') || subTag.includes('noggin') || subTag.includes('purlin'))
    && !/hip-rafter|valley-rafter|ridge|dormer|trimmer|header/.test(subTag);

  const trim = (a: THREE.Vector3, b: THREE.Vector3, subTag: string): [THREE.Vector3, THREE.Vector3][] => {
    if (!layouts.length || !trimmable(subTag)) return [[a, b]];
    let pieces: [THREE.Vector3, THREE.Vector3][] = [[a, b]];
    for (const p of plans) {
      const next: typeof pieces = [];
      for (const [s, e] of pieces) {
        const dx = e.x - s.x, dz = e.z - s.z;
        const len = Math.hypot(dx, dz);
        // A rafter running up the slope where a trimmer now stands is replaced by it.
        if (len > 1e-6 && subTag.includes('rafter') && Math.abs((dx * p.L.X.x + dz * p.L.X.z) / len) < 0.15) {
          const x = (s.x - p.L.origin.x) * p.L.X.x + (s.z - p.L.origin.z) * p.L.X.z;
          const ds = (s.x - p.L.origin.x) * p.L.Z.x + (s.z - p.L.origin.z) * p.L.Z.z;
          const de = (e.x - p.L.origin.x) * p.L.Z.x + (e.z - p.L.origin.z) * p.L.Z.z;
          const overlaps = Math.max(ds, de) > p.dFront && Math.min(ds, de) < p.dBack;
          if (overlaps && Math.abs(x) > p.sideX - rw - 0.03 && Math.abs(x) < p.sideX + 2 * rw + 0.03) continue;
        }
        // Split at every crossing of the hole's outline and drop the pieces inside it.
        const ts = [0, 1];
        const poly = p.L.footprint;
        for (let i = 0; i < poly.length; i++) {
          const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
          const ex = x2 - x1, ez = z2 - z1;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((x1 - s.x) * ez - (z1 - s.z) * ex) / den;
          const u = ((x1 - s.x) * dz - (z1 - s.z) * dx) / den;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
        ts.sort((m, n) => m - n);
        for (let i = 0; i < ts.length - 1; i++) {
          const tm = (ts[i] + ts[i + 1]) / 2;
          if (pointInPolygon([s.x + dx * tm, s.z + dz * tm], poly)) continue;
          next.push([s.clone().lerp(e, ts[i]), s.clone().lerp(e, ts[i + 1])]);
        }
      }
      pieces = next;
    }
    // Join neighbouring kept pieces back together (split points that turned out to be outside).
    const joined: typeof pieces = [];
    for (const piece of pieces) {
      const last = joined[joined.length - 1];
      if (last && last[1].distanceTo(piece[0]) < 1e-6) last[1] = piece[1];
      else joined.push(piece);
    }
    return joined;
  };

  return { members, trim };
}

// --- Headroom ----------------------------------------------------------------------------------

/**
 * Ceiling height inside a dormer at a roof-local plan point, above the roof's local y = 0
 * (the top of the walls), or null outside every dormer.
 */
export function dormerCeilingAt(layouts: DormerLayout[], x: number, z: number): number | null {
  for (const L of layouts) {
    const inner = L.footprint;
    if (!pointInPolygon([x, z], inner)) continue;
    const d = (x - L.origin.x) * L.Z.x + (z - L.origin.z) * L.Z.z;
    if (d < 0 || d > L.depthCheek) continue;
    return L.origin.y + L.height - 0.03;
  }
  return null;
}

export function layoutsOf(roof: Shape): DormerLayout[] {
  const surface = new RoofSurface(roof);
  try {
    return dormersOf(roof).map(d => dormerLayout(roof, d, surface, false)).filter((l): l is DormerLayout => !!l);
  } finally {
    surface.dispose();
  }
}

// --- The hole in the main roof --------------------------------------------------------------------

/**
 * A roof part's geometry with each dormer's opening taken out. `offset` is the part's position
 * minus the roof's (parts of one roof normally share its position). Solid parts (slopes, fascia,
 * soffits) are cut with CSG; tile meshes, which are huge, just lose the tiles inside the opening.
 */
export function cutForDormers(
  geometry: THREE.BufferGeometry,
  layouts: DormerLayout[],
  offset: THREE.Vector3,
  mode: 'solid' | 'tiles',
  csg: { Brush: any; Evaluator: any; SUBTRACTION: any },
): THREE.BufferGeometry {
  if (!layouts.length) return geometry;
  const inside = (x: number, z: number) => layouts.some(L => pointInPolygon([x + offset.x, z + offset.z], L.footprint));
  if (mode === 'tiles') {
    const src = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = src.attributes.position;
    const keep: number[] = [];
    for (let t = 0; t < pos.count / 3; t++) {
      const cx = (pos.getX(t * 3) + pos.getX(t * 3 + 1) + pos.getX(t * 3 + 2)) / 3;
      const cz = (pos.getZ(t * 3) + pos.getZ(t * 3 + 1) + pos.getZ(t * 3 + 2)) / 3;
      if (!inside(cx, cz)) keep.push(t);
    }
    if (keep.length * 3 === pos.count) return geometry;
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.attributes[name] as THREE.BufferAttribute;
      const arr = new Float32Array(keep.length * 3 * a.itemSize);
      keep.forEach((t, i) => { for (let k = 0; k < 3 * a.itemSize; k++) arr[i * 3 * a.itemSize + k] = a.array[t * 3 * a.itemSize + k] as number; });
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return out;
  }
  const { Brush, Evaluator, SUBTRACTION } = csg;
  // Roof parts carry positions and normals only (no UVs): cut just those.
  const solid = new THREE.BufferGeometry();
  solid.setAttribute('position', geometry.attributes.position);
  if (geometry.index) solid.setIndex(geometry.index);
  if (geometry.attributes.normal) solid.setAttribute('normal', geometry.attributes.normal);
  else solid.computeVertexNormals();
  let brush = new Brush(solid);
  brush.updateMatrixWorld();
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  for (const L of layouts) {
    const shape = new THREE.Shape(L.footprint.map(([x, z]) => new THREE.Vector2(x - offset.x, z - offset.z)));
    const cutter = new THREE.ExtrudeGeometry(shape, { depth: 40, bevelEnabled: false });
    cutter.deleteAttribute('uv');
    // Stand the prism up: the plan outline's y becomes z, and it runs from well below to well above the roof.
    cutter.rotateX(Math.PI / 2);
    cutter.translate(0, 20 - offset.y, 0);
    const cut = new Brush(cutter);
    cut.updateMatrixWorld();
    const result = evaluator.evaluate(brush, cut, SUBTRACTION);
    if (result?.geometry?.attributes?.position?.count) brush = result;
  }
  const g = brush.geometry as THREE.BufferGeometry;
  g.computeVertexNormals();
  return g;
}

/** A fingerprint of everything that decides a roof's dormer openings. */
export function dormerFingerprint(roof: Shape | undefined): string {
  if (!roof) return '';
  const list = dormersOf(roof);
  if (!list.length) return '';
  const rd = roof.roofData ?? {};
  return JSON.stringify([list, roof.position, rd.ridgeHeight, rd.eaveOverhang, rd.pitchAngleDeg, (roof.geometryData?.positions as number[] | undefined)?.length]);
}
