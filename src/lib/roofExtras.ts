import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../types';
import { RoofSurface, eavePolygon, wallPolygon, roofEdges as edges, facingEdge, type Edge, type V2, type Facing } from './roofSurface';
import { dormerLayout, dormerMeshes, dormersOf, type Dormer, type DormerLayout } from './dormers';

/**
 * Roof extras: gutters and downpipes, a chimney, solar panels and dormers, built to sit on an
 * existing roof. They're separate shapes (tagged `roof-extra`, children of the roof) generated
 * from the roof's own surface: every height comes from casting down onto the roof's geometry,
 * so they follow gable, hip and L-shaped roofs alike. The settings live on the roof
 * (`roofData.extras`) and the extras are rebuilt whenever the roof changes.
 */

export type { Facing } from './roofSurface';

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
  /** Older setting: this many dormers, evenly spaced on one side (kept for designs saved with it). */
  dormers?: number;
  dormerFacing?: Facing;
  /** Each dormer, placed by clicking or by "space evenly". */
  dormerList?: Dormer[];
}

export const DEFAULT_ROOF_EXTRAS: RoofExtras = {
  gutters: false, gutterColor: '#374151',
  chimney: false, chimneyX: 0.45, chimneyZ: 0, chimneyColor: '#8a4b3a',
  solar: false, solarFacing: 'south',
  dormers: 0, dormerFacing: 'south',
};



export const isRoofExtra = (s: Shape) => Boolean(s.tags?.includes('roof-extra'));

/** The roof shape that carries the settings: the slopes / assembly, or a parapet roof. */
export function extrasOf(roof: Shape | undefined): RoofExtras {
  return { ...DEFAULT_ROOF_EXTRAS, ...((roof?.roofData?.extras as RoofExtras | undefined) ?? {}) };
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

/** The stretches of an eave left for gutter once flush dormers have broken it, as distances along it. */
export function gutterRuns(e: Edge, flush: DormerLayout[]): [number, number][] {
  const gaps: [number, number][] = [];
  for (const L of flush) {
    if (Math.abs(L.edge.a[0] - e.a[0]) > 1e-6 || Math.abs(L.edge.a[1] - e.a[1]) > 1e-6) continue;
    const ts = L.footprint.slice(0, 2).map(p => (p[0] - e.a[0]) * e.u[0] + (p[1] - e.a[1]) * e.u[1]);
    gaps.push([Math.min(...ts) - 0.05, Math.max(...ts) + 0.05]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const runs: [number, number][] = [];
  let t = 0;
  for (const [g0, g1] of gaps) {
    if (g0 > t + 0.1) runs.push([t, Math.min(g0, e.length)]);
    t = Math.max(t, g1);
  }
  if (e.length > t + 0.1) runs.push([t, e.length]);
  return runs;
}

function gutters(roof: Shape, surface: RoofSurface, eaves: Edge[], flushDormers: DormerLayout[] = []) {
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
    // Profile is in (x, y) with the trough below y = 0; extrusion runs along +z. Lay it along the edge.
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(e.out[0], 0, e.out[1]),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(e.u[0], 0, e.u[1]),
    );
    // A dormer built flush with the wall below breaks the eave: the gutter stops either side of it.
    for (const [t0, t1] of gutterRuns(e, flushDormers)) {
      const g = new THREE.ExtrudeGeometry(profile, { depth: t1 - t0, bevelEnabled: false, curveSegments: 8 });
      g.applyMatrix4(basis);
      g.translate(e.a[0] + e.u[0] * t0 + e.out[0] * 0.07, y + 0.065, e.a[1] + e.u[1] * t0 + e.out[1] * 0.07);
      parts.push(g);
      length += t1 - t0;
    }
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
    const layouts = flat ? [] : dormersOf(roof).map(d => dormerLayout(roof, d, surface, false)).filter((l): l is DormerLayout => !!l);
    if (extras.gutters && !flat) {
      const g = gutters(roof, surface, eaves, layouts.filter(l => l.dormer.flush));
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
    if (layouts.length) {
      const all = layouts.map(dormerMeshes);
      const pick = (k: keyof ReturnType<typeof dormerMeshes>) => merge(all.flatMap(m => m[k]));
      const types = [...new Set(layouts.map(l => l.dormer.type))].join(', ');
      out.push(toShape(roof, 'dormer-walls', `Dormers (${layouts.length}, ${types})`, pick('walls'), { color: wallColor, roughness: 0.85 },
        { count: layouts.length, dormers: layouts.map(l => ({ id: l.dormer.id, type: l.dormer.type, width: l.width, flush: l.dormer.flush })) }));
      out.push(toShape(roof, 'dormer-roofs', 'Dormer roofs', pick('roofs'), { color: roof.color || '#7c2d12', roughness: 0.8 }));
      out.push(toShape(roof, 'dormer-glass', 'Dormer windows', pick('glass'), { color: '#cfe8f3', opacity: 0.35, roughness: 0.05, metalness: 0.1 }));
      out.push(toShape(roof, 'dormer-lining', 'Dormer linings & ceilings', pick('lining'), { color: '#f4f2ee', roughness: 0.95 }));
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
