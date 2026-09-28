/**
 * Roofing a whole building, storey by storey.
 *
 * Walls are grouped into storeys by the level they stand on, and each storey's outline is traced
 * round the outside of its walls (so inside walls don't matter). The top storey gets the main
 * roof. Any part of a lower storey that sticks out beyond the storey above (an extension) gets a
 * roof of its own, meeting the house wall: a lean-to by default, as steep as it can be while its
 * top stays under the windows above (no steeper than the main roof).
 */
import * as THREE from 'three';
import * as polygonClippingModule from 'polygon-clipping';
import type { Shape } from '../types';
import { buildRoofAssemblyForRoom, insetPolygon2D, type RoofParams } from './archRoofGenerator';
import { tidy, type ExtensionKind } from './extensionRoof';
import type { V2 } from './roofSurface';

// The package is CommonJS: its functions come as the default export under some bundlers.
const polygonClipping = ((polygonClippingModule as unknown as { default?: typeof polygonClippingModule }).default
  ?? polygonClippingModule) as typeof polygonClippingModule;

const LEVEL_GAP = 0.5;
/** Clearance between a lean-to's top and the sill of a window above it. */
const WINDOW_CLEARANCE = 0.15;
/** Below this, tiles don't keep water out well. */
const MIN_TILED_PITCH = 15;

export interface Storey {
  base: number;
  top: number;
  walls: Shape[];
  /** The storey's outline on its walls' centre lines (world x/z, counter-clockwise). */
  outline: V2[];
  wallThickness: number;
}

const nums = (s: Shape) => (Array.isArray(s.args) ? (s.args as number[]) : []);
const quat = (s: Shape) => (s.quaternion ? new THREE.Quaternion(...s.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0, 0, 0]))));

/** A wall's footprint rectangle, and its length and thickness. */
function wallRect(w: Shape): { rect: V2[]; thickness: number } {
  const [a0 = 3, , a2 = 0.2] = nums(w);
  const unrotatedZ = a2 > a0 && !w.quaternion && (!w.rotation || w.rotation.every(v => v === 0));
  const len = unrotatedZ ? a2 : a0, thickness = unrotatedZ ? a0 : a2;
  const d = new THREE.Vector3(unrotatedZ ? 0 : 1, 0, unrotatedZ ? 1 : 0).applyQuaternion(quat(w));
  const l = Math.hypot(d.x, d.z) || 1;
  const u: V2 = [d.x / l, d.z / l], p: V2 = [-u[1], u[0]];
  const [cx, , cz] = w.position;
  const c = (s: number, t: number): V2 => [cx + u[0] * s * len / 2 + p[0] * t * thickness / 2, cz + u[1] * s * len / 2 + p[1] * t * thickness / 2];
  return { rect: [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)], thickness };
}

const area = (p: V2[]) => p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0) / 2;
const ring = (r: number[][]): V2[] => {
  const pts = r.map(p => [p[0], p[1]] as V2);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
};
const closed = (p: V2[]) => [[...p.map(q => [q[0], q[1]]), [p[0][0], p[0][1]]]] as [number, number][][];

/** Walls grouped into storeys, each with its outline (null outline: its walls don't close a room). */
export function storeysOf(shapes: Shape[]): Storey[] {
  const walls = shapes.filter(s => s.type === 'wall' && !s.hidden);
  const base = (w: Shape) => w.position[1] - (nums(w)[1] ?? 2.8) / 2;
  const groups: { base: number; walls: Shape[] }[] = [];
  for (const w of [...walls].sort((a, b) => base(a) - base(b))) {
    const g = groups.at(-1);
    if (g && base(w) - g.base < LEVEL_GAP) g.walls.push(w);
    else groups.push({ base: base(w), walls: [w] });
  }
  const out: Storey[] = [];
  for (const g of groups) {
    const rects = g.walls.map(wallRect);
    const thickness = rects.map(r => r.thickness).sort((a, b) => a - b)[Math.floor(rects.length / 2)] ?? 0.2;
    // Round the outside of the walls, then in by half a wall to their centre lines.
    let u: ReturnType<typeof polygonClipping.union>;
    try {
      const [first, ...rest] = rects.map(r => closed(r.rect));
      u = polygonClipping.union(first, ...rest);
    } catch { continue; }
    const best = u.map(poly => ({ poly, a: Math.abs(area(ring(poly[0]))) })).sort((x, y) => y.a - x.a)[0];
    // A closed room shows as a hole inside the walls; without one the walls don't enclose anything.
    if (!best || best.poly.length < 2) continue;
    let outer = ring(best.poly[0]);
    if (area(outer) < 0) outer = outer.reverse();
    // (Straight-through corners, left where walls join end to end, are dropped.)
    const outline = tidy(insetPolygon2D(tidy(outer), thickness / 2).map(p => [p[0], p[1]] as V2));
    out.push({ base: g.base, top: Math.max(...g.walls.map(w => w.position[1] + (nums(w)[1] ?? 2.8) / 2)), walls: g.walls, outline, wallThickness: thickness });
  }
  return out;
}

