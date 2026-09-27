import * as THREE from 'three';
import type { Shape } from '../../types';
import type { Vec2 } from './patioGeometry';
import { railingHeight } from './patioGeometry';
import { DEFAULT_BALCONY, type BalconyData, type BalconyFront, type PatioData } from './patioTypes';

/**
 * Balconies: where one goes when placed at a door, the UK guarding checks, and keeping it on
 * its wall when the wall moves (or removing it with the wall).
 */

/** UK homes (Approved Document K): balcony guarding at least 1100 mm high, gaps under 100 mm. */
export const UK_BALCONY_GUARDING = 1.1;

/** A balcony's floor sits this far below the sill of the door it serves (a weather step). */
export const BALCONY_STEP_DOWN = 0.05;

/** How deep a Juliet balcony's guarding stands out from the wall face. */
export const JULIET_DEPTH = 0.12;

export interface BalconyPlacement {
  /** Outline in world x/z; edge 0 (point 0 to point 1) runs along the wall face. */
  world: Vec2[];
  wallEdges: boolean[];
  /** Floor level (world y); for a Juliet, the foot of the guarding. */
  level: number;
  wallId: string;
  openingId: string;
  /** Unit vector from the wall out over the balcony (at the opening). */
  outward: Vec2;
  /** The front (guarding) edge, end to end. */
  front: Vec2[];
  /** Placed along a curved wall: the back edge follows the wall's face. */
  curved: boolean;
}

function wallFrame(wall: Shape) {
  const q = new THREE.Quaternion(...(wall.quaternion ?? [0, 0, 0, 1]));
  if (!wall.quaternion && wall.rotation) q.setFromEuler(new THREE.Euler(...wall.rotation));
  const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const d: Vec2 = [dir.x, dir.z], nrm: Vec2 = [normal.x, normal.z];
  const dl = Math.hypot(d[0], d[1]) || 1, nl = Math.hypot(nrm[0], nrm[1]) || 1;
  return { dir: [d[0] / dl, d[1] / dl] as Vec2, normal: [nrm[0] / nl, nrm[1] / nl] as Vec2 };
}

/**
 * The balcony for a door or window in a wall, on the given side of it (+1 = the wall's +z
 * face). It is as wide as the opening plus `margin` each side (kept within the wall), `depth`
 * deep, and its floor sits just below the door's sill. A window's balcony takes the storey
 * floor instead (a window sill is well above it), except a Juliet, which guards the opening.
 */
