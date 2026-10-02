import * as THREE from 'three';
import type { Shape } from '../../src/types';
import { buildingLevels } from '../../src/lib/presentation/floorPlans';
import { detectRooms } from '../../src/lib/spatial/rooms';
import { inPolygon, orientation, worldPoints } from './checks';

/**
 * Checks on whether the geometry is sound: numbers that make sense, openings that sit inside their walls
 * and clear of each other, walls that meet, furniture that rests on the floor, and walls that line up
 * from one storey to the next. Pure functions of the objects, like the layout checks.
 */

type V2 = [number, number];

export interface GeometryIssue {
  severity: 'error' | 'warning' | 'info';
  code:
    | 'invalid-geometry' | 'paper-thin' | 'opening-outside-wall' | 'openings-overlap' | 'opening-near-corner' | 'door-off-floor'
    | 'wall-gap' | 'floating-object' | 'sunk-object' | 'vertical-drift';
  message: string;
  ids: string[];
  level?: number;
}

export interface GeometryReport {
  issues: GeometryIssue[];
  errors: number;
  warnings: number;
  info: number;
  checked: string[];
  skipped: string[];
}

const nums = (s: Shape) => (Array.isArray(s.args) ? (s.args as number[]) : []);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const finite = (list: readonly unknown[] | undefined) => (list ?? []).every(n => typeof n !== 'number' || Number.isFinite(n));
/** Tolerance for "touching": a few millimetres of modelling slack. */
const TOUCH = 0.02;
/** A wall end this close to another wall (but not touching) reads as a gap that was meant to be closed. */
const GAP_LIMIT = 0.35;
const SOLID = new Set(['wall', 'box']);

function wallAxis(w: Shape): { a: V2; b: V2; thick: number; len: number } {
  const [len = 1, , thick = 0.2] = nums(w);
  const d = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation(w));
  const m = Math.hypot(d.x, d.z) || 1;
  const u: V2 = [d.x / m, d.z / m];
  return {
    a: [w.position[0] - u[0] * len / 2, w.position[2] - u[1] * len / 2],
    b: [w.position[0] + u[0] * len / 2, w.position[2] + u[1] * len / 2],
    thick, len,
  };
}