export interface ExtensionPlan {
  storey: number;
  /** The extension's outline (world x/z, wall centre lines). */
  outline: V2[];
  /** Where it meets the house: a stretch of the storey above's wall centre line. */
  abut: { a: V2; b: V2 };
  houseWallThickness: number;
  top: number;
  /** Highest the roof may rise at the house wall to stay under the windows above (if there are any). */
  maxRise?: number;
}

/** The parts of each lower storey that stick out beyond the storey above, and what they meet. */
export function extensionsOf(storeys: Storey[], shapes: Shape[]): { plans: ExtensionPlan[]; notes: string[] } {
  const plans: ExtensionPlan[] = [];
  const notes: string[] = [];
  for (let k = 0; k + 1 < storeys.length; k++) {
    const lower = storeys[k], upper = storeys[k + 1];
    let diff: ReturnType<typeof polygonClipping.difference>;
    try { diff = polygonClipping.difference(closed(lower.outline), closed(upper.outline)); } catch { continue; }
    for (const poly of diff) {
      const outline = ring(poly[0]);
      if (Math.abs(area(outline)) < 2) continue;
      if (poly.length > 1) { notes.push('Part of a lower storey goes all the way round the storey above; roof it separately.'); continue; }
      // Its edges on the upper storey's outline are where it meets the house.
      const onUpper = (p: V2) => upper.outline.some((a, i) => {
        const b = upper.outline[(i + 1) % upper.outline.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t) < 0.02;
      });
      const touching = outline.map((p, i) => [p, outline[(i + 1) % outline.length]] as [V2, V2])
        .filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.3 && onUpper(p) && onUpper(q) && onUpper([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]));
      if (!touching.length) continue;
      // One straight stretch of wall (the usual case); an extension wrapping a corner gets a flat roof.
      const [p0, q0] = touching[0];
      const len = Math.hypot(q0[0] - p0[0], q0[1] - p0[1]);
      const u: V2 = [(q0[0] - p0[0]) / len, (q0[1] - p0[1]) / len];
      const along = (p: V2) => (p[0] - p0[0]) * u[0] + (p[1] - p0[1]) * u[1];
      const straight = touching.every(([p, q]) => [p, q].every(r => Math.abs((r[0] - p0[0]) * u[1] - (r[1] - p0[1]) * u[0]) < 0.02));
      if (!straight) {
        plans.push({ storey: k, outline, abut: { a: p0, b: q0 }, houseWallThickness: upper.wallThickness, top: lower.top, maxRise: -1 });
        continue;
      }
      const ts = touching.flatMap(([p, q]) => [along(p), along(q)]);
      const a: V2 = [p0[0] + u[0] * Math.min(...ts), p0[1] + u[1] * Math.min(...ts)];
      const b: V2 = [p0[0] + u[0] * Math.max(...ts), p0[1] + u[1] * Math.max(...ts)];
      plans.push({ storey: k, outline, abut: { a, b }, houseWallThickness: upper.wallThickness, top: lower.top, maxRise: windowLimit(shapes, upper, a, b, lower.top) });
    }
  }
  return { plans, notes };
}

