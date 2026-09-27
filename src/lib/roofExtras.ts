import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../types';

/**
 * Roof extras: gutters and downpipes, a chimney, solar panels and dormers, built to sit on an
 * existing roof. They're separate shapes (tagged `roof-extra`, children of the roof) generated
 * from the roof's own surface: every height comes from casting down onto the roof's geometry,
 * so they follow gable, hip and L-shaped roofs alike. The settings live on the roof
 * (`roofData.extras`) and the extras are rebuilt whenever the roof changes.
 */

export type Facing = 'south' | 'north' | 'east' | 'west';

export interface RoofExtras {
  gutters?: boolean;
  gutterColor?: string;
  chimney?: boolean;
  /** Chimney position across the roof, -1..1 of each half-extent (0, 0 = the middle). */
  chimneyX?: number;
  chimneyZ?: number;
  chimneyColor?: string;
  solar?: boolean;
  solarFacing?: Facing;
  dormers?: number;
  dormerFacing?: Facing;
}

export const DEFAULT_ROOF_EXTRAS: RoofExtras = {
  gutters: false, gutterColor: '#374151',
  chimney: false, chimneyX: 0.45, chimneyZ: 0, chimneyColor: '#8a4b3a',
  solar: false, solarFacing: 'south',
  dormers: 0, dormerFacing: 'south',
};

const FACING: Record<Facing, [number, number]> = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] };

type V2 = [number, number];

export const isRoofExtra = (s: Shape) => Boolean(s.tags?.includes('roof-extra'));

/** The roof shape that carries the settings: the slopes / assembly, or a parapet roof. */
export function extrasOf(roof: Shape | undefined): RoofExtras {
  return { ...DEFAULT_ROOF_EXTRAS, ...((roof?.roofData?.extras as RoofExtras | undefined) ?? {}) };
}

// --- Roof surface ---------------------------------------------------------------------------

