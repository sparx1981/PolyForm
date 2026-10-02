import * as THREE from 'three';
import type { Shape } from '../../src/types';
import { buildingLevels, roofHeadroom } from '../../src/lib/presentation/floorPlans';
import { detectRooms, type SpatialRoom } from '../../src/lib/spatial/rooms';
import { ToolError } from './store';

/**
 * Checks the connector runs on what it builds, so a placement the app would never allow is
 * stopped (or reported) here rather than found by the person looking at the model afterwards:
 * walls on the right storey, stairs that fit inside a room, furniture under the ceiling.
 */

type V2 = [number, number];

/** Same tolerance the app uses to decide two wall bases are the same storey. */
const LEVEL_GAP = 0.5;
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const nums = (s: Shape) => (Array.isArray(s.args) ? (s.args as number[]) : []);

export function orientation(s: Shape): THREE.Quaternion {
  if (s.quaternion) return new THREE.Quaternion(...s.quaternion);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0, 0, 0])));
}

export const wallBase = (w: Shape) => w.position[1] - (nums(w)[1] ?? 2.8) / 2;

// ── Storeys ──────────────────────────────────────────────────────────────────────────────

/** The storey (1 = ground) a floor at height `y` belongs to, counting the storeys the walls already make. */
export function storyForElevation(shapes: Shape[], y: number): number {
  const levels = buildingLevels(shapes);
  const same = levels.find(l => Math.abs(l.elevation - y) < LEVEL_GAP);
  if (same) return same.level;
  return levels.filter(l => l.elevation < y - LEVEL_GAP).length + 1;
}

const isTagged = (s: Shape, tag: string) => s.tags?.includes(tag);
const isFloorSlab = (s: Shape) => isTagged(s, 'floor-slab') || /floor slab/i.test(s.name ?? '');
const isCeilingSlab = (s: Shape) => isTagged(s, 'ceiling-slab') || isTagged(s, 'ceiling') || /ceiling slab/i.test(s.name ?? '');
const isSkirt = (s: Shape) => isTagged(s, 'foundation-skirt') || /foundation skirt/i.test(s.name ?? '');

/**
 * Gives every wall, floor slab, ceiling slab and foundation skirt the `story-N` tag for the height
 * it actually stands at. The room tool tags everything `story-1` unless told otherwise, which put
 * every upper-floor wall under Level 1 in the outliner, so this re-derives the tag from the height
 * (the way the floor plans and roof tool already group walls) and replaces a stale one.
 */
export function retagStories(shapes: Shape[]): Shape[] {
  const levels = buildingLevels(shapes);
  if (!levels.length) return shapes;
  const storyOf = (base: number) => {
    let story = 1;
    for (const l of levels) if (base >= l.elevation - LEVEL_GAP) story = l.level;
    return story;
  };
  return shapes.map(s => {
    let base: number;
    if (s.type === 'wall') base = wallBase(s);
    else if (isFloorSlab(s) || isSkirt(s)) base = s.position[1] + 0.3;
    else if (isCeilingSlab(s)) base = s.position[1] - 0.3;
    else return s;
    const story = storyOf(base);
    const tags = s.tags ?? [];
    const stories = tags.filter(t => /^story-\d+$/.test(t));
    if (stories.length === 1 && stories[0] === `story-${story}`) return s;
    return {
      ...s,
      name: isSkirt(s) ? s.name?.replace(/\(Story \d+\)/, `(Story ${story})`) : s.name,
      tags: [...tags.filter(t => !/^story-\d+$/.test(t)), `story-${story}`],
    };
  });
}

// ── Stairs ───────────────────────────────────────────────────────────────────────────────

export interface StairFootprint {
  /** The four corners of the flight's plan footprint (world x, z). */
  corners: V2[];
  centre: V2;
  /** Unit plan direction the flight climbs towards (straight flights). */
  climb: V2;
  /** Height of the bottom and top step surfaces. */
  bottom: number;
  top: number;
  width: number;
  length: number;
}

