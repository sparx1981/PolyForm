import * as THREE from 'three';
import type { Shape } from '../../types';
import { ROOF_BUILDUP, dormerCeilingAt, layoutsOf, type DormerLayout } from '../dormers';
import { RoofSurface } from '../roofSurface';

/**
 * Simple architectural floor plans drawn from a model's objects: walls, the doors and windows
 * set into them, stairs, and the rooms the walls enclose (found by filling the space between
 * walls, so they need no room objects). One plan per storey.
 */

type V2 = [number, number];

export interface RoomLabel {
  level: number;
  /** [x, z] of any point inside the room. */
  at: V2;
  name: string;
}

export interface PlanRoom {
  name?: string;
  areaM2: number;
  /**
   * Floor area with at least 1.5 m headroom, when a sloping roof (a loft room) takes some away;
   * a dormer's floor counts at the dormer's own ceiling height. Missing when all of it is usable.
   */
  usableM2?: number;
  /** Width (x) and depth (z) of the room's bounding box, metres. */
  size: V2;
  /** [x, z] of the room's label spot (pass it back as a RoomLabel to name the room). */
  at: V2;
}

export interface FloorPlan {
  level: number;
  /** Floor height of this storey, metres. */
  elevation: number;
  rooms: PlanRoom[];
  /** Doors and windows with their plan marks (only when `openingTags` is on). */
  openings: PlanOpening[];
  svg: string;
}

interface Rect {
  centre: V2;
  /** Unit direction of the long side, in plan. */
  dir: V2;
  length: number;
  width: number;
}

interface Level {
  level: number;
  elevation: number;
  walls: Shape[];
  openings: Shape[];
  stairs: Shape[];
}

const CELL = 0.05;
const LEVEL_GAP = 0.5;

function quat(s: Shape) {
  if (s.quaternion) return new THREE.Quaternion(...s.quaternion);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0, 0, 0])));
}

/** The plan direction an object's local +x points in. */
function planDir(s: Shape, local: [number, number, number] = [1, 0, 0]): V2 {
  const v = new THREE.Vector3(...local).applyQuaternion(quat(s));
  const len = Math.hypot(v.x, v.z) || 1;
  return [v.x / len, v.z / len];
}

const nums = (s: Shape) => (Array.isArray(s.args) ? (s.args as number[]) : []);

function wallRect(w: Shape): Rect {
  const [length = 1, , thickness = 0.2] = nums(w);
  return { centre: [w.position[0], w.position[2]], dir: planDir(w), length, width: thickness };
}

function corners(r: Rect): V2[] {
  const [dx, dz] = r.dir;
  const [px, pz] = [-dz, dx];
  const [cx, cz] = r.centre;
  const a = r.length / 2, b = r.width / 2;
  return [
    [cx - dx * a - px * b, cz - dz * a - pz * b],
    [cx + dx * a - px * b, cz + dz * a - pz * b],
    [cx + dx * a + px * b, cz + dz * a + pz * b],
    [cx - dx * a + px * b, cz - dz * a + pz * b],
  ];
}

function wallBase(w: Shape) {
  const [, height = 2.8] = nums(w);
  return w.position[1] - height / 2;
}

/** Walls grouped into storeys by the height they stand on, with their openings and stairs. */
export function buildingLevels(shapes: Shape[]): Level[] {
  const walls = shapes.filter(s => s.type === 'wall' && !s.hidden).sort((a, b) => wallBase(a) - wallBase(b));
  const groups: { elevation: number; walls: Shape[] }[] = [];
  for (const w of walls) {
    const base = wallBase(w);
    const last = groups.at(-1);
    if (last && base - last.elevation < LEVEL_GAP) last.walls.push(w);
    else groups.push({ elevation: base, walls: [w] });
  }
  const stairs = shapes.filter(s => s.type === 'staircase' && !s.hidden);
  return groups.map((g, i) => {
    const ids = new Set(g.walls.map(w => w.id));
    const top = groups[i + 1]?.elevation ?? Infinity;
    return {
      level: i + 1,
      elevation: Math.round(g.elevation * 100) / 100,
      walls: g.walls,
      openings: shapes.filter(s => (s.type === 'door' || s.type === 'window') && !s.hidden && s.hostWallId && ids.has(s.hostWallId)),
      stairs: stairs.filter(s => {
        const bottom = s.position[1] - (nums(s)[1] ?? 0) / 2;
        return bottom >= g.elevation - LEVEL_GAP && bottom < top - LEVEL_GAP;
      }),
    };
  });
}

interface Grid {
  x0: number;
  z0: number;
  nx: number;
  nz: number;
}