class RoofSurface {
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

function eavePolygon(roof: Shape): V2[] {
  const rd = roof.roofData ?? {};
  if (Array.isArray(rd.localEavePoly) && rd.localEavePoly.length >= 3) return rd.localEavePoly as V2[];
  const [w = 8, , d = 8] = Array.isArray(roof.args) ? roof.args as number[] : [];
  const o = rd.eaveOverhang ?? 0.3;
  return [[-w / 2 - o, -d / 2 - o], [w / 2 + o, -d / 2 - o], [w / 2 + o, d / 2 + o], [-w / 2 - o, d / 2 + o]];
}

function wallPolygon(roof: Shape): V2[] {
  const rd = roof.roofData ?? {};
  if (Array.isArray(rd.localWallPoly) && rd.localWallPoly.length >= 3) return rd.localWallPoly as V2[];
  const [w = 8, , d = 8] = Array.isArray(roof.args) ? roof.args as number[] : [];
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
}

function signedArea(p: V2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
}

interface Edge { a: V2; b: V2; u: V2; out: V2; length: number; sloped: boolean }

/** The roof's eave edges, each with its outward direction and whether the roof rises from it (not a gable end). */
function edges(poly: V2[], surface: RoofSurface): Edge[] {
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

function facingEdge(all: Edge[], facing: Facing): Edge | null {
  const [fx, fz] = FACING[facing];
  let best: Edge | null = null, score = -Infinity;
  for (const e of all) {
    if (!e.sloped) continue;
    const s = e.out[0] * fx + e.out[1] * fz + e.length * 0.001;
    if (s > score) { score = s; best = e; }
  }
  return best;
}

const merge = (parts: THREE.BufferGeometry[]) => {
  const flat = parts.map(g => (g.index ? g.toNonIndexed() : g));
  flat.forEach(g => { g.deleteAttribute('uv'); if (!g.attributes.normal) g.computeVertexNormals(); });
  return parts.length ? BufferGeometryUtils.mergeGeometries(flat, false) : null;
};

/** A box laid in a frame: `basis` columns are its x (width), y (thickness) and z (length) directions. */
function boxAt(size: [number, number, number], centre: THREE.Vector3, basis: THREE.Matrix4) {
  const g = new THREE.BoxGeometry(...size);
  g.applyMatrix4(basis);
  g.translate(centre.x, centre.y, centre.z);
  return g;
}

// --- Builders -------------------------------------------------------------------------------

function gutters(roof: Shape, surface: RoofSurface, eaves: Edge[]) {
  const parts: THREE.BufferGeometry[] = [];
  const walls = wallPolygon(roof);
  const minY = -roof.position[1];
  let length = 0, pipes = 0;
  const corners = new Map<string, V2>();
  const profile = new THREE.Shape();
  // A half-round gutter: the outer and inner arcs of a 125 mm trough.
  profile.absarc(0, 0, 0.065, Math.PI, 0, true);
  profile.lineTo(0.057, 0);
  profile.absarc(0, 0, 0.057, 0, Math.PI, true);
  profile.lineTo(-0.065, 0);
  for (const e of eaves) {
    if (!e.sloped) continue;
    const edgeY = surface.at((e.a[0] + e.b[0]) / 2 - e.out[0] * 0.05, (e.a[1] + e.b[1]) / 2 - e.out[1] * 0.05)?.y;
    if (edgeY === undefined) continue;
    const y = edgeY - 0.14;
    const g = new THREE.ExtrudeGeometry(profile, { depth: e.length, bevelEnabled: false, curveSegments: 8 });
    // Profile is in (x, y) with the trough below y = 0; extrusion runs along +z. Lay it along the edge.
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(e.out[0], 0, e.out[1]),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(e.u[0], 0, e.u[1]),
    );
    g.applyMatrix4(basis);
    g.translate(e.a[0] + e.out[0] * 0.07, y + 0.065, e.a[1] + e.out[1] * 0.07);
    parts.push(g);
    length += e.length;
    for (const p of [e.a, e.b]) corners.set(`${p[0].toFixed(2)},${p[1].toFixed(2)}`, p);
    // Downpipes run from the gutter's ends, down the nearest wall corner.
    for (const p of [e.a, e.b]) {
      let wall = walls[0], best = Infinity;
      for (const w of walls) { const d = Math.hypot(w[0] - p[0], w[1] - p[1]); if (d < best) { best = d; wall = w; } }
      const key = `pipe:${wall[0].toFixed(2)},${wall[1].toFixed(2)}`;
      if (corners.has(key)) continue;
      corners.set(key, wall);
      const px = wall[0] + e.out[0] * 0.08, pz = wall[1] + e.out[1] * 0.08;
      const pipe = new THREE.CylinderGeometry(0.035, 0.035, y - minY, 12);
      pipe.translate(px, (y + minY) / 2, pz);
      parts.push(pipe);
      // The swan neck: from the gutter end back to the wall.
      const gx = p[0] + e.out[0] * 0.07, gz = p[1] + e.out[1] * 0.07;
      const run = Math.hypot(gx - px, gz - pz);
      if (run > 0.02) {
        const neck = new THREE.CylinderGeometry(0.035, 0.035, run, 10);
        neck.rotateZ(Math.PI / 2);
        neck.rotateY(-Math.atan2(gz - pz, gx - px));
        neck.translate((gx + px) / 2, y, (gz + pz) / 2);
        parts.push(neck);
      }
      pipes++;
    }
  }
  return { geometry: merge(parts), length, pipes };
}

function chimney(roof: Shape, surface: RoofSurface, x: number, z: number) {
  const walls = wallPolygon(roof);
  const xs = walls.map(p => p[0]), zs = walls.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 + x * (Math.max(...xs) - Math.min(...xs)) / 2 * 0.8;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2 + z * (Math.max(...zs) - Math.min(...zs)) / 2 * 0.8;
  const w = 0.62, d = 0.62;
  let top = 0;
  for (const [ox, oz] of [[-w, -d], [w, -d], [w, d], [-w, d], [0, 0]]) {
    const s = surface.at(cx + ox / 2, cz + oz / 2);
    if (s) top = Math.max(top, s.y);
  }
  top += 0.9;
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(w, top, d).translate(cx, top / 2, cz),
    new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.1).translate(cx, top + 0.04, cz),
  ];
  for (const ox of [-0.13, 0.13]) parts.push(new THREE.CylinderGeometry(0.075, 0.09, 0.32, 14).translate(cx + ox, top + 0.24, cz));
  return merge(parts);
}