export function balconyAtOpening(opening: Shape, wall: Shape, side: 1 | -1, opts: { depth: number; margin: number; juliet: boolean }): BalconyPlacement | null {
  if (!Array.isArray(wall.args) || !Array.isArray(opening.args)) return null;
  const [wallLength = 0, wallHeight = 0, thickness = 0.2] = wall.args as number[];
  const [openWidth = 0.9, openHeight = 2.1] = opening.args as number[];
  if (wallLength < 0.3) return null;
  const { dir, normal } = wallFrame(wall);
  const out: Vec2 = [normal[0] * side, normal[1] * side];
  const [wx, , wz] = wall.position;
  const along = (opening.position[0] - wx) * dir[0] + (opening.position[2] - wz) * dir[1];
  const margin = opts.juliet ? 0.05 : opts.margin;
  let from = along - openWidth / 2 - margin, to = along + openWidth / 2 + margin;
  // Stay on the wall (but always at least as wide as the opening).
  from = Math.max(from, Math.min(-wallLength / 2, along - openWidth / 2));
  to = Math.min(to, Math.max(wallLength / 2, along + openWidth / 2));
  const depth = opts.juliet ? JULIET_DEPTH : Math.max(0.4, opts.depth);
  // Tucked 10 mm into the wall so no gap shows at the face.
  const face = thickness / 2 - 0.01;
  const at = (s: number, d: number): Vec2 => [wx + dir[0] * s + out[0] * (face + d), wz + dir[1] * s + out[1] * (face + d)];
  const sill = opening.position[1] - openHeight / 2;
  const storeyFloor = wall.position[1] - wallHeight / 2;
  const level = opts.juliet ? sill : (opening.type === 'door' ? sill : storeyFloor) - BALCONY_STEP_DOWN;
  return {
    world: [at(from, 0), at(to, 0), at(to, depth), at(from, depth)],
    wallEdges: [true, false, false, false],
    level,
    wallId: wall.id,
    openingId: opening.id,
    outward: out,
    front: [at(to, depth), at(from, depth)],
    curved: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Curved walls
// ---------------------------------------------------------------------------------------------

/** Pieces of a curved wall meet at under this angle (a sharper turn is a building corner). */
const CHAIN_TURN = (30 * Math.PI) / 180;

const wallArgs = (w: Shape) => (Array.isArray(w.args) ? (w.args as number[]) : []);

function wallEnds(w: Shape): [Vec2, Vec2] {
  const { dir } = wallFrame(w);
  const half = (wallArgs(w)[0] ?? 0) / 2;
  return [[w.position[0] - dir[0] * half, w.position[2] - dir[1] * half], [w.position[0] + dir[0] * half, w.position[2] + dir[1] * half]];
}

/** A wall's face on the given side, as a segment in world x/z from its start end to its end end. */
function wallFace(w: Shape, side: 1 | -1): [Vec2, Vec2] {
  const { dir, normal } = wallFrame(w);
  const [length = 0, , thickness = 0.2] = wallArgs(w);
  const world = ([x, z]: [number, number]): Vec2 => [w.position[0] + dir[0] * x + normal[0] * z, w.position[2] + dir[1] * x + normal[1] * z];
  const fp = w.wallMiterFootprint;
  if (fp) {
    // Mitred pieces (e.g. from Convert To Wall) meet exactly at their outer corners.
    for (const [p, q] of [[fp[0], fp[3]], [fp[1], fp[2]]] as [[number, number], [number, number]][]) {
      if (Math.sign((p[1] + q[1]) / 2 || 1) === side) return p[0] <= q[0] ? [world(p), world(q)] : [world(q), world(p)];
    }
  }
  return [world([-length / 2, side * thickness / 2]), world([length / 2, side * thickness / 2])];
}

interface ChainPiece { wall: Shape; side: 1 | -1 }

/**
 * The pieces of wall that carry on from `host` in a gentle curve (same storey and thickness,
 * ends meeting, each turning less than 30 degrees), in order along the wall, with the side of
 * each that faces the same way as the host's `side`.
 */
export function wallChain(host: Shape, side: 1 | -1, shapes: Shape[]): ChainPiece[] {
  const [, hostHeight = 0, hostThickness = 0.2] = wallArgs(host);
  const hostBase = host.position[1] - hostHeight / 2;
  const candidates = shapes.filter(w => w.type === 'wall' && !w.hidden && w.id !== host.id && wallArgs(w).length >= 3
    && Math.abs(w.position[1] - (wallArgs(w)[1] ?? 0) / 2 - hostBase) < 0.05
    && Math.abs((wallArgs(w)[2] ?? 0) - hostThickness) < 0.05);
  const used = new Set([host.id]);
  const walk = (from: ChainPiece, end: 0 | 1): ChainPiece[] => {
    const pieces: ChainPiece[] = [];
    let current = from, at = wallEnds(from.wall)[end];
    for (let guard = 0; guard < 60; guard++) {
      const reach = Math.max(0.05, hostThickness * 0.75);
      let best: { wall: Shape; far: Vec2; d: number } | null = null;
      for (const w of candidates) {
        if (used.has(w.id)) continue;
        const [a, b] = wallEnds(w);
        const da = Math.hypot(a[0] - at[0], a[1] - at[1]), db = Math.hypot(b[0] - at[0], b[1] - at[1]);
        const d = Math.min(da, db);
        if (d > reach || (best && d >= best.d)) continue;
        const cd = wallFrame(current.wall).dir, wd = wallFrame(w).dir;
        if (Math.abs(cd[0] * wd[0] + cd[1] * wd[1]) < Math.cos(CHAIN_TURN)) continue;
        best = { wall: w, far: da < db ? b : a, d };
      }
      if (!best) break;
      // The same face as the piece before it (their normals point the same way round).
      const cn = wallFrame(current.wall).normal, wn = wallFrame(best.wall).normal;
      const piece: ChainPiece = { wall: best.wall, side: ((cn[0] * wn[0] + cn[1] * wn[1]) * current.side >= 0 ? 1 : -1) as 1 | -1 };
      used.add(best.wall.id);
      pieces.push(piece);
      current = piece;
      at = best.far;
    }
    return pieces;
  };
  const hostPiece: ChainPiece = { wall: host, side };
  const before = walk(hostPiece, 0).reverse();
  const after = walk(hostPiece, 1);
  return [...before, hostPiece, ...after];
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len2 = (a: Vec2) => Math.hypot(a[0], a[1]);

/** The chain's face (on its outward side) as one polyline along the wall, host direction first. */
function chainFace(chain: ChainPiece[], hostIndex: number): Vec2[] {
  const hostFace = wallFace(chain[hostIndex].wall, chain[hostIndex].side);
  const line: Vec2[] = [hostFace[0], hostFace[1]];
  const join = 0.03;
  for (let i = hostIndex + 1; i < chain.length; i++) {
    let [a, b] = wallFace(chain[i].wall, chain[i].side);
    const end = line[line.length - 1];
    if (len2(sub(b, end)) < len2(sub(a, end))) [a, b] = [b, a];
    if (len2(sub(a, end)) > join) line.push(a);
    line.push(b);
  }
  for (let i = hostIndex - 1; i >= 0; i--) {
    let [a, b] = wallFace(chain[i].wall, chain[i].side);
    const start = line[0];
    if (len2(sub(a, start)) < len2(sub(b, start))) [a, b] = [b, a];
    if (len2(sub(b, start)) > join) line.unshift(b);
    line.unshift(a);
  }
  return line;
}

/** Points of a polyline from arc length s0 to s1. */
function slice(line: Vec2[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = [];
  let s = 0;
  const at = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], l = len2(sub(b, a));
    const e = s + l;
    if (e >= s0 && s <= s1 && l > 1e-9) {
      if (!out.length) out.push(at(a, b, Math.max(0, (s0 - s) / l)));
      if (e < s1) out.push(b);
      else { out.push(at(a, b, Math.min(1, (s1 - s) / l))); break; }
    }
    s = e;
  }
  return out;
}

/**
 * A balcony along a curved wall: its back edge follows the wall's face either side of the
 * opening, and its front either follows the same curve `depth` out, or runs straight across
 * at least `depth` from the wall everywhere. Null when the wall is straight where the balcony
 * would go (the plain rectangle is used then).
 */
export function curvedBalcony(opening: Shape, wall: Shape, side: 1 | -1, shapes: Shape[], opts: { depth: number; margin: number; front: BalconyFront }): BalconyPlacement | null {
  const chain = wallChain(wall, side, shapes);
  if (chain.length < 2) return null;
  const hostIndex = chain.findIndex(p => p.wall.id === wall.id);
  let line = chainFace(chain, hostIndex);
  // Outward normals: the host's side, and the same hand for every segment along the line.
  const { normal } = wallFrame(wall);
  const out: Vec2 = [normal[0] * side, normal[1] * side];
  const hostFace = wallFace(wall, side);
  const hostDir = sub(hostFace[1], hostFace[0]);
  const hand = (-hostDir[1] * out[0] + hostDir[0] * out[1]) >= 0 ? 1 : -1;
  const segNormal = (a: Vec2, b: Vec2): Vec2 => { const d = sub(b, a), l = len2(d) || 1; return [(-d[1] / l) * hand, (d[0] / l) * hand]; };
  const vertexNormal = (pts: Vec2[], j: number): { n: Vec2; scale: number } => {
    const prev = j > 0 ? segNormal(pts[j - 1], pts[j]) : null, next = j + 1 < pts.length ? segNormal(pts[j], pts[j + 1]) : null;
    if (!prev || !next) { const n = (prev ?? next)!; return { n, scale: 1 }; }
    const m: Vec2 = [prev[0] + next[0], prev[1] + next[1]], ml = len2(m) || 1;
    const n: Vec2 = [m[0] / ml, m[1] / ml];
    return { n, scale: 1 / Math.max(0.3, n[0] * next[0] + n[1] * next[1]) };
  };
  // Tucked 10 mm into the wall.
  line = line.map((p, j) => { const { n, scale } = vertexNormal(line, j); return [p[0] - n[0] * 0.01 * scale, p[1] - n[1] * 0.01 * scale]; });

  // Where the opening is along the line, and the stretch the balcony covers.
  const [openWidth = 0.9] = wallArgs(opening);
  const o: Vec2 = [opening.position[0], opening.position[2]];
  let s = 0, s0 = 0, best = Infinity;
  const total = line.slice(1).reduce((sum, p, i) => sum + len2(sub(p, line[i])), 0);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], d = sub(line[i + 1], a), l = len2(d);
    const t = l > 0 ? Math.max(0, Math.min(1, ((o[0] - a[0]) * d[0] + (o[1] - a[1]) * d[1]) / (l * l))) : 0;
    const dist = len2(sub(o, [a[0] + d[0] * t, a[1] + d[1] * t]));
    if (dist < best) { best = dist; s0 = s + t * l; }
    s += l;
  }
  const half = openWidth / 2 + opts.margin;
  const back = slice(line, Math.max(0, s0 - half), Math.min(total, s0 + half));
  if (back.length < 2) return null;
  // Straight where it goes: a plain rectangle does.
  let bends = false;
  for (let j = 1; j + 1 < back.length; j++) {
    const a = segNormal(back[j - 1], back[j]), b = segNormal(back[j], back[j + 1]);
    if (a[0] * b[0] + a[1] * b[1] < Math.cos(0.01)) bends = true;
  }
  if (!bends) return null;

  const depth = Math.max(0.4, opts.depth);
  let front: Vec2[];
  if (opts.front === 'straight') {
    const first = back[0], last = back[back.length - 1];
    const chord = sub(last, first), cl = len2(chord) || 1;
    let v: Vec2 = [-chord[1] / cl, chord[0] / cl];
    const avg = back.slice(1).reduce((m, p, j) => { const n = segNormal(back[j], p); return [m[0] + n[0], m[1] + n[1]] as Vec2; }, [0, 0] as Vec2);
    if (v[0] * avg[0] + v[1] * avg[1] < 0) v = [-v[0], -v[1]];
    const t = back.map(p => (p[0] - first[0]) * v[0] + (p[1] - first[1]) * v[1]);
    const reach = Math.max(...t) + depth;
    front = [last, first].map((p, k) => { const tt = k === 0 ? t[t.length - 1] : t[0]; return [p[0] + v[0] * (reach - tt), p[1] + v[1] * (reach - tt)] as Vec2; });
  } else {
    front = back.map((p, j) => { const { n, scale } = vertexNormal(back, j); return [p[0] + n[0] * depth * scale, p[1] + n[1] * depth * scale] as Vec2; }).reverse();
  }
  const world = [...back, ...front];
  const wallEdges = world.map((_, i) => i < back.length - 1);
  const [, wallHeight = 0] = wallArgs(wall);
  const [, openHeight = 2.1] = wallArgs(opening);
  const sill = opening.position[1] - openHeight / 2;
  const storeyFloor = wall.position[1] - wallHeight / 2;
  return {
    world,
    wallEdges,
    level: (opening.type === 'door' ? sill : storeyFloor) - BALCONY_STEP_DOWN,
    wallId: wall.id,
    openingId: opening.id,
    outward: out,
    front,
    curved: true,
  };
}