/** Local plan box [minX, maxX, minZ, maxZ] of a stair mesh, from its geometry when it has one. */
function localBox(stair: Shape): [number, number, number, number] {
  const pos = stair.geometryData?.positions as number[] | undefined;
  if (pos && pos.length >= 9) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
      minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
    }
    return [minX, maxX, minZ, maxZ];
  }
  const [w = 1, , l = 3.6] = nums(stair);
  return [-w / 2, w / 2, -l / 2, l / 2];
}

/** Where a stair stands in plan, however it has been turned. */
export function stairFootprint(stair: Shape): StairFootprint {
  const [minX, maxX, minZ, maxZ] = localBox(stair);
  const q = orientation(stair);
  const [px, py, pz] = stair.position;
  const world = (x: number, z: number): V2 => {
    const v = new THREE.Vector3(x, 0, z).applyQuaternion(q);
    return [px + v.x, pz + v.z];
  };
  const corners = [world(minX, minZ), world(maxX, minZ), world(maxX, maxZ), world(minX, maxZ)];
  const climbV = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const len = Math.hypot(climbV.x, climbV.z) || 1;
  const rise = nums(stair)[1] ?? 2.7;
  return {
    corners,
    centre: world((minX + maxX) / 2, (minZ + maxZ) / 2),
    climb: [climbV.x / len, climbV.z / len],
    bottom: py - rise / 2,
    top: py + rise / 2,
    width: maxX - minX,
    length: maxZ - minZ,
  };
}

export function inPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Moves each corner a little towards the centre, so a flight touching a wall face still counts as inside. */
function shrink(corners: V2[], centre: V2, by: number): V2[] {
  return corners.map(([x, z]) => {
    const dx = centre[0] - x, dz = centre[1] - z, d = Math.hypot(dx, dz) || 1;
    return [x + (dx / d) * by, z + (dz / d) * by] as V2;
  });
}

function overlapsOnAxis(a: V2[], b: V2[], axis: V2): boolean {
  const project = (pts: V2[]) => { const d = pts.map(p => p[0] * axis[0] + p[1] * axis[1]); return [Math.min(...d), Math.max(...d)]; };
  const [a0, a1] = project(a), [b0, b1] = project(b);
  return a1 > b0 && b1 > a0;
}

/** True when two convex plan boxes overlap (separating-axis test). */
export function boxesOverlap(a: V2[], b: V2[]): boolean {
  for (const box of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const e: V2 = [box[i + 1][0] - box[i][0], box[i + 1][1] - box[i][1]];
      const len = Math.hypot(e[0], e[1]) || 1;
      if (!overlapsOnAxis(a, b, [-e[1] / len, e[0] / len])) return false;
    }
  }
  return true;
}

export function wallCorners(w: Shape): V2[] {
  const [length = 1, , thickness = 0.2] = nums(w);
  const d = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation(w));
  const len = Math.hypot(d.x, d.z) || 1;
  const dir: V2 = [d.x / len, d.z / len], perp: V2 = [-dir[1], dir[0]];
  const a = length / 2, b = thickness / 2, [cx, cz] = [w.position[0], w.position[2]];
  return [
    [cx - dir[0] * a - perp[0] * b, cz - dir[1] * a - perp[1] * b],
    [cx + dir[0] * a - perp[0] * b, cz + dir[1] * a - perp[1] * b],
    [cx + dir[0] * a + perp[0] * b, cz + dir[1] * a + perp[1] * b],
    [cx - dir[0] * a + perp[0] * b, cz - dir[1] * a + perp[1] * b],
  ];
}

/** Walls the flight would stand among: those whose height range overlaps the climb. */
function wallsAlongClimb(shapes: Shape[], bottom: number, top: number): Shape[] {
  return shapes.filter(s => {
    if (s.type !== 'wall' || s.hidden) return false;
    const base = wallBase(s), height = nums(s)[1] ?? 2.8;
    return Math.min(top, base + height) - Math.max(bottom, base) > 0.3;
  });
}