/** Rooms: the spaces the walls close off from the outside (doors count as closed). */
function findRooms(level: Level, grid: Grid, labels: RoomLabel[]) {
  const { x0, z0, nx, nz } = grid;
  const solid = new Uint8Array(nx * nz);
  for (const w of level.walls) {
    const r = wallRect(w);
    const cs = corners({ ...r, length: r.length + r.width, width: r.width + CELL * 2 });
    const xs = cs.map(c => c[0]), zs = cs.map(c => c[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / CELL) - 1), i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) - x0) / CELL) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / CELL) - 1), j1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) - z0) / CELL) + 1);
    // Run each wall on past its ends so corners close, and keep thin walls at least a cell wide.
    const a = r.length / 2 + r.width / 2, b = Math.max(r.width / 2, CELL * 0.75) + 0.005;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * CELL - r.centre[0], dz = z0 + (j + 0.5) * CELL - r.centre[1];
        const u = dx * r.dir[0] + dz * r.dir[1], v = -dx * r.dir[1] + dz * r.dir[0];
        if (Math.abs(u) <= a && Math.abs(v) <= b) solid[j * nx + i] = 1;
      }
    }
  }

  // 0 = unvisited open, 1 = wall, 2 = outside, 3+ = room id + 3.
  const label = new Int32Array(nx * nz);
  for (let k = 0; k < solid.length; k++) if (solid[k]) label[k] = 1;
  const fill = (start: number, value: number) => {
    const stack = [start];
    label[start] = value;
    let count = 0;
    while (stack.length) {
      const k = stack.pop()!;
      count++;
      const i = k % nx, j = (k - i) / nx;
      if (i > 0 && !label[k - 1]) { label[k - 1] = value; stack.push(k - 1); }
      if (i < nx - 1 && !label[k + 1]) { label[k + 1] = value; stack.push(k + 1); }
      if (j > 0 && !label[k - nx]) { label[k - nx] = value; stack.push(k - nx); }
      if (j < nz - 1 && !label[k + nx]) { label[k + nx] = value; stack.push(k + nx); }
    }
    return count;
  };
  for (let i = 0; i < nx; i++) {
    if (!label[i]) fill(i, 2);
    if (!label[(nz - 1) * nx + i]) fill((nz - 1) * nx + i, 2);
  }
  for (let j = 0; j < nz; j++) {
    if (!label[j * nx]) fill(j * nx, 2);
    if (!label[j * nx + nx - 1]) fill(j * nx + nx - 1, 2);
  }

  const rooms: { id: number; cells: number; minI: number; maxI: number; minJ: number; maxJ: number; best: number; bestD: number; name?: string }[] = [];
  for (let k = 0; k < label.length; k++) {
    if (label[k]) continue;
    const id = rooms.length + 3;
    const cells = fill(k, id);
    rooms.push({ id, cells, minI: nx, maxI: 0, minJ: nz, maxJ: 0, best: k, bestD: -1 });
  }
  if (!rooms.length) return { rooms: [], label };

  // Distance from the walls (two-pass chamfer), so each label sits in the roomiest spot.
  const dist = new Float32Array(nx * nz);
  for (let k = 0; k < dist.length; k++) dist[k] = label[k] >= 3 ? 1e9 : 0;
  // Keep room labels off the stairs too.
  for (const st of level.stairs) {
    const [sw = 1, , sl = 3.6] = nums(st);
    const [dx, dz] = planDir(st, [0, 0, 1]);
    for (let k = 0; k < dist.length; k++) {
      if (!dist[k]) continue;
      const i = k % nx, j = (k - i) / nx;
      const ox = x0 + (i + 0.5) * CELL - st.position[0], oz = z0 + (j + 0.5) * CELL - st.position[2];
      if (Math.abs(ox * dx + oz * dz) <= sl / 2 + 0.2 && Math.abs(-ox * dz + oz * dx) <= sw / 2 + 0.2) dist[k] = 0;
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (i > 0) dist[k] = Math.min(dist[k], dist[k - 1] + 1);
    if (j > 0) dist[k] = Math.min(dist[k], dist[k - nx] + 1);
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    if (i < nx - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1);
    if (j < nz - 1) dist[k] = Math.min(dist[k], dist[k + nx] + 1);
  }
  const byId = new Map(rooms.map(r => [r.id, r]));
  for (let k = 0; k < label.length; k++) {
    const room = byId.get(label[k]);
    if (!room) continue;
    const i = k % nx, j = (k - i) / nx;
    room.minI = Math.min(room.minI, i); room.maxI = Math.max(room.maxI, i);
    room.minJ = Math.min(room.minJ, j); room.maxJ = Math.max(room.maxJ, j);
    if (dist[k] > room.bestD) { room.bestD = dist[k]; room.best = k; }
  }
  for (const l of labels) {
    if (l.level !== level.level) continue;
    const i = Math.floor((l.at[0] - x0) / CELL), j = Math.floor((l.at[1] - z0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
    const room = byId.get(label[j * nx + i]);
    if (room) room.name = room.name ? `${room.name} / ${l.name}` : l.name;
  }
  // Leave out slivers (cavities in wall joints, a gap behind a stair).
  return { rooms: rooms.filter(r => r.cells * CELL * CELL >= 1), label };
}

/** A wall drawn on past each end that meets another wall, so corners and T-joints close. */
function joinedWall(w: Shape, walls: Shape[]): Rect {
  const r = wallRect(w);
  const touches = (p: V2) => walls.some(o => {
    if (o === w) return false;
    const q = wallRect(o);
    const dx = p[0] - q.centre[0], dz = p[1] - q.centre[1];
    const u = dx * q.dir[0] + dz * q.dir[1], v = -dx * q.dir[1] + dz * q.dir[0];
    // Only an end that stops inside the other wall (at its centreline, say) needs drawing on; an end
    // already out at the other wall's outer face is flush, and extending it would leave a stub.
    return Math.abs(u) <= q.length / 2 + q.width / 2 + 0.02 && Math.abs(v) < q.width / 2 - 0.01;
  });
  const half = r.length / 2;
  const startEnd: V2 = [r.centre[0] - r.dir[0] * half, r.centre[1] - r.dir[1] * half];
  const endEnd: V2 = [r.centre[0] + r.dir[0] * half, r.centre[1] + r.dir[1] * half];
  const before = touches(startEnd) ? r.width / 2 : 0, after = touches(endEnd) ? r.width / 2 : 0;
  const shift = (after - before) / 2;
  return { ...r, centre: [r.centre[0] + r.dir[0] * shift, r.centre[1] + r.dir[1] * shift], length: r.length + before + after };
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const f = (n: number) => n.toFixed(1);
const m2 = (n: number) => `${n.toFixed(1)} m²`;
const metres = (n: number) => `${n.toFixed(2)} m`;

const LEVEL_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor'];

/** Headroom that counts as usable floor area (the usual loft-conversion measure). */
export const USABLE_HEADROOM = 1.5;

/**
 * Headroom under the roofs at a plan point above a floor, or null when nothing low covers it:
 * the underside of the lowest roof above the floor, or inside a dormer its ceiling. Roofs are
 * read from their own geometry (like the dormers), so any roof the roof tool built works.
 */
function roofHeadroom(shapes: Shape[], levels: Level[]) {
  const roofs = shapes.filter(s => s.roofData && s.geometryData && !s.hidden && !s.tags?.includes('roof-extra'));
  if (!roofs.length) return null;
  const read = roofs.map(r => {
    let layouts: DormerLayout[] = [];
    try { layouts = layoutsOf(r); } catch { layouts = []; }
    return { r, surface: new RoofSurface(r), layouts };
  });
  const above = (e: number) => levels.find(l => l.elevation > e + LEVEL_GAP)?.elevation ?? Infinity;
  const cache = new Map<string, number>();
  return (x: number, z: number, floor: number): number => {
    const key = `${floor}|${Math.round(x / 0.25)}|${Math.round(z / 0.25)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let h = above(floor) - floor;
    for (const { r, surface, layouts } of read) {
      const [px, py, pz] = r.position;
      const lx = x - px, lz = z - pz;
      const inDormer = dormerCeilingAt(layouts, lx, lz);
      const y = inDormer ?? (surface.at(lx, lz)?.y ?? null);
      if (y === null) continue;
      const underside = py + y - (inDormer === null ? ROOF_BUILDUP : 0);
      if (underside > floor + 0.05) h = Math.min(h, underside - floor);
    }
    cache.set(key, h);
    return h;
  };
}

function usableCells(
  r: { id: number; minI: number; maxI: number; minJ: number; maxJ: number },
  label: Int32Array | number[], grid: Grid, headroom: (x: number, z: number) => number,
) {
  let n = 0;
  for (let j = r.minJ; j <= r.maxJ; j++) {
    for (let i = r.minI; i <= r.maxI; i++) {
      if (label[j * grid.nx + i] !== r.id) continue;
      if (headroom(grid.x0 + (i + 0.5) * CELL, grid.z0 + (j + 0.5) * CELL) >= USABLE_HEADROOM) n++;
    }
  }
  return n;
}

export interface PlanOptions {
  /** 'technical' (the default): black walls, measured. 'artistic': coloured, textured floors, planting. */
  style?: 'technical' | 'artistic';
  /** Length of each outside wall, drawn outside it. */
  wallDimensions?: boolean;
  /** D1, W1… marks beside each door and window (listed in `FloorPlan.openings`). */
  openingTags?: boolean;
  /** Plan title per storey; defaults to "Level 1 · Ground floor". */
  title?: (level: number, elevation: number) => string;
  fontFamily?: string;
  /** The "x →, z ↓" note under the title (on by default; for the connector's readers). */
  axisNote?: boolean;
  /** Canopy / spread diameter of a plant, metres (artistic plans only). */
  plantSpread?: (s: Shape) => number;
}

export interface PlanOpening {
  mark: string;
  kind: 'door' | 'window';
  level: number;
  width: number;
  height: number;
  /** Height of the bottom of the opening above its floor, metres. */
  sill: number;
  style?: string;
}

const ROOM_TINTS = ['#f2e2cc', '#e3eee1', '#e2eaf4', '#f4e4e6', '#ece6f5', '#f5eed6', '#e0efec'];
const WET = /kitchen|bath|shower|wc|toilet|utility|laundry|ensuite|en-suite/i;

function artisticDefs() {
  return `<defs>`
    + `<filter id="wallShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#3b2f25" flood-opacity="0.28"/></filter>`
    + `<pattern id="wood" width="18" height="120" patternUnits="userSpaceOnUse"><rect width="18" height="120" fill="none"/><line x1="0" y1="0" x2="0" y2="120" stroke="#b48a5a" stroke-opacity="0.18" stroke-width="1"/><line x1="0" y1="40" x2="18" y2="40" stroke="#b48a5a" stroke-opacity="0.14" stroke-width="1"/></pattern>`
    + `<pattern id="tile" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="none" stroke="#7d8c99" stroke-opacity="0.18" stroke-width="1"/></pattern>`
    + `<pattern id="paving" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="#dcd4c6"/><rect width="28" height="28" fill="none" stroke="#b7ac99" stroke-width="1.2"/></pattern>`
    + `<pattern id="decking" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#c79d6e"/><line x1="0" y1="0" x2="10" y2="0" stroke="#9c7349" stroke-width="1"/></pattern>`
    + `<radialGradient id="water" cx="50%" cy="45%" r="60%"><stop offset="0%" stop-color="#bfe6f3"/><stop offset="100%" stop-color="#7cc0dc"/></radialGradient>`
    + `<radialGradient id="canopy" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#b9d9a0"/><stop offset="100%" stop-color="#7fae68"/></radialGradient>`
    + `</defs>`;
}

/** Floor plans for every storey, or none when the model has no walls. */
export function floorPlans(shapes: Shape[], labels: RoomLabel[] = [], widthPx = 1000, options: PlanOptions = {}): FloorPlan[] {
  const levels = buildingLevels(shapes);
  if (!levels.length) return [];
  const art = options.style === 'artistic';

  // One scale and frame for every storey, so the plans line up.
  const pts = levels.flatMap(l => l.walls.flatMap(w => corners(wallRect(w))));
  let minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
  let minZ = Math.min(...pts.map(p => p[1])), maxZ = Math.max(...pts.map(p => p[1]));
  const grid: Grid = {
    x0: minX - 1, z0: minZ - 1,
    nx: Math.ceil((maxX - minX + 2) / CELL), nz: Math.ceil((maxZ - minZ + 2) / CELL),
  };
  const house = { minX, maxX, minZ, maxZ };

  // The garden close to the house shows on an artistic ground floor plan; the frame grows to fit it.
  const garden = art ? gardenShapes(shapes, house) : [];
  if (garden.length) {
    for (const g of garden) {
      for (const [x, z] of gardenOutline(g, options)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
  }
  const dimPad = options.wallDimensions ? 40 : 0;
  const pad = { l: 90 + dimPad, r: 50 + dimPad, t: 140 + dimPad, b: 90 + dimPad };
  const scale = Math.min((widthPx - pad.l - pad.r) / Math.max(maxX - minX, 1), 900 / Math.max(maxZ - minZ, 1));
  const height = Math.round(pad.t + pad.b + (maxZ - minZ) * scale);
  const X = (x: number) => pad.l + (x - minX) * scale;
  const Z = (z: number) => pad.t + (z - minZ) * scale;
  const poly = (ps: V2[]) => ps.map(p => `${f(X(p[0]))},${f(Z(p[1]))}`).join(' ');
  const font = options.fontFamily ?? 'DejaVu Sans';
  const ink = art ? '#3b322b' : '#111';
  const marks = { door: 0, window: 0 };
  const headroom = roofHeadroom(shapes, levels);

  return levels.map(level => {
    const { rooms, label } = findRooms(level, grid, labels);
    const out: string[] = [];
    const title = options.title?.(level.level, level.elevation) ?? `Level ${level.level} · ${LEVEL_NAMES[level.level - 1] ?? `Floor ${level.level}`}`;
    if (art) out.push(artisticDefs());
    out.push(`<rect width="100%" height="100%" fill="${art ? '#f8f4ee' : '#ffffff'}"/>`);
    out.push(`<text x="${pad.l - dimPad}" y="44" font-size="26" font-weight="bold" fill="${ink}">${esc(title)}</text>`);
    out.push(`<text x="${pad.l - dimPad}" y="72" font-size="15" fill="#666">Floor at ${metres(level.elevation)} · ${rooms.length} room${rooms.length === 1 ? '' : 's'}${art || options.axisNote === false ? '' : ' · x →, z ↓'}</text>`);

    if (art && level.level === 1) for (const g of garden) out.push(drawGarden(g, options, X, Z, scale));

    // Rooms (tinted), then walls on top.
    const planRooms: PlanRoom[] = [];
    rooms.forEach((r, n) => {
      const x = grid.x0 + r.minI * CELL, z = grid.z0 + r.minJ * CELL;
      const w = (r.maxI - r.minI + 1) * CELL, d = (r.maxJ - r.minJ + 1) * CELL;
      const bi = r.best % grid.nx, bj = (r.best - bi) / grid.nx;
      const areaM2 = +(r.cells * CELL * CELL).toFixed(1);
      const usable = headroom ? usableCells(r, label, grid, (x, z) => headroom(x, z, level.elevation)) * CELL * CELL : r.cells * CELL * CELL;
      planRooms.push({
        name: r.name, areaM2, size: [+w.toFixed(2), +d.toFixed(2)],
        at: [+(grid.x0 + (bi + 0.5) * CELL).toFixed(2), +(grid.z0 + (bj + 0.5) * CELL).toFixed(2)],
        ...(areaM2 - usable >= 0.1 ? { usableM2: +usable.toFixed(1) } : {}),
      });
      const fill = art ? ROOM_TINTS[n % ROOM_TINTS.length] : '#f5f1e8';
      const texture = art ? (WET.test(r.name ?? '') ? 'tile' : 'wood') : null;
      // The room's own cells, row by row (so L-shaped rooms tint correctly), tucked under the walls.
      const runs: string[] = [];
      for (let j = r.minJ; j <= r.maxJ; j++) {
        let i = r.minI;
        while (i <= r.maxI) {
          if (label[j * grid.nx + i] !== r.id) { i++; continue; }
          const start = i;
          while (i <= r.maxI && label[j * grid.nx + i] === r.id) i++;
          const rx = grid.x0 + (start - 1) * CELL, rz = grid.z0 + (j - 1) * CELL;
          runs.push(`<rect x="${f(X(rx))}" y="${f(Z(rz))}" width="${f((i - start + 2) * CELL * scale)}" height="${f(3 * CELL * scale)}"/>`);
        }
      }
      out.push(`<g fill="${fill}">${runs.join('')}</g>`);
      if (texture) out.push(`<g fill="url(#${texture})">${runs.join('')}</g>`);
    });
    const wallFill = art ? '#3b322b' : '#1f2937';
    out.push(`<g fill="${wallFill}"${art ? ' filter="url(#wallShadow)"' : ''}>`);
    for (const w of level.walls) out.push(`<polygon points="${poly(corners(joinedWall(w, level.walls)))}"/>`);
    out.push(`</g>`);

    const openings: PlanOpening[] = [];
    const centre: V2 = [(house.minX + house.maxX) / 2, (house.minZ + house.maxZ) / 2];
    for (const o of level.openings) {
      const host = level.walls.find(w => w.id === o.hostWallId)!;
      const wr = wallRect(host);
      const [ow = 0.9, oh = o.type === 'door' ? 2.1 : 1.2] = nums(o);
      const r: Rect = { centre: [o.position[0], o.position[2]], dir: wr.dir, length: ow, width: wr.width + 0.02 };
      const openingFill = art ? ROOM_TINTS[0] : '#ffffff';
      out.push(`<polygon points="${poly(corners(r))}" fill="${art ? '#f8f4ee' : openingFill}"/>`);
      const [a, b, c, d] = corners({ ...r, width: wr.width });
      if (o.type === 'window') {
        out.push(`<polygon points="${poly([a, b, c, d])}" fill="${art ? '#cfe9f5' : '#e0f2fe'}" stroke="${art ? '#5b9ec0' : '#0369a1'}" stroke-width="1.5"/>`);
        const mid: Rect = { ...r, width: 0.001 };
        const [m1, m2p] = corners(mid);
        out.push(`<line x1="${f(X(m1[0]))}" y1="${f(Z(m1[1]))}" x2="${f(X(m2p[0]))}" y2="${f(Z(m2p[1]))}" stroke="${art ? '#5b9ec0' : '#0369a1'}" stroke-width="1.5"/>`);
      } else {
        // Door leaf swung 90° to one side, hinged at the opening's start jamb, with its arc.
        const [dx, dz] = r.dir;
        const [px, pz] = [-dz, dx];
        const hinge: V2 = [r.centre[0] - dx * ow / 2 + px * wr.width / 2, r.centre[1] - dz * ow / 2 + pz * wr.width / 2];
        const leaf: V2 = [hinge[0] + px * ow, hinge[1] + pz * ow];
        const end: V2 = [hinge[0] + dx * ow, hinge[1] + dz * ow];
        const sweep = dx * pz - dz * px > 0 ? 0 : 1;
        out.push(`<line x1="${f(X(hinge[0]))}" y1="${f(Z(hinge[1]))}" x2="${f(X(leaf[0]))}" y2="${f(Z(leaf[1]))}" stroke="${art ? '#6b5d50' : '#374151'}" stroke-width="2"/>`);
        out.push(`<path d="M ${f(X(leaf[0]))} ${f(Z(leaf[1]))} A ${f(ow * scale)} ${f(ow * scale)} 0 0 ${sweep} ${f(X(end[0]))} ${f(Z(end[1]))}" fill="none" stroke="#9ca3af" stroke-width="1.2" stroke-dasharray="4 3"/>`);
      }
      if (options.openingTags) {
        const kind = o.type === 'door' ? 'door' : 'window';
        const mark = `${kind === 'door' ? 'D' : 'W'}${++marks[kind]}`;
        const hostBase = wallBase(host);
        openings.push({
          mark, kind, level: level.level, width: +ow.toFixed(2), height: +oh.toFixed(2),
          sill: +Math.max(0, o.position[1] - oh / 2 - hostBase).toFixed(2), style: o.archStyle,
        });
        // Tag just inside the wall (towards the building's middle), clear of the dimension lines outside.
        const [dx, dz] = wr.dir;
        let [px, pz] = [-dz, dx];
        if ((o.position[0] - centre[0]) * px + (o.position[2] - centre[1]) * pz > 0) { px = -px; pz = -pz; }
        const off = wr.width / 2 + 20 / scale;
        const tx = X(o.position[0] + px * off), tz = Z(o.position[2] + pz * off);
        const shape = kind === 'door'
          ? `<circle cx="${f(tx)}" cy="${f(tz)}" r="11" fill="#fff" stroke="#374151" stroke-width="1.2"/>`
          : `<rect x="${f(tx - 13)}" y="${f(tz - 9)}" width="26" height="18" rx="3" fill="#fff" stroke="#0369a1" stroke-width="1.2"/>`;
        out.push(`${shape}<text x="${f(tx)}" y="${f(tz + 4)}" font-size="10" font-weight="bold" text-anchor="middle" fill="#111">${mark}</text>`);
      }
    }

    for (const s of level.stairs) {
      const [sw = 1, , sl = 3.6, steps = 14] = nums(s);
      const r: Rect = { centre: [s.position[0], s.position[2]], dir: planDir(s, [0, 0, 1]), length: sl, width: sw };
      out.push(`<polygon points="${poly(corners(r))}" fill="#ffffff" stroke="#374151" stroke-width="1.5"/>`);
      const [dx, dz] = r.dir;
      const [px, pz] = [-dz, dx];
      for (let n = 1; n < steps; n++) {
        const t = -sl / 2 + (sl * n) / steps;
        const c: V2 = [r.centre[0] + dx * t, r.centre[1] + dz * t];
        out.push(`<line x1="${f(X(c[0] - px * sw / 2))}" y1="${f(Z(c[1] - pz * sw / 2))}" x2="${f(X(c[0] + px * sw / 2))}" y2="${f(Z(c[1] + pz * sw / 2))}" stroke="#9ca3af" stroke-width="1"/>`);
      }
      const from: V2 = [r.centre[0] - dx * sl * 0.4, r.centre[1] - dz * sl * 0.4];
      const to: V2 = [r.centre[0] + dx * sl * 0.4, r.centre[1] + dz * sl * 0.4];
      out.push(`<line x1="${f(X(from[0]))}" y1="${f(Z(from[1]))}" x2="${f(X(to[0]))}" y2="${f(Z(to[1]))}" stroke="#b45309" stroke-width="2"/>`);
      // Walking line: a dot where the flight starts, an arrowhead where it arrives.
      out.push(`<circle cx="${f(X(from[0]))}" cy="${f(Z(from[1]))}" r="4" fill="#b45309"/>`);
      const head = 0.18;
      const h1: V2 = [to[0] - dx * head + px * head * 0.6, to[1] - dz * head + pz * head * 0.6];
      const h2: V2 = [to[0] - dx * head - px * head * 0.6, to[1] - dz * head - pz * head * 0.6];
      out.push(`<polygon points="${poly([to, h1, h2])}" fill="#b45309"/>`);
      out.push(`<text x="${f(X(from[0]) + 6)}" y="${f(Z(from[1]) + 5)}" font-size="13" fill="#b45309">UP</text>`);
    }

    rooms.forEach((r, n) => {
      const k = r.best, i = k % grid.nx, j = (k - i) / grid.nx;
      const cx = X(grid.x0 + (i + 0.5) * CELL), cz = Z(grid.z0 + (j + 0.5) * CELL);
      const room = planRooms[n];
      const size = `${room.size[0].toFixed(1)} × ${room.size[1].toFixed(1)} m`;
      const small = r.bestD * CELL * scale < 40;
      if (room.name) out.push(`<text x="${f(cx)}" y="${f(cz - (small ? 4 : 10))}" font-size="${small ? 12 : 16}" font-weight="bold" text-anchor="middle" fill="${ink}">${esc(room.name)}</text>`);
      out.push(`<text x="${f(cx)}" y="${f(cz + (room.name ? (small ? 10 : 10) : 0))}" font-size="${small ? 11 : 14}" text-anchor="middle" fill="#444">${m2(room.areaM2)}</text>`);
      const extra = [!small && !art ? size : '', room.usableM2 !== undefined ? `${m2(room.usableM2)} usable` : ''].filter(Boolean).join(' · ');
      if (extra) out.push(`<text x="${f(cx)}" y="${f(cz + (room.name ? (small ? 23 : 28) : 18))}" font-size="${small ? 10 : 12}" text-anchor="middle" fill="#777">${extra}</text>`);
    });

    if (options.wallDimensions) out.push(wallDimensionLines(level, grid, label, X, Z, scale));

    // Overall dimensions and a scale bar.
    const dimY = pad.t - 24 - dimPad, dimX = pad.l - 30 - dimPad;
    const bx0 = house.minX, bx1 = house.maxX, bz0 = house.minZ, bz1 = house.maxZ;
    out.push(`<g stroke="#6b7280" stroke-width="1.2">`
      + `<line x1="${f(X(bx0))}" y1="${dimY}" x2="${f(X(bx1))}" y2="${dimY}"/>`
      + `<line x1="${f(X(bx0))}" y1="${dimY - 6}" x2="${f(X(bx0))}" y2="${dimY + 6}"/>`
      + `<line x1="${f(X(bx1))}" y1="${dimY - 6}" x2="${f(X(bx1))}" y2="${dimY + 6}"/>`
      + `<line x1="${dimX}" y1="${f(Z(bz0))}" x2="${dimX}" y2="${f(Z(bz1))}"/>`
      + `<line x1="${dimX - 6}" y1="${f(Z(bz0))}" x2="${dimX + 6}" y2="${f(Z(bz0))}"/>`
      + `<line x1="${dimX - 6}" y1="${f(Z(bz1))}" x2="${dimX + 6}" y2="${f(Z(bz1))}"/></g>`);
    out.push(`<text x="${f((X(bx0) + X(bx1)) / 2)}" y="${dimY - 8}" font-size="14" text-anchor="middle" fill="#374151">${metres(bx1 - bx0)}</text>`);
    const midZ = (Z(bz0) + Z(bz1)) / 2;
    out.push(`<text x="${dimX - 10}" y="${f(midZ)}" font-size="14" text-anchor="middle" fill="#374151" transform="rotate(-90 ${dimX - 10} ${f(midZ)})">${metres(bz1 - bz0)}</text>`);
    const span = maxX - minX;
    const bar = span > 12 ? 5 : span > 5 ? 2 : 1;
    const by = height - 40;
    out.push(`<rect x="${pad.l - dimPad}" y="${by}" width="${f(bar * scale)}" height="8" fill="${wallFill}"/>`);
    out.push(`<text x="${f(pad.l - dimPad + bar * scale + 10)}" y="${by + 9}" font-size="13" fill="#374151">${bar} m</text>`);
    if (art) {
      // North-ish arrow (the model's −z), bottom right.
      const nx = widthPx - pad.r + dimPad - 20, ny = height - 60;
      out.push(`<g transform="translate(${nx} ${ny})"><circle r="18" fill="#fff" stroke="#bfb3a5"/><polygon points="0,-13 6,6 0,2 -6,6" fill="#3b322b"/><text y="30" font-size="11" text-anchor="middle" fill="#6b5d50">N</text></g>`);
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${height}" viewBox="0 0 ${widthPx} ${height}" font-family="${esc(font)}">${out.join('')}</svg>`;
    return { level: level.level, elevation: +level.elevation.toFixed(2), rooms: planRooms, openings, svg };
  });
}

/** Each outside wall's length, on a dimension line just outside it. */
function wallDimensionLines(level: Level, grid: Grid, label: Int32Array, X: (x: number) => number, Z: (z: number) => number, scale: number) {
  const out: string[] = ['<g stroke="#6b7280" stroke-width="1" fill="none">'];
  const text: string[] = [];
  const outside = (x: number, z: number) => {
    const i = Math.floor((x - grid.x0) / CELL), j = Math.floor((z - grid.z0) / CELL);
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return true;
    return label[j * grid.nx + i] === 2;
  };
  for (const w of level.walls) {
    const r = joinedWall(w, level.walls);
    if (r.length < 0.8) continue;
    const [dx, dz] = r.dir;
    let [px, pz] = [-dz, dx];
    const probe = r.width / 2 + 0.15;
    if (outside(r.centre[0] + px * probe, r.centre[1] + pz * probe)) { /* this side */ }
    else if (outside(r.centre[0] - px * probe, r.centre[1] - pz * probe)) { px = -px; pz = -pz; }
    else continue; // an inside wall
    // A fixed gap on the page, clear of the opening tags (inside) and the overall dimensions (further out).
    const off = r.width / 2 + 16 / scale;
    const a: V2 = [r.centre[0] - dx * r.length / 2 + px * off, r.centre[1] - dz * r.length / 2 + pz * off];
    const b: V2 = [r.centre[0] + dx * r.length / 2 + px * off, r.centre[1] + dz * r.length / 2 + pz * off];
    const t = 5 / scale;
    out.push(`<line x1="${f(X(a[0]))}" y1="${f(Z(a[1]))}" x2="${f(X(b[0]))}" y2="${f(Z(b[1]))}"/>`);
    for (const p of [a, b]) {
      out.push(`<line x1="${f(X(p[0] - (dx - px) * t))}" y1="${f(Z(p[1] - (dz - pz) * t))}" x2="${f(X(p[0] + (dx - px) * t))}" y2="${f(Z(p[1] + (dz - pz) * t))}" stroke-width="1.4"/>`);
    }
    const mx = X((a[0] + b[0]) / 2 + px * 9 / scale), mz = Z((a[1] + b[1]) / 2 + pz * 9 / scale);
    let angle = Math.atan2(dz, dx) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    text.push(`<text x="${f(mx)}" y="${f(mz + 4)}" font-size="11" text-anchor="middle" fill="#374151" stroke="none" transform="rotate(${angle.toFixed(1)} ${f(mx)} ${f(mz)})">${r.length.toFixed(2)}</text>`);
  }
  out.push('</g>');
  return out.join('') + text.join('');
}

const GARDEN_TYPES = new Set(['tree', 'bush', 'rock', 'water', 'patio', 'fence', 'lamp', 'bench']);
const GARDEN_REACH = 6;

function gardenShapes(shapes: Shape[], house: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  return shapes.filter(s => !s.hidden && GARDEN_TYPES.has(s.type)
    && s.position[0] > house.minX - GARDEN_REACH && s.position[0] < house.maxX + GARDEN_REACH
    && s.position[2] > house.minZ - GARDEN_REACH && s.position[2] < house.maxZ + GARDEN_REACH
    && s.position[1] < 1.5);
}

function spreadOf(s: Shape, options: PlanOptions) {
  const custom = options.plantSpread?.(s);
  if (custom && custom > 0) return custom;
  const k = s.scale?.[0] ?? 1;
  if (s.type === 'tree') return 4 * k;
  if (s.type === 'bush') return 1.2 * k;
  if (s.type === 'rock') return 0.8 * k;
  return 0.6 * k;
}

function gardenOutline(s: Shape, options: PlanOptions): V2[] {
  const [px, , pz] = s.position;
  const pts = s.patioData?.points ?? s.waterData?.points ?? s.fenceData?.points;
  if (pts?.length) return pts.map(([x, z]) => [px + x, pz + z] as V2);
  const r = spreadOf(s, options) / 2;
  return [[px - r, pz - r], [px + r, pz + r]];
}

function drawGarden(s: Shape, options: PlanOptions, X: (x: number) => number, Z: (z: number) => number, scale: number): string {
  const [px, , pz] = s.position;
  const path = (pts: [number, number][], close: boolean) =>
    pts.map(([x, z], i) => `${i ? 'L' : 'M'} ${f(X(px + x))} ${f(Z(pz + z))}`).join(' ') + (close ? ' Z' : '');
  if (s.type === 'patio' && s.patioData?.points?.length) {
    const deck = s.patioData.kind === 'deck';
    return `<path d="${path(s.patioData.points, true)}" fill="url(#${deck ? 'decking' : 'paving'})" stroke="#a89c88" stroke-width="1.2"/>`;
  }
  if (s.type === 'water' && s.waterData?.points?.length) {
    return `<path d="${path(s.waterData.points, true)}" fill="url(#water)" stroke="#5aa9cf" stroke-width="2"/>`;
  }
  if (s.type === 'fence' && s.fenceData?.points?.length) {
    return `<path d="${path(s.fenceData.points, !!s.fenceData.closed)}" fill="none" stroke="#8b6b4a" stroke-width="3" stroke-linecap="round" stroke-dasharray="10 3"/>`;
  }
  const r = (spreadOf(s, options) / 2) * scale;
  const cx = f(X(px)), cy = f(Z(pz));
  if (s.type === 'tree') {
    return `<circle cx="${cx}" cy="${cy}" r="${f(r)}" fill="url(#canopy)" fill-opacity="0.9" stroke="#6a9656" stroke-width="1.2"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${f(Math.max(2, r * 0.12))}" fill="#7a5a3a"/>`;
  }
  if (s.type === 'bush') return `<circle cx="${cx}" cy="${cy}" r="${f(r)}" fill="#a8cf8c" stroke="#7aa865" stroke-width="1"/>`;
  if (s.type === 'rock') return `<circle cx="${cx}" cy="${cy}" r="${f(r)}" fill="#c9c4bb" stroke="#9b958b" stroke-width="1"/>`;
  if (s.type === 'lamp') return `<circle cx="${cx}" cy="${cy}" r="5" fill="#fcd34d" stroke="#b45309" stroke-width="1"/>`;
  return `<rect x="${f(X(px) - 12)}" y="${f(Z(pz) - 5)}" width="24" height="10" rx="2" fill="#b08a62"/>`;
}

/** Story tags for walls and floor slabs, from the height they stand on (the app's outliner and terrain levelling read these). */
export function withStoryTags(shapes: Shape[]): Shape[] {
  const levels = buildingLevels(shapes);
  if (!levels.length) return shapes;
  const storyOf = (base: number) => {
    let story = 1;
    for (const l of levels) if (base >= l.elevation - LEVEL_GAP) story = l.level;
    return story;
  };
  const isSlab = (s: Shape) => s.tags?.includes('floor-slab') || /floor slab/i.test(s.name ?? '');
  return shapes.map(s => {
    if (s.tags?.some(t => /^story-\d+$/.test(t))) return s;
    let base: number;
    if (s.type === 'wall') base = wallBase(s);
    else if (isSlab(s)) base = s.position[1] + 0.3;
    else return s;
    return { ...s, tags: [...(s.tags ?? []), `story-${storyOf(base)}`] };
  });
}