/**
 * Where a balcony goes at an opening: along a curved wall when the wall curves there (not
 * for a Juliet, which only guards the opening), otherwise a rectangle out from the wall.
 */
export function placeBalcony(opening: Shape, wall: Shape, side: 1 | -1, shapes: Shape[], opts: { depth: number; margin: number; juliet: boolean; front: BalconyFront }): BalconyPlacement | null {
  if (!opts.juliet) {
    const curved = curvedBalcony(opening, wall, side, shapes, opts);
    if (curved) return curved;
  }
  return balconyAtOpening(opening, wall, side, opts);
}

/**
 * Rebuilds a placed balcony's outline from its door (for a new depth or front, or switching
 * to or from a Juliet), keeping its floor level unless it changes to or from a Juliet. Null
 * when its door or wall has gone (the outline is then left as it is).
 */
export function reshapeBalcony(balcony: Shape, shapes: Shape[], patch: { depth?: number; front?: BalconyFront; juliet?: boolean }): Shape | null {
  const data = balcony.patioData;
  const b = balconySettings(data ?? {});
  const opening = shapes.find(s => s.id === b.hostOpeningId);
  const wall = shapes.find(s => s.id === balcony.hostWallId);
  if (!data || !opening || !wall) return null;
  const { normal } = wallFrame(wall);
  const c = data.points.reduce((m, p) => [m[0] + p[0] / data.points.length, m[1] + p[1] / data.points.length] as Vec2, [0, 0] as Vec2);
  const centre: Vec2 = [balcony.position[0] + c[0], balcony.position[2] + c[1]];
  const side: 1 | -1 = (centre[0] - wall.position[0]) * normal[0] + (centre[1] - wall.position[2]) * normal[1] >= 0 ? 1 : -1;
  const wasJuliet = b.support === 'juliet';
  const juliet = patch.juliet ?? wasJuliet;
  const depth = patch.depth ?? b.depth ?? 1.5;
  const front = patch.front ?? b.front ?? 'curve';
  const placement = placeBalcony(opening, wall, side, shapes, { depth, margin: b.margin ?? 0.6, juliet, front });
  if (!placement) return null;
  const cx = placement.world.reduce((m, p) => m + p[0], 0) / placement.world.length;
  const cz = placement.world.reduce((m, p) => m + p[1], 0) / placement.world.length;
  return {
    ...balcony,
    position: [cx, juliet !== wasJuliet ? placement.level : balcony.position[1], cz],
    patioData: {
      ...data,
      points: placement.world.map(([x, z]) => [x - cx, z - cz] as Vec2),
      bulges: placement.world.map(() => 0),
      wallEdges: placement.wallEdges,
      balcony: { ...b, depth: juliet ? b.depth : depth, front, curvedWall: placement.curved },
    },
  };
}

