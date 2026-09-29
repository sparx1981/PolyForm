import * as THREE from 'three';
import type { Shape } from '../../types';

/**
 * Spatial room intelligence shared by editor, presentation, reconstruction,
 * BIM and furnishing. It deliberately derives rooms from architectural
 * geometry instead of storing duplicate room polygons as model Shapes.
 */

export type RoomSource = 'detected' | 'drawn' | 'roomplan' | 'pdf' | 'ifc' | 'ai';

export interface SpatialRoom {
  /** Stable-enough identity reconciled from the walls surrounding this room. */
  id: string;
  level: number;
  elevation: number;
  name?: string;
  source: RoomSource;
  /** Centre of a useful label / placement position in world X/Z metres. */
  at: [number, number];
  /** Approximate boundary polygon in world X/Z metres. */
  boundary: Array<[number, number]>;
  /** Axis-aligned room extents [width, depth] in metres. */
  size: [number, number];
  areaM2: number;
  perimeterM: number;
  /** Walls which bound the detected region, sorted for stable identity. */
  boundaryWallIds: string[];
  /** Doors/windows hosted by those walls. */
  openingIds: string[];
}

export interface RoomDetectionOptions {
  /** Raster resolution in metres. 5 cm matches floor-plan room detection. */
  cell?: number;
  /** Ignore accidental wall cavities/slivers smaller than this. */
  minAreaM2?: number;
}

interface Rect {
  centre: [number, number];
  dir: [number, number];
  length: number;
  width: number;
}

interface Level {
  level: number;
  elevation: number;
  walls: Shape[];
  openings: Shape[];
}

const DEFAULT_CELL = 0.05;
const LEVEL_GAP = 0.5;

function nums(s: Shape): number[] {
  return Array.isArray(s.args) ? s.args as number[] : [];
}

function quat(s: Shape) {
  if (s.quaternion) return new THREE.Quaternion(...s.quaternion);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0, 0, 0])));
}

function planDir(s: Shape): [number, number] {
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(quat(s));
  const len = Math.hypot(v.x, v.z) || 1;
  return [v.x / len, v.z / len];
}

function wallRect(w: Shape): Rect {
  const [length = 1, , thickness = 0.2] = nums(w);
  return { centre: [w.position[0], w.position[2]], dir: planDir(w), length, width: thickness };
}

function wallBase(w: Shape): number {
  const [, height = 2.8] = nums(w);
  return w.position[1] - height / 2;
}

function buildingLevels(shapes: Shape[]): Level[] {
  const walls = shapes
    .filter(s => s.type === 'wall' && !s.hidden)
    .sort((a, b) => wallBase(a) - wallBase(b));
  const groups: { elevation: number; walls: Shape[] }[] = [];
  for (const wall of walls) {
    const base = wallBase(wall);
    const last = groups.at(-1);
    if (last && base - last.elevation < LEVEL_GAP) last.walls.push(wall);
    else groups.push({ elevation: base, walls: [wall] });
  }
  return groups.map((group, i) => {
    const wallIds = new Set(group.walls.map(w => w.id));
    return {
      level: i + 1,
      elevation: Math.round(group.elevation * 100) / 100,
      walls: group.walls,
      openings: shapes.filter(s =>
        (s.type === 'door' || s.type === 'window') &&
        !s.hidden &&
        !!s.hostWallId &&
        wallIds.has(s.hostWallId)
      ),
    };
  });
}

function rectCorners(r: Rect): Array<[number, number]> {
  const [dx, dz] = r.dir;
  const px = -dz, pz = dx;
  const [cx, cz] = r.centre;
  const a = r.length / 2, b = r.width / 2;
  return [
    [cx - dx * a - px * b, cz - dz * a - pz * b],
    [cx + dx * a - px * b, cz + dz * a - pz * b],
    [cx + dx * a + px * b, cz + dz * a + pz * b],
    [cx - dx * a + px * b, cz - dz * a + pz * b],
  ];
}

function pointInRect(x: number, z: number, r: Rect, cell: number): boolean {
  const dx = x - r.centre[0], dz = z - r.centre[1];
  const u = dx * r.dir[0] + dz * r.dir[1];
  const v = -dx * r.dir[1] + dz * r.dir[0];
  return Math.abs(u) <= r.length / 2 + r.width / 2 &&
    Math.abs(v) <= Math.max(r.width / 2, cell * 0.75) + 0.005;
}

function distancePointToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const wx = p[0] - a[0], wz = p[1] - a[1];
  const vv = vx * vx + vz * vz;
  const t = vv <= 1e-12 ? 0 : Math.max(0, Math.min(1, (wx * vx + wz * vz) / vv));
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vz * t));
}

function wallSegment(r: Rect): [[number, number], [number, number]] {
  const half = r.length / 2;
  return [
    [r.centre[0] - r.dir[0] * half, r.centre[1] - r.dir[1] * half],
    [r.centre[0] + r.dir[0] * half, r.centre[1] + r.dir[1] * half],
  ];
}

function roomId(level: number, wallIds: string[]): string {
  // Human-readable deterministic identity. Reconciliation below preserves an
  // old id when a wall edit changes this signature but the room still overlaps.
  return `room:${level}:${wallIds.slice().sort().join('|') || 'unbounded'}`;
}

