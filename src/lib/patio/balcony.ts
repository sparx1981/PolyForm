import * as THREE from 'three';
import type { Shape } from '../../types';
import type { Vec2 } from './patioGeometry';
import { railingHeight } from './patioGeometry';
import { DEFAULT_BALCONY, type BalconyData, type PatioData } from './patioTypes';

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
  /** Unit vector from the wall out over the balcony. */
  outward: Vec2;
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