/**
 * Which side of a wall is outside: the side the camera is on, unless that side is inside a
 * building and the other is not.
 */
export function outsideSide(opening: Shape, wall: Shape, camera: Vec2, insideBuilding: (p: Vec2) => boolean): 1 | -1 {
  const { normal } = wallFrame(wall);
  const [ox, , oz] = opening.position;
  const facing: 1 | -1 = (camera[0] - ox) * normal[0] + (camera[1] - oz) * normal[1] >= 0 ? 1 : -1;
  const probe = (s: number): Vec2 => [ox + normal[0] * s * 0.6, oz + normal[1] * s * 0.6];
  if (insideBuilding(probe(facing)) && !insideBuilding(probe(-facing))) return (-facing) as 1 | -1;
  return facing;
}

export function balconySettings(data: Pick<PatioData, 'balcony'>): BalconyData {
  return { ...DEFAULT_BALCONY, ...data.balcony };
}

/**
 * Guarding checks against UK guidance for homes (gentle warnings, never enforced). Spindles
 * and balusters are always spaced under 100 mm, so gaps only come up for horizontal cables.
 */
export function balconyWarnings(data: PatioData): string[] {
  if (data.kind !== 'balcony') return [];
  const warnings: string[] = [];
  const height = railingHeight(data);
  if (data.railing === 'none') {
    warnings.push('No guarding: a balcony needs guarding at least 1,100 mm high along its open edges.');
    return warnings;
  }
  if (height < UK_BALCONY_GUARDING - 1e-6) {
    warnings.push(`Guarding is ${Math.round(height * 1000)} mm high; UK homes need at least 1,100 mm on a balcony.`);
  }
  if (data.railing === 'cable') {
    warnings.push('Horizontal cables are easy to climb; UK guidance advises against them where young children may use the balcony.');
  }
  return warnings;
}