function perimeterFromBoundary(poly: Array<[number, number]>): number {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length <= 3) return points;
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Detect enclosed rooms from visible walls. */
export function detectRooms(shapes: Shape[], options: RoomDetectionOptions = {}): SpatialRoom[] {
  const cell = Math.max(0.02, options.cell ?? DEFAULT_CELL);
  const minArea = Math.max(0, options.minAreaM2 ?? 1);
  const out: SpatialRoom[] = [];

  for (const level of buildingLevels(shapes)) {
    const wallCorners = level.walls.flatMap(w => rectCorners(wallRect(w)));
    if (!wallCorners.length) continue;
    const minX = Math.min(...wallCorners.map(p => p[0])) - 1;
    const maxX = Math.max(...wallCorners.map(p => p[0])) + 1;
    const minZ = Math.min(...wallCorners.map(p => p[1])) - 1;
    const maxZ = Math.max(...wallCorners.map(p => p[1])) + 1;
    const nx = Math.max(3, Math.ceil((maxX - minX) / cell));
    const nz = Math.max(3, Math.ceil((maxZ - minZ) / cell));
    const labels = new Int32Array(nx * nz);
    const rects = level.walls.map(w => ({ wall: w, rect: wallRect(w) }));

    for (let j = 0; j < nz; j++) {
      const z = minZ + (j + 0.5) * cell;
      for (let i = 0; i < nx; i++) {
        const x = minX + (i + 0.5) * cell;
        if (rects.some(({ rect }) => pointInRect(x, z, rect, cell))) labels[j * nx + i] = 1;
      }
    }

    const fill = (start: number, value: number, capture = false) => {
      const stack = [start];
      const cells: number[] = [];
      labels[start] = value;
      while (stack.length) {
        const k = stack.pop()!;
        if (capture) cells.push(k);
        const i = k % nx, j = (k - i) / nx;
        const visit = (n: number) => { if (!labels[n]) { labels[n] = value; stack.push(n); } };
        if (i > 0) visit(k - 1);
        if (i < nx - 1) visit(k + 1);
        if (j > 0) visit(k - nx);
        if (j < nz - 1) visit(k + nx);
      }
      return cells;
    };

    // Flood exterior from all four grid edges.
    for (let i = 0; i < nx; i++) {
      if (!labels[i]) fill(i, 2);
      const k = (nz - 1) * nx + i;
      if (!labels[k]) fill(k, 2);
    }
    for (let j = 0; j < nz; j++) {
      let k = j * nx;
      if (!labels[k]) fill(k, 2);
      k += nx - 1;
      if (!labels[k]) fill(k, 2);
    }

    let next = 3;
    for (let k = 0; k < labels.length; k++) {
      if (labels[k]) continue;
      const cells = fill(k, next++, true);
      const areaM2 = cells.length * cell * cell;
      if (areaM2 < minArea) continue;

      const centres = cells.map(index => {
        const i = index % nx, j = (index - i) / nx;
        return [minX + (i + 0.5) * cell, minZ + (j + 0.5) * cell] as [number, number];
      });
      const at: [number, number] = [
        centres.reduce((s, p) => s + p[0], 0) / centres.length,
        centres.reduce((s, p) => s + p[1], 0) / centres.length,
      ];

      // A wall bounds this region when a room cell lies close to its segment.
      const boundaryWallIds = rects
        .filter(({ rect }) => {
          const [a, b] = wallSegment(rect);
          const threshold = rect.width / 2 + cell * 1.75;
          return centres.some(p => distancePointToSegment(p, a, b) <= threshold);
        })
        .map(({ wall }) => wall.id)
        .sort();

      const openingIds = level.openings
        .filter(o => !!o.hostWallId && boundaryWallIds.includes(o.hostWallId))
        .map(o => o.id)
        .sort();

      // Hull is intentionally an approximation for the first reusable spatial
      // milestone. Exact wall-face polygonisation will replace it later.
      const boundary = convexHull(centres);
      const xs = centres.map(p => p[0]), zs = centres.map(p => p[1]);
      const size: [number, number] = [
        Math.max(...xs) - Math.min(...xs) + cell,
        Math.max(...zs) - Math.min(...zs) + cell,
      ];
      out.push({
        id: roomId(level.level, boundaryWallIds),
        level: level.level,
        elevation: level.elevation,
        source: 'detected',
        at,
        boundary,
        size,
        areaM2,
        perimeterM: perimeterFromBoundary(boundary),
        boundaryWallIds,
        openingIds,
      });
    }
  }

  return out;
}

/**
 * Preserve room metadata/identity after normal wall edits. Matching strongly
 * favours shared wall IDs, with centroid proximity as the fallback for a wall
 * being replaced rather than merely moved.
 */
export function reconcileRooms(previous: SpatialRoom[], detected: SpatialRoom[]): SpatialRoom[] {
  const available = new Set(previous.map(r => r.id));
  return detected.map(room => {
    let best: SpatialRoom | undefined;
    let bestScore = -Infinity;
    for (const old of previous) {
      if (!available.has(old.id) || old.level !== room.level) continue;
      const shared = room.boundaryWallIds.filter(id => old.boundaryWallIds.includes(id)).length;
      const union = new Set([...room.boundaryWallIds, ...old.boundaryWallIds]).size || 1;
      const wallScore = shared / union;
      const distance = Math.hypot(room.at[0] - old.at[0], room.at[1] - old.at[1]);
      const score = wallScore * 10 - distance;
      if (score > bestScore) { bestScore = score; best = old; }
    }
    // Require meaningful topology overlap, or a close centroid for replacement edits.
    if (!best || (bestScore < 1 && Math.hypot(room.at[0] - best.at[0], room.at[1] - best.at[1]) > 1.5)) return room;
    available.delete(best.id);
    return { ...room, id: best.id, name: best.name ?? room.name, source: best.source ?? room.source };
  });
}