/** How high a roof meeting this stretch of wall may rise before it reaches the windows in it. */
function windowLimit(shapes: Shape[], upper: Storey, a: V2, b: V2, roofBase: number): number | undefined {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const ids = new Set(upper.walls.map(w => w.id));
  let sill = Infinity;
  for (const s of shapes) {
    if ((s.type !== 'window' && s.type !== 'door') || !s.hostWallId || !ids.has(s.hostWallId)) continue;
    const off = Math.abs((s.position[0] - a[0]) * u[1] - (s.position[2] - a[1]) * u[0]);
    const t = (s.position[0] - a[0]) * u[0] + (s.position[2] - a[1]) * u[1];
    const w = nums(s)[0] ?? 1;
    if (off > upper.wallThickness + 0.2 || t < -w / 2 || t > len + w / 2) continue;
    sill = Math.min(sill, s.position[1] - (nums(s)[1] ?? 1.2) / 2);
  }
  return Number.isFinite(sill) ? sill - WINDOW_CLEARANCE - roofBase : undefined;
}

/** Where an extension roof sits, saved on it (roofData.extensionSite) so it can be rebuilt as another kind. */
export type ExtensionSite = ExtensionPlan & { mainPitch: number; tiles?: Record<string, unknown> };

/** The roof over one extension, of the kind asked for (flat where a pitched one can't fit). */
export function extensionRoof(plan: ExtensionPlan, kind: ExtensionKind | 'flat', params: RoofParams, mainPitch: number, shapes: Shape[] = []): { shapes: Shape[]; notes: string[] } | null {
  const notes: string[] = [];
  const wraps = plan.maxRise === -1;
  const rise = wraps ? undefined : plan.maxRise;
  if (wraps && kind !== 'flat') notes.push('An extension wraps round a corner of the house, so it has a flat roof.');
  const tooLow = kind !== 'flat' && rise !== undefined && rise < 0.3;
  if (tooLow) notes.push('An extension meets the house too close under its windows for a pitched roof, so it has a flat roof.');
  const flat = kind === 'flat' || wraps || tooLow;
  const a = buildRoofAssemblyForRoom([], {
    ...params,
    roofType: flat ? 'parapet' : 'gable',
    pitchAngleDeg: flat ? 0 : mainPitch,
    usePitchAngle: !flat,
    eaveOverhang: flat ? 0 : params.eaveOverhang,
    footprint: { polygon: plan.outline, topY: plan.top, wallThickness: plan.houseWallThickness },
    ...(flat ? {} : { extension: { kind: kind as ExtensionKind, abut: plan.abut, houseWallThickness: plan.houseWallThickness, ...(rise !== undefined ? { maxRise: rise } : {}) } }),
  }, shapes);
  if (!a) return null;
  // (Tile settings kept with it, so a flat roof switched back to pitched gets its tiles again.)
  const tiles = params.tileShape && params.tileShape !== 'none'
    ? { shape: params.tileShape, size: params.tileSize, color: params.tileColor, randomizeColor: params.randomizeColor, colorPalette: params.colorPalette, seed: params.seed }
    : (plan as ExtensionSite).tiles;
  const site: ExtensionSite = { ...plan, mainPitch, ...(tiles ? { tiles } : {}) };
  a.roofShape.roofData = { ...a.roofShape.roofData, extensionSite: site };
  if (flat) a.roofShape.name = `Flat Extension Roof (${a.roofShape.name.replace(/^.*\(/, '').replace(/\)$/, '')})`;
  const pitch = a.roofShape.roofData?.pitchAngleDeg;
  if (!flat && typeof pitch === 'number' && pitch < MIN_TILED_PITCH) {
    notes.push(`An extension's lean-to is kept to ${pitch.toFixed(0)}° to stay under the windows above; tiles need about ${MIN_TILED_PITCH}° or more, so use a membrane, metal or low-pitch tiles there.`);
  }
  return { shapes: a.allShapes, notes };
}