/** Plan boxes of other flights that share any of this flight's height range. */
function otherStairs(shapes: Shape[], f: StairFootprint): V2[][] {
  return shapes
    .filter(s => s.type === 'staircase' && !s.hidden)
    .map(stairFootprint)
    .filter(o => Math.min(o.top, f.top) - Math.max(o.bottom, f.bottom) > 0.3)
    .map(o => o.corners);
}

const roomsAt = (rooms: SpatialRoom[], y: number) => rooms.filter(r => Math.abs(r.elevation - y) < LEVEL_GAP);
const label = (r: SpatialRoom) => r.name ?? r.id;

/** What a straight flight needs, so the message can say why it doesn't fit. */
const needs = (f: StairFootprint) => `${round(f.width)} × ${round(f.length)} m`;

export interface StairCheck { errors: string[]; warnings: string[] }

/**
 * Whether a placed flight fits where it was put: wholly inside one room of the storey it starts on
 * (so it neither pokes out of the house nor cuts through a neighbouring room), clear of walls, and
 * arriving inside a room on the storey above. Stairs in a model with no walls are not checked.
 */
export function checkStair(shapes: Shape[], stair: Shape, opts: { allowOutside?: boolean } = {}): StairCheck {
  const out: StairCheck = { errors: [], warnings: [] };
  const f = stairFootprint(stair);
  const others = shapes.filter(s => s.id !== stair.id);
  const rooms = detectRooms(others);
  const here = roomsAt(rooms, f.bottom);
  if (!here.length) return out;

  const inner = shrink(f.corners, f.centre, 0.04);
  if (otherStairs(others, f).some(b => boxesOverlap(inner, b))) out.errors.push('The stairs would overlap another staircase.');
  const containing = here.find(r => inner.every(p => inPolygon(p, r.boundary)));
  const hits = wallsAlongClimb(others, f.bottom, f.top).filter(w => boxesOverlap(inner, wallCorners(w)));

  if (!containing && !opts.allowOutside) {
    const outside = inner.filter(p => !here.some(r => inPolygon(p, r.boundary))).length;
    const touched = here.filter(r => inner.some(p => inPolygon(p, r.boundary))).map(label);
    out.errors.push(
      outside
        ? `The stairs (${needs(f)}) would stick out of the house: ${outside} of their 4 corners are outside every room on this floor.`
        : `The stairs (${needs(f)}) would cut through a wall into another room (they touch ${touched.join(' and ') || 'more than one room'}).`,
    );
  }
  if (hits.length) {
    out.errors.push(`The stairs would pass through ${hits.length} wall${hits.length > 1 ? 's' : ''} (${hits.slice(0, 3).map(w => w.id).join(', ')}).`);
  }

  // The top of the flight should step off onto a floor.
  const reach = f.length / 2 + 0.45;
  const beyond: V2 = [f.centre[0] + f.climb[0] * reach, f.centre[1] + f.climb[1] * reach];
  const above = roomsAt(rooms, f.top);
  if (above.length && !above.some(r => inPolygon(beyond, r.boundary))) {
    out.warnings.push('The top of the stairs does not arrive inside a room on the floor above (it lands in a wall or outside). Turn them with rotation_deg or move them.');
  }
  return out;
}

export interface StairVariant {
  /** A stair built at the origin (position [0, rise/2, 0], unturned). */
  stair: Shape;
}

/**
 * Finds a spot inside a room where a flight fits: tries each variant (e.g. straight, then an
 * L-shape, then a U-shape), every quarter turn, on a 10 cm grid, keeping clear of walls and
 * doorways. It prefers a place snug against a wall, near a corner. Returns the placed copy.
 */