function solarPanels(roof: Shape, surface: RoofSurface, edge: Edge | null, flat: boolean) {
  const parts: THREE.BufferGeometry[] = [];
  const W = 1.02, L = 1.72, gap = 0.03;
  const place = (centre: THREE.Vector3, normal: THREE.Vector3, along: THREE.Vector3) => {
    const up = normal.clone().normalize();
    const x = along.clone().sub(up.clone().multiplyScalar(along.dot(up))).normalize();
    const zAxis = new THREE.Vector3().crossVectors(x, up).normalize();
    const basis = new THREE.Matrix4().makeBasis(x, up, zAxis);
    parts.push(boxAt([W, 0.04, L], centre.clone().addScaledVector(up, 0.09), basis));
  };
  if (flat) {
    // A flat roof: rows facing south, just clear of the parapet.
    const walls = wallPolygon(roof);
    const xs = walls.map(p => p[0]), zs = walls.map(p => p[1]);
    const tilt = new THREE.Vector3(0, Math.cos(0.26), Math.sin(0.26));
    for (let z = Math.min(...zs) + 1.2; z + L / 2 < Math.max(...zs) - 0.8; z += L + 0.8) {
      for (let x = Math.min(...xs) + 1 + W / 2; x + W / 2 < Math.max(...xs) - 0.8; x += W + gap) {
        if (parts.length >= 40) break;
        place(new THREE.Vector3(x, 0.35, z), tilt, new THREE.Vector3(1, 0, 0));
      }
    }
    return { geometry: merge(parts), count: parts.length };
  }
  if (!edge) return { geometry: null, count: 0 };
  const along = new THREE.Vector3(edge.u[0], 0, edge.u[1]);
  const inward: V2 = [-edge.out[0], -edge.out[1]];
  const eaveY = surface.at(edge.a[0] + inward[0] * 0.2, edge.a[1] + inward[1] * 0.2);
  const first = surface.at((edge.a[0] + edge.b[0]) / 2 + inward[0] * 0.8, (edge.a[1] + edge.b[1]) / 2 + inward[1] * 0.8);
  if (!first || !eaveY) return { geometry: null, count: 0 };
  const cos = Math.max(0.3, first.normal.y);
  const rowRun = L * cos + gap;
  const fits = (p: V2) => {
    const s = surface.at(p[0], p[1]);
    if (!s) return null;
    const flatN = Math.hypot(s.normal.x, s.normal.z) || 1;
    // Same slope plane: faces the chosen way.
    return (s.normal.x * edge.out[0] + s.normal.z * edge.out[1]) / flatN > 0.95 ? s : null;
  };
  for (let run = 0.9 + rowRun / 2; run < 30; run += rowRun) {
    let placedRow = false;
    for (let t = 0.5 + W / 2; t + W / 2 <= edge.length - 0.5; t += W + gap) {
      if (parts.length >= 40) break;
      const c: V2 = [edge.a[0] + edge.u[0] * t + inward[0] * run, edge.a[1] + edge.u[1] * t + inward[1] * run];
      const half = L * cos / 2 + 0.25, side = W / 2 + 0.15;
      const probes: V2[] = [c, ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sr]) =>
        [c[0] + edge.u[0] * side * su + inward[0] * half * sr, c[1] + edge.u[1] * side * su + inward[1] * half * sr] as V2)];
      const hits = probes.map(fits);
      if (hits.some(h => !h)) continue;
      place(new THREE.Vector3(c[0], hits[0]!.y, c[1]), hits[0]!.normal, along);
      placedRow = true;
    }
    if (!placedRow && run > 2) break;
  }
  return { geometry: merge(parts), count: parts.length };
}