const isHostedBalcony = (s: Shape) => s.type === 'patio' && s.patioData?.kind === 'balcony' && !!s.hostWallId;

function yaw(wall: Shape): number {
  const { dir } = wallFrame(wall);
  return Math.atan2(dir[1], dir[0]);
}

function sameShape(a: Shape, b: Shape): boolean {
  if (a === b) return true;
  return a.position.every((v, i) => v === b.position[i]) && JSON.stringify(a.patioData) === JSON.stringify(b.patioData);
}

function samePlacement(a: Shape, b: Shape): boolean {
  return a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-9)
    && JSON.stringify(a.quaternion ?? a.rotation ?? null) === JSON.stringify(b.quaternion ?? b.rotation ?? null);
}

/** Moves a balcony by the move its wall made (turning with it), keeping its place on the wall. */
export function moveWithWall(balcony: Shape, before: Shape, after: Shape): Shape {
  const turn = yaw(after) - yaw(before);
  const c = Math.cos(turn), s = Math.sin(turn);
  const rotate = ([x, z]: Vec2): Vec2 => [x * c - z * s, x * s + z * c];
  let dx = after.position[0] - before.position[0], dz = after.position[2] - before.position[2];
  const stretched = Math.abs(turn) < 1e-9 && JSON.stringify(before.args) !== JSON.stringify(after.args);
  if (stretched) {
    // Lengthening a wall from one end shifts its middle along it; the openings (and so the
    // balcony) stay where they are. Only a move across the wall carries the balcony.
    const { normal } = wallFrame(after);
    const across = dx * normal[0] + dz * normal[1];
    dx = normal[0] * across; dz = normal[1] * across;
  }
  const rel = rotate([balcony.position[0] - before.position[0], balcony.position[2] - before.position[2]]);
  const data = balcony.patioData!;
  return {
    ...balcony,
    position: [
      before.position[0] + dx + rel[0],
      balcony.position[1] + (after.position[1] - before.position[1]),
      before.position[2] + dz + rel[1],
    ],
    patioData: turn === 0 ? data : { ...data, points: data.points.map(rotate) },
  };
}