export function placeStairInRoom(shapes: Shape[], room: SpatialRoom, variants: Shape[]): Shape | null {
  const walls = wallsAlongClimb(shapes, room.elevation, room.elevation + (nums(variants[0])[1] ?? 2.7));
  const wallBoxes = walls.map(wallCorners);
  const doors = shapes.filter(s => s.type === 'door' && !s.hidden && s.hostWallId && walls.some(w => w.id === s.hostWallId));
  const xs = room.boundary.map(p => p[0]), zs = room.boundary.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const flights = otherStairs(shapes, { bottom: room.elevation, top: room.elevation + (nums(variants[0])[1] ?? 2.7) } as StairFootprint).map(b => expand(b, 0.1));
  // A coarse pass over the room, then a fine pass round the best spot: scanning a very large room
  // (a hall 200 m across) on a 10 cm grid took minutes, longer than the connector is allowed.
  const started = Date.now(), BUDGET_MS = 20_000;
  const coarse = Math.min(1, Math.max(0.1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 6000)));
  const timedOut = () => Date.now() - started > BUDGET_MS;

  for (const variant of variants) {
    const rise = nums(variant)[1] ?? 2.7;
    let best: { shape: Shape; score: number } | null = null;
    for (const turn of [0, 90, 180, 270]) {
      const probe: Shape = { ...variant, position: [0, rise / 2, 0], rotation: [0, THREE.MathUtils.degToRad(turn), 0], quaternion: undefined };
      const f0 = stairFootprint(probe);
      const offs = f0.corners.map(c => [c[0] - f0.centre[0], c[1] - f0.centre[1]] as V2);
      const reach = Math.max(f0.width, f0.length);
      const tryAt = (x: number, z: number) => {
        const corners = offs.map(o => [x + o[0], z + o[1]] as V2);
        const inner = shrink(corners, [x, z], 0.04);
        if (!inner.every(p => inPolygon(p, room.boundary))) return;
        if (wallBoxes.some(b => boxesOverlap(inner, b))) return;
        if (flights.some(b => boxesOverlap(inner, b))) return;
        if (doors.some(d => inPolygon([d.position[0], d.position[2]], expand(corners, 0.45)))) return;
        const gap = Math.min(...room.boundary.map(p => Math.hypot(p[0] - x, p[1] - z)));
        const wall = Math.min(...wallBoxes.map(b => distanceToBox([x, z], b)), 99);
        const score = (wall < reach ? 0 : 100) + gap;
        if (!best || score < best.score) {
          best = { shape: { ...probe, position: [x + (probe.position[0] - f0.centre[0]), room.elevation + rise / 2, z + (probe.position[2] - f0.centre[1])] }, score };
        }
      };
      for (let x = x0; x <= x1 && !timedOut(); x += coarse) for (let z = z0; z <= z1; z += coarse) tryAt(x, z);
    }
    // Refine round the best coarse spot, down to 10 cm.
    if (best && coarse > 0.1 && !timedOut()) {
      const centre = best.shape.position, quat = best.shape;
      const turn = Math.round(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(orientation(quat), 'YXZ').y));
      const probe: Shape = { ...variant, position: [0, rise / 2, 0], rotation: [0, THREE.MathUtils.degToRad(turn), 0], quaternion: undefined };
      const f0 = stairFootprint(probe);
      const offs = f0.corners.map(c => [c[0] - f0.centre[0], c[1] - f0.centre[1]] as V2);
      const reach = Math.max(f0.width, f0.length);
      for (let x = centre[0] - 2 * coarse; x <= centre[0] + 2 * coarse; x += 0.1) for (let z = centre[2] - 2 * coarse; z <= centre[2] + 2 * coarse; z += 0.1) {
        const corners = offs.map(o => [x + o[0], z + o[1]] as V2);
        const inner = shrink(corners, [x, z], 0.04);
        if (!inner.every(p => inPolygon(p, room.boundary)) || wallBoxes.some(b => boxesOverlap(inner, b)) || flights.some(b => boxesOverlap(inner, b))) continue;
        if (doors.some(d => inPolygon([d.position[0], d.position[2]], expand(corners, 0.45)))) continue;
        const gap = Math.min(...room.boundary.map(p => Math.hypot(p[0] - x, p[1] - z)));
        const wall = Math.min(...wallBoxes.map(b => distanceToBox([x, z], b)), 99);
        const score = (wall < reach ? 0 : 100) + gap;
        if (score < best.score) best = { shape: { ...probe, position: [x + (probe.position[0] - f0.centre[0]), room.elevation + rise / 2, z + (probe.position[2] - f0.centre[1])] }, score };
      }
    }
    if (best) return best.shape;
    if (timedOut()) throw new ToolError('This room is so large that finding a place for the stairs took too long. Give position and rotation_deg for the stairs instead, or add them in a smaller room (a stair hall).');
  }
  return null;
}