function dormers(roof: Shape, surface: RoofSurface, edge: Edge | null, count: number) {
  if (!edge || count < 1) return null;
  const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const inward: V2 = [-edge.out[0], -edge.out[1]];
  const overhang = roof.roofData?.eaveOverhang ?? 0.3;
  const w = 1.5, hf = 1.25, pitch = THREE.MathUtils.degToRad(40), t = 0.1;
  let made = 0;
  for (let k = 0; k < count; k++) {
    const along = edge.length * (k + 1) / (count + 1);
    const run = overhang + 0.7;
    const px = edge.a[0] + edge.u[0] * along + inward[0] * run;
    const pz = edge.a[1] + edge.u[1] * along + inward[1] * run;
    const base = surface.at(px, pz);
    if (!base) continue;
    const slope = Math.atan2(Math.hypot(base.normal.x, base.normal.z), base.normal.y);
    if (slope < 0.15) continue;
    // Deep enough for the dormer's eaves to meet the main roof behind it.
    const depth = hf / Math.tan(slope) + 0.25;
    // Dormer frame: x across (along the eave), y up, z into the roof.
    const X = new THREE.Vector3(edge.u[0], 0, edge.u[1]);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(inward[0], 0, inward[1]);
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
    const origin = new THREE.Vector3(px, base.y, pz);
    const toRoof = (g: THREE.BufferGeometry) => { g.applyMatrix4(basis); g.translate(origin.x, origin.y, origin.z); return g; };
    // Front wall round a window.
    const win = { w: w - 0.5, h: hf - 0.45, sill: 0.2 };
    walls.push(toRoof(new THREE.BoxGeometry(w, win.sill, t).translate(0, win.sill / 2, t / 2)));
    walls.push(toRoof(new THREE.BoxGeometry(w, hf - win.sill - win.h, t).translate(0, win.sill + win.h + (hf - win.sill - win.h) / 2, t / 2)));
    for (const sx of [-1, 1]) walls.push(toRoof(new THREE.BoxGeometry((w - win.w) / 2, win.h, t).translate(sx * (w + win.w) / 4, win.sill + win.h / 2, t / 2)));
    glass.push(toRoof(new THREE.BoxGeometry(win.w, win.h, 0.02).translate(0, win.sill + win.h / 2, t / 2)));
    // Gable over the front.
    const gableH = (w / 2) * Math.tan(pitch);
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, gableH)]);
    walls.push(toRoof(new THREE.ExtrudeGeometry(tri, { depth: t, bevelEnabled: false }).translate(0, hf, 0)));
    // Cheeks: triangles from the front down to where they meet the roof.
    const cheek = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, hf), new THREE.Vector2(depth, hf)]);
    for (const sx of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(cheek, { depth: 0.08, bevelEnabled: false });
      // Shape is in (x, y) = (depth, height); turn it so x runs into the roof (z).
      g.rotateY(-Math.PI / 2);
      // After the turn the extrusion runs from x = -0.08 to 0: keep both cheeks inside the dormer's width.
      g.translate(sx > 0 ? w / 2 : -w / 2 + 0.08, 0, 0);
      walls.push(toRoof(g));
    }
    // The dormer's own gable roof.
    const slopeLen = (w / 2 + 0.15) / Math.cos(pitch);
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(slopeLen, 0.07, depth + 0.25);
      g.rotateZ(sx * -pitch);
      g.translate(sx * (w / 4 + 0.075) * 1, hf + gableH / 2 + 0.03, depth / 2 - 0.12);
      roofs.push(toRoof(g));
    }
    made++;
  }
  if (!made) return null;
  return { walls: merge(walls), roofs: merge(roofs), glass: merge(glass), count: made };
}

// --- Assembly -------------------------------------------------------------------------------