function distToSegment(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** The wall frame: where an opening sits along its host and how high. */
function inWall(opening: Shape, wall: Shape) {
  const [len = 1, height = 2.8] = nums(wall);
  const local = new THREE.Vector3(...opening.position).sub(new THREE.Vector3(...wall.position)).applyQuaternion(orientation(wall).invert());
  const [w = 0.9, h = 2.1] = nums(opening);
  return { x0: local.x - w / 2, x1: local.x + w / 2, y0: local.y - h / 2, y1: local.y + h / 2, len, height, w };
}

export function checkGeometry(shapes: Shape[]): GeometryReport {
  const issues: GeometryIssue[] = [];
  const checked: string[] = [], skipped: string[] = [];
  const visible = shapes.filter(s => !s.hidden);

  // 1. Numbers that make sense.
  checked.push('invalid or paper-thin geometry');
  for (const s of visible) {
    if (!finite(s.position) || !finite(nums(s)) || !finite(s.quaternion) || !finite(s.rotation) || !finite(s.scale)) {
      issues.push({ severity: 'error', code: 'invalid-geometry', ids: [s.id], message: `${s.name ?? s.type} (${s.id}) has a position, size or rotation that is not a number. Delete it or set it again.` });
      continue;
    }
    if (SOLID.has(s.type) && nums(s).length >= 3 && nums(s).slice(0, 3).some(n => !(n > 0.005))) {
      issues.push({ severity: 'warning', code: 'paper-thin', ids: [s.id], message: `${s.name ?? s.type} (${s.id}) has a side of ${round(Math.min(...nums(s).slice(0, 3)), 3)} m or less, so it is flat or paper-thin rather than a solid.` });
    }
  }

  // 2. Openings inside their walls and clear of each other.
  const wallById = new Map(visible.filter(s => s.type === 'wall').map(w => [w.id, w]));
  const openings = visible.filter(s => (s.type === 'door' || s.type === 'window') && s.hostWallId && wallById.has(s.hostWallId));
  if (openings.length) {
    checked.push('openings: inside the wall, clear of each other, door on the floor');
    const byWall = new Map<string, Shape[]>();
    for (const o of openings) byWall.set(o.hostWallId!, [...(byWall.get(o.hostWallId!) ?? []), o]);
    for (const [wallId, list] of byWall) {
      const wall = wallById.get(wallId)!;
      const frames = list.map(o => ({ o, f: inWall(o, wall) }));
      for (const { o, f } of frames) {
        const name = `${o.type === 'door' ? 'Door' : 'Window'} ${o.id}`;
        if (f.x0 < -f.len / 2 - TOUCH || f.x1 > f.len / 2 + TOUCH || f.y0 < -f.height / 2 - TOUCH || f.y1 > f.height / 2 + TOUCH) {
          issues.push({ severity: 'error', code: 'opening-outside-wall', ids: [o.id, wallId], message: `${name} runs outside its wall (the wall is ${round(f.len)} m long and ${round(f.height)} m high). Move it in, make it smaller, or set it in another wall.` });
        } else if (f.x0 < -f.len / 2 + 0.1 || f.x1 > f.len / 2 - 0.1) {
          issues.push({ severity: 'warning', code: 'opening-near-corner', ids: [o.id, wallId], message: `${name} is within 0.1 m of the end of its wall, where it meets the next wall. Move it along.` });
        }
        if (o.type === 'door' && f.y0 > -f.height / 2 + 0.05) {
          issues.push({ severity: 'warning', code: 'door-off-floor', ids: [o.id], message: `${name} stands ${round(f.y0 + f.height / 2)} m above the floor. Doors should reach the floor.` });
        }
      }
      for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i].f, b = frames[j].f;
        if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > TOUCH && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > TOUCH) {
          issues.push({ severity: 'error', code: 'openings-overlap', ids: [frames[i].o.id, frames[j].o.id, wallId], message: `${frames[i].o.type} ${frames[i].o.id} and ${frames[j].o.type} ${frames[j].o.id} overlap in the same wall. Move one along.` });
        }
      }
    }
  } else skipped.push('openings: none set in walls');

  // 3. Walls that meet: an end that stops short of the wall it was meant to join.
  const walls = [...wallById.values()];
  const levels = buildingLevels(shapes);
  if (walls.length > 1 && levels.length) {
    checked.push('wall junctions (gaps where walls were meant to meet)');
    for (const level of levels) {
      const here = level.walls.filter(w => wallById.has(w.id));
      for (const w of here) {
        const { a, b } = wallAxis(w);
        for (const end of [a, b]) {
          let best = Infinity, bestWall: Shape | null = null;
          for (const o of here) {
            if (o === w) continue;
            const ax = wallAxis(o);
            const d = distToSegment(end, ax.a, ax.b) - ax.thick / 2;
            if (d < best) { best = d; bestWall = o; }
          }
          if (bestWall && best > TOUCH && best <= GAP_LIMIT) {
            issues.push({ severity: 'warning', code: 'wall-gap', level: level.level, ids: [w.id, bestWall.id], message: `Wall ${w.id} stops ${round(best * 1000, 0)} mm short of wall ${bestWall.id}. If they should join, extend it; if there is a doorway-sized gap on purpose, ignore this.` });
          }
        }
      }
    }
  } else skipped.push('wall junctions: fewer than two walls');

  // 4. Furniture that rests on the floor (or on something).
  const rooms = detectRooms(shapes);
  const furniture = visible.filter(s => s.customData?.semanticComponent && !s.hostWallId);
  if (furniture.length && levels.length) {
    checked.push('furniture resting on the floor or on another item');
    const spans = furniture.map(f => {
      const pts = worldPoints(f, Infinity);
      return pts.length ? { f, low: Math.min(...pts.map(p => p.y)), high: Math.max(...pts.map(p => p.y)), pts } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    for (const s of spans) {
      const semantic = s.f.customData.semanticComponent;
      const hosts: string[] = semantic.placement?.hosts ?? [];
      // Ceiling fittings and people are not expected to rest on the floor; wall-mounted items stand off it by their floor clearance.
      if (hosts.includes('ceiling') || semantic.kind === 'character') continue;
      const mountedAt: number = semantic.placement?.floorClearanceM ?? 0;
      const c: V2 = [s.f.position[0], s.f.position[2]];
      // The floor it stands over: the highest floor at or below it that has it inside a room.
      const room = rooms.filter(r => r.elevation <= s.low + 0.3 && inPolygon(c, r.boundary)).sort((x, y) => y.elevation - x.elevation)[0];
      if (!room) continue;
      const rest = s.low - room.elevation - mountedAt;
      const carriedBy = spans.find(o => o !== s && Math.abs(o.high - s.low) < 0.05 && inPolygon(c, planHull(o.pts)));
      if (rest < -0.08) issues.push({ severity: 'warning', code: 'sunk-object', level: room.level, ids: [s.f.id], message: `${s.f.name ?? s.f.type} (${s.f.id}) is ${round(-rest)} m below the floor. Raise it to the floor level (${round(room.elevation)} m).` });
      else if (rest > 0.08 && !carriedBy) issues.push({ severity: 'warning', code: 'floating-object', level: room.level, ids: [s.f.id], message: `${s.f.name ?? s.f.type} (${s.f.id}) floats ${round(rest)} m above the floor and nothing is under it. Lower it to ${round(room.elevation)} m, or put it on something.` });
    }
  } else skipped.push('furniture support: no furniture placed on a floor');

  // 5. Walls above that should sit on the walls below.
  if (levels.length > 1) {
    checked.push('walls lining up from one storey to the next');
    for (const upper of levels.slice(1)) {
      const lowerWalls = levels.filter(l => l.level < upper.level).flatMap(l => l.walls);
      for (const w of upper.walls) {
        const { a, b } = wallAxis(w);
        let best = Infinity, near: Shape | null = null;
        for (const o of lowerWalls) {
          const ax = wallAxis(o);
          const drift = Math.max(distToSegment(a, ax.a, ax.b), distToSegment(b, ax.a, ax.b));
          if (drift < best) { best = drift; near = o; }
        }
        if (near && best > TOUCH && best <= 0.3) {
          issues.push({ severity: 'warning', code: 'vertical-drift', level: upper.level, ids: [w.id, near.id], message: `Wall ${w.id} on level ${upper.level} is ${round(best * 1000, 0)} mm off the wall below it (${near.id}). If they should line up, move it to match.` });
        }
      }
    }
  } else skipped.push('storey alignment: only one storey');

  const count = (s: GeometryIssue['severity']) => issues.filter(i => i.severity === s).length;
  return { issues, errors: count('error'), warnings: count('warning'), info: count('info'), checked, skipped };
}

/** Plan outline of a point cloud: its bounding box (enough to tell whether something stands over another). */
function planHull(pts: THREE.Vector3[]): V2[] {
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}