/** An extension roof rebuilt as another kind (lean-to, pitched or flat), keeping its look. */
export function rebuildExtensionRoof(shapes: Shape[], roofId: string, kind: ExtensionKind | 'flat'): { shapes: Shape[]; roofId: string; notes: string[] } | null {
  const roof = shapes.find(s => s.id === roofId);
  const site = roof?.roofData?.extensionSite as ExtensionSite | undefined;
  if (!roof || !site) return null;
  const tiles = roof.roofTileData ?? shapes.find(s => s.parentShapeId === roofId && s.tags?.includes('roof-tiles'))?.roofTileData ?? site.tiles;
  const params: RoofParams = {
    roofType: 'gable',
    eaveOverhang: roof.roofData.eaveOverhang || 0.3,
    fasciaHeight: roof.roofData.fasciaHeight,
    color: roof.color,
    ...(tiles ? { tileShape: tiles.shape, tileSize: tiles.size, tileColor: tiles.color, randomizeColor: tiles.randomizeColor, colorPalette: tiles.colorPalette, seed: tiles.seed } : {}),
  };
  const r = extensionRoof(site, kind, params, site.mainPitch, shapes);
  if (!r) return null;
  const kept = shapes.filter(s => s.id !== roofId && s.parentShapeId !== roofId);
  const newRoof = r.shapes.find(s => s.tags?.includes('roof-assembly'))!;
  return { shapes: [...kept, ...r.shapes], roofId: newRoof.id, notes: r.notes };
}

export interface BuildingRoofs {
  shapes: Shape[];
  /** Plain-language notes (a lean-to kept shallow to clear windows, parts left unroofed…). */
  notes: string[];
}

/**
 * Roofs for the whole building: the main roof on the top storey (in `params`' style) and one on
 * each extension below (`extensionKind`, a lean-to unless asked otherwise). Null if no storey's
 * walls enclose a room (callers then fall back to roofing all the walls as one).
 */
export function buildRoofsForBuilding(shapes: Shape[], params: RoofParams, extensionKind: ExtensionKind | 'flat' = 'lean-to'): BuildingRoofs | null {
  const storeys = storeysOf(shapes);
  if (!storeys.length) return null;
  const top = storeys[storeys.length - 1];
  const out: Shape[] = [];
  const notes: string[] = [];
  const main = buildRoofAssemblyForRoom(top.walls, { ...params, footprint: { polygon: top.outline, topY: top.top, wallThickness: top.wallThickness } }, shapes);
  if (!main) return null;
  out.push(...main.allShapes);
  const mainPitch = main.roofShape.roofData?.pitchAngleDeg ?? params.pitchAngleDeg ?? 35;

  const { plans, notes: extNotes } = extensionsOf(storeys, shapes);
  notes.push(...extNotes);
  for (const plan of plans) {
    const r = extensionRoof(plan, extensionKind, params, mainPitch, shapes);
    if (!r) continue;
    out.push(...r.shapes);
    notes.push(...r.notes);
  }
  return { shapes: out, notes };
}

/** Anything that is part of an existing roof (what the roof buttons replace). */
export const isExistingRoofPart = (s: Shape) =>
  s.type === 'roof' ||
  !!s.tags?.some(t => t.startsWith('roof-') || t === 'roof') ||
  !!s.name?.toLowerCase().includes('roof') ||
  s.id.startsWith('roof_') ||
  s.id.startsWith('tiles_roof_');

/**
 * What the roof buttons do: roof the whole building (main roof and extension roofs), replacing
 * any roofs it had. Falls back to one roof over all the walls when they don't enclose a room.
 */
export function roofWholeBuilding(shapes: Shape[], params: RoofParams): { shapes: Shape[]; roofs: Shape[]; mainRoofId: string; notes: string[] } | null {
  const built = buildRoofsForBuilding(shapes, params);
  let made: Shape[], notes: string[] = [];
  if (built) ({ shapes: made, notes } = built);
  else {
    const walls = shapes.filter(s => s.type === 'wall');
    const a = walls.length ? buildRoofAssemblyForRoom(walls, params, shapes) : null;
    if (!a) return null;
    made = a.allShapes;
  }
  const roofs = made.filter(s => s.tags?.includes('roof-assembly'));
  const main = roofs.reduce((m, s) => (s.position[1] > m.position[1] ? s : m), roofs[0]);
  return { shapes: [...shapes.filter(s => !isExistingRoofPart(s)), ...made], roofs, mainRoofId: main.id, notes };
}

/** "and a lean-to on the extension" etc., for the roof buttons' message. */
export function describeRoofs(roofs: Shape[], notes: string[]): string {
  const ext = roofs.filter(r => r.roofData?.extension || (r.roofData?.roofType === 'parapet' && roofs.length > 1 && r !== roofs[0]));
  const parts = ext.length ? ` and ${ext.length === 1 ? 'a roof on the extension' : `roofs on ${ext.length} extensions`}` : '';
  return `${parts}.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}