/**
 * Keeps balconies on their walls: one whose wall was moved or turned by this edit moves with
 * it, and one whose wall was deleted goes too. Only a balcony the edit itself left alone
 * follows (an undo restores a wall and its balconies together, already in place).
 */
export function followHostWalls(next: Shape[], prev: Shape[]): Shape[] {
  if (!next.some(isHostedBalcony)) return next;
  const before = new Map(prev.map(s => [s.id, s]));
  const after = new Map(next.map(s => [s.id, s]));
  let changed = false;
  const out: Shape[] = [];
  for (const s of next) {
    const old = isHostedBalcony(s) ? before.get(s.id) : undefined;
    if (!old || !sameShape(old, s)) { out.push(s); continue; }
    const oldHost = before.get(s.hostWallId!), newHost = after.get(s.hostWallId!);
    if (!newHost) {
      // Its wall was replaced (e.g. pieces merged to fit the door): stay with the door's new wall.
      const opening = after.get(s.patioData!.balcony?.hostOpeningId ?? '');
      if (opening?.hostWallId && after.get(opening.hostWallId)?.type === 'wall') {
        out.push({ ...s, hostWallId: opening.hostWallId });
        changed = true;
        continue;
      }
      if (oldHost) { changed = true; continue; }
      out.push(s);
      continue;
    }
    if (!oldHost || samePlacement(oldHost, newHost)) { out.push(s); continue; }
    out.push(moveWithWall(s, oldHost, newHost));
    changed = true;
  }
  return changed ? out : next;
}