function toShape(roof: Shape, kind: string, name: string, geometry: THREE.BufferGeometry | null | undefined, look: Partial<Shape>, data: Record<string, unknown> = {}): Shape | null {
  if (!geometry || !geometry.attributes.position?.count) return null;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return {
    id: `roofx_${kind}_${roof.id}`,
    name,
    type: 'custom',
    position: [...roof.position] as [number, number, number],
    rotation: [0, 0, 0],
    args: [1, 1, 1],
    color: '#cccccc',
    roughness: 0.7,
    metalness: 0.05,
    ...look,
    tags: ['architecture', 'roof-part', 'roof-extra', `roof-extra-${kind}`, ...(roof.tags?.filter(t => /^story-\d+$/.test(t)) ?? [])],
    parentShapeId: roof.id,
    geometryData: {
      positions: Array.from(g.attributes.position.array as Float32Array),
      normals: Array.from(g.attributes.normal.array as Float32Array),
    },
    customData: { roofExtra: kind, ...data },
  };
}

/** The extra shapes for a roof, from its settings. */
export function buildRoofExtras(roof: Shape, extras: RoofExtras, wallColor = '#e7e5e4'): Shape[] {
  const surface = new RoofSurface(roof);
  const flat = (roof.roofData?.roofType ?? roof.customData?.roofType) === 'parapet';
  const eaves = edges(eavePolygon(roof), surface);
  const out: (Shape | null)[] = [];
  try {
    if (extras.gutters && !flat) {
      const g = gutters(roof, surface, eaves);
      out.push(toShape(roof, 'gutters', `Gutters & downpipes (${g.length.toFixed(1)} m)`, g.geometry,
        { color: extras.gutterColor ?? '#374151', roughness: 0.5, metalness: 0.3 }, { length: +g.length.toFixed(2), downpipes: g.pipes }));
    }
    if (extras.chimney) {
      out.push(toShape(roof, 'chimney', 'Chimney', chimney(roof, surface, extras.chimneyX ?? 0.45, extras.chimneyZ ?? 0),
        { color: extras.chimneyColor ?? '#8a4b3a', roughness: 0.9 }, { count: 1 }));
    }
    if (extras.solar) {
      const s = solarPanels(roof, surface, flat ? null : facingEdge(eaves, extras.solarFacing ?? 'south'), flat);
      out.push(toShape(roof, 'solar', `Solar panels (${s.count})`, s.geometry,
        { color: '#1b2a41', roughness: 0.25, metalness: 0.55 }, { count: s.count }));
    }
    if ((extras.dormers ?? 0) > 0 && !flat) {
      const d = dormers(roof, surface, facingEdge(eaves, extras.dormerFacing ?? 'south'), Math.min(3, extras.dormers ?? 0));
      if (d) {
        out.push(toShape(roof, 'dormer-walls', `Dormers (${d.count})`, d.walls, { color: wallColor, roughness: 0.85 }, { count: d.count }));
        out.push(toShape(roof, 'dormer-roofs', 'Dormer roofs', d.roofs, { color: roof.color || '#7c2d12', roughness: 0.8 }));
        out.push(toShape(roof, 'dormer-glass', 'Dormer windows', d.glass, { color: '#cfe8f3', opacity: 0.35, roughness: 0.05, metalness: 0.1 }));
      }
    }
  } finally {
    surface.dispose();
  }
  return out.filter((s): s is Shape => !!s);
}

/** `shapes` with the roof's extras rebuilt from `extras` (saved on the roof). */
export function withRoofExtras(shapes: Shape[], roofId: string, extras: RoofExtras): Shape[] {
  const roof = shapes.find(s => s.id === roofId);
  if (!roof) return shapes;
  const wallColor = shapes.find(s => s.type === 'wall')?.color;
  const savedRoof: Shape = { ...roof, roofData: { ...(roof.roofData ?? {}), extras } };
  const kept = shapes.filter(s => !(isRoofExtra(s) && s.parentShapeId === roofId)).map(s => (s.id === roofId ? savedRoof : s));
  return [...kept, ...buildRoofExtras(savedRoof, extras, wallColor && !wallColor.startsWith('http') ? wallColor : undefined)];
}

/** After the roof itself changes: rebuild its extras, if it has any. */
export function refreshRoofExtras(shapes: Shape[], roofId: string): Shape[] {
  const roof = shapes.find(s => s.id === roofId);
  const extras = roof?.roofData?.extras as RoofExtras | undefined;
  if (!roof || !extras) return shapes;
  return withRoofExtras(shapes, roofId, extras);
}