function expand(corners: V2[], by: number): V2[] {
  const c: V2 = [corners.reduce((a, p) => a + p[0], 0) / 4, corners.reduce((a, p) => a + p[1], 0) / 4];
  return corners.map(([x, z]) => {
    const dx = x - c[0], dz = z - c[1], d = Math.hypot(dx, dz) || 1;
    return [x + (dx / d) * by, z + (dz / d) * by] as V2;
  });
}

function distanceToBox(p: V2, box: V2[]): number {
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = box[i], [bx, bz] = box[(i + 1) % 4];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (az + t * dz)));
  }
  return best;
}

// ── Furniture and the ceiling ────────────────────────────────────────────────────────────

export interface HeadroomIssue {
  item: Shape;
  /** Top of the item above its floor, metres. */
  height: number;
  /** Clear height at the worst point under the item. */
  headroom: number;
}

/** World-space vertices of an item (from its mesh, or its box when it has none), thinned for speed. */
export function worldPoints(s: Shape, max = 4000): THREE.Vector3[] {
  const q = orientation(s);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...s.position), q, new THREE.Vector3(...(s.scale ?? [1, 1, 1])));
  const pos = s.geometryData?.positions as number[] | undefined;
  const pts: THREE.Vector3[] = [];
  if (pos && pos.length >= 9) {
    const step = Math.max(1, Math.floor(pos.length / 3 / max));
    for (let i = 0; i < pos.length; i += 3 * step) pts.push(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m));
  } else if (s.type === 'box') {
    const [w = 1, h = 1, d = 1] = nums(s);
    for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(m));
  }
  return pts;
}

/**
 * Items that would stand through the ceiling or into a sloping roof: for each point of the item, the
 * clear height there (the next floor, or the underside of the roof or dormer above) against how high
 * the item reaches. Nothing is reported in a model with no walls.
 */
export function headroomIssues(shapes: Shape[], items: Shape[]): HeadroomIssue[] {
  const levels = buildingLevels(shapes);
  if (!levels.length) return [];
  const clear = roofHeadroom(shapes, levels);
  const issues: HeadroomIssue[] = [];
  for (const item of items) {
    const pts = worldPoints(item);
    if (!pts.length) continue;
    const lowest = Math.min(...pts.map(p => p.y));
    const floor = [...levels].reverse().find(l => l.elevation <= lowest + 0.3)?.elevation ?? levels[0].elevation;
    const next = levels.find(l => l.elevation > floor + LEVEL_GAP)?.elevation;
    let worst = Infinity, height = 0, over = false;
    for (const p of pts) {
      const room = clear ? clear(p.x, p.z, floor) : (next !== undefined ? next - floor : Infinity);
      height = Math.max(height, p.y - floor);
      worst = Math.min(worst, room);
      if (p.y - floor > room + 0.03) over = true;
    }
    if (over) issues.push({ item, height: round(height), headroom: round(worst) });
  }
  return issues;
}

/** Throws a readable error when an item would poke through the ceiling or roof. */
export function assertFitsUnderCeiling(shapes: Shape[], items: Shape[]) {
  const issues = headroomIssues(shapes, items);
  if (!issues.length) return;
  const first = issues[0];
  throw new ToolError(
    `${first.item.name ?? first.item.type} is ${first.height} m tall but only ${first.headroom} m of headroom is clear where it stands (the ceiling or sloping roof is in the way). Put it where the ceiling is higher, away from the eaves, or choose a lower item.`,
  );
}
