import * as THREE from 'three';
import type { Shape } from '../../src/types';

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
  /** Width (x) and depth (z) of the room's bounding box, metres. */
  size: V2;
}

export interface FloorPlan {
  level: number;
  /** Floor height of this storey, metres. */
  elevation: number;
  rooms: PlanRoom[];
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
    return Math.abs(u) <= q.length / 2 + q.width / 2 + 0.02 && Math.abs(v) <= q.width / 2 + 0.02;
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

/** Floor plans for every storey, or none when the model has no walls. */
export function floorPlans(shapes: Shape[], labels: RoomLabel[] = [], widthPx = 1000): FloorPlan[] {
  const levels = buildingLevels(shapes);
  if (!levels.length) return [];

  // One scale and frame for every storey, so the plans line up.
  const pts = levels.flatMap(l => l.walls.flatMap(w => corners(wallRect(w))));
  const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
  const minZ = Math.min(...pts.map(p => p[1])), maxZ = Math.max(...pts.map(p => p[1]));
  const grid: Grid = {
    x0: minX - 1, z0: minZ - 1,
    nx: Math.ceil((maxX - minX + 2) / CELL), nz: Math.ceil((maxZ - minZ + 2) / CELL),
  };
  const pad = { l: 90, r: 50, t: 140, b: 90 };
  const scale = Math.min((widthPx - pad.l - pad.r) / Math.max(maxX - minX, 1), 900 / Math.max(maxZ - minZ, 1));
  const height = Math.round(pad.t + pad.b + (maxZ - minZ) * scale);
  const X = (x: number) => pad.l + (x - minX) * scale;
  const Z = (z: number) => pad.t + (z - minZ) * scale;
  const poly = (ps: V2[]) => ps.map(p => `${f(X(p[0]))},${f(Z(p[1]))}`).join(' ');

  return levels.map(level => {
    const { rooms, label } = findRooms(level, grid, labels);
    const out: string[] = [];
    const title = `Level ${level.level} · ${LEVEL_NAMES[level.level - 1] ?? `Floor ${level.level}`}`;
    out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
    out.push(`<text x="${pad.l}" y="44" font-size="26" font-weight="bold" fill="#111">${esc(title)}</text>`);
    out.push(`<text x="${pad.l}" y="72" font-size="15" fill="#666">Floor at ${metres(level.elevation)} · ${rooms.length} room${rooms.length === 1 ? '' : 's'} · x →, z ↓</text>`);

    // Rooms (tinted), then walls on top.
    const planRooms: PlanRoom[] = [];
    rooms.forEach(r => {
      const x = grid.x0 + r.minI * CELL, z = grid.z0 + r.minJ * CELL;
      const w = (r.maxI - r.minI + 1) * CELL, d = (r.maxJ - r.minJ + 1) * CELL;
      planRooms.push({ name: r.name, areaM2: +(r.cells * CELL * CELL).toFixed(1), size: [+w.toFixed(2), +d.toFixed(2)] });
      // The room's own cells, row by row (so L-shaped rooms tint correctly), tucked under the walls.
      for (let j = r.minJ; j <= r.maxJ; j++) {
        let i = r.minI;
        while (i <= r.maxI) {
          if (label[j * grid.nx + i] !== r.id) { i++; continue; }
          const start = i;
          while (i <= r.maxI && label[j * grid.nx + i] === r.id) i++;
          const rx = grid.x0 + (start - 1) * CELL, rz = grid.z0 + (j - 1) * CELL;
          out.push(`<rect x="${f(X(rx))}" y="${f(Z(rz))}" width="${f((i - start + 2) * CELL * scale)}" height="${f(3 * CELL * scale)}" fill="#f5f1e8"/>`);
        }
      }
    });
    for (const w of level.walls) out.push(`<polygon points="${poly(corners(joinedWall(w, level.walls)))}" fill="#1f2937"/>`);

    for (const o of level.openings) {
      const host = level.walls.find(w => w.id === o.hostWallId)!;
      const wr = wallRect(host);
      const [ow = 0.9] = nums(o);
      const r: Rect = { centre: [o.position[0], o.position[2]], dir: wr.dir, length: ow, width: wr.width + 0.02 };
      out.push(`<polygon points="${poly(corners(r))}" fill="#ffffff"/>`);
      const [a, b, c, d] = corners({ ...r, width: wr.width });
      if (o.type === 'window') {
        out.push(`<polygon points="${poly([a, b, c, d])}" fill="#e0f2fe" stroke="#0369a1" stroke-width="1.5"/>`);
        const mid: Rect = { ...r, width: 0.001 };
        const [m1, m2p] = corners(mid);
        out.push(`<line x1="${f(X(m1[0]))}" y1="${f(Z(m1[1]))}" x2="${f(X(m2p[0]))}" y2="${f(Z(m2p[1]))}" stroke="#0369a1" stroke-width="1.5"/>`);
      } else {
        // Door leaf swung 90° to one side, hinged at the opening's start jamb, with its arc.
        const [dx, dz] = r.dir;
        const [px, pz] = [-dz, dx];
        const hinge: V2 = [r.centre[0] - dx * ow / 2 + px * wr.width / 2, r.centre[1] - dz * ow / 2 + pz * wr.width / 2];
        const leaf: V2 = [hinge[0] + px * ow, hinge[1] + pz * ow];
        const end: V2 = [hinge[0] + dx * ow, hinge[1] + dz * ow];
        const sweep = dx * pz - dz * px > 0 ? 0 : 1;
        out.push(`<line x1="${f(X(hinge[0]))}" y1="${f(Z(hinge[1]))}" x2="${f(X(leaf[0]))}" y2="${f(Z(leaf[1]))}" stroke="#374151" stroke-width="2"/>`);
        out.push(`<path d="M ${f(X(leaf[0]))} ${f(Z(leaf[1]))} A ${f(ow * scale)} ${f(ow * scale)} 0 0 ${sweep} ${f(X(end[0]))} ${f(Z(end[1]))}" fill="none" stroke="#9ca3af" stroke-width="1.2" stroke-dasharray="4 3"/>`);
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
      if (room.name) out.push(`<text x="${f(cx)}" y="${f(cz - (small ? 4 : 10))}" font-size="${small ? 12 : 16}" font-weight="bold" text-anchor="middle" fill="#111">${esc(room.name)}</text>`);
      out.push(`<text x="${f(cx)}" y="${f(cz + (room.name ? (small ? 10 : 10) : 0))}" font-size="${small ? 11 : 14}" text-anchor="middle" fill="#444">${m2(room.areaM2)}</text>`);
      if (!small) out.push(`<text x="${f(cx)}" y="${f(cz + (room.name ? 28 : 18))}" font-size="12" text-anchor="middle" fill="#777">${size}</text>`);
    });

    // Overall dimensions and a scale bar.
    const dimY = pad.t - 24, dimX = pad.l - 30;
    out.push(`<g stroke="#6b7280" stroke-width="1.2">`
      + `<line x1="${f(X(minX))}" y1="${dimY}" x2="${f(X(maxX))}" y2="${dimY}"/>`
      + `<line x1="${f(X(minX))}" y1="${dimY - 6}" x2="${f(X(minX))}" y2="${dimY + 6}"/>`
      + `<line x1="${f(X(maxX))}" y1="${dimY - 6}" x2="${f(X(maxX))}" y2="${dimY + 6}"/>`
      + `<line x1="${dimX}" y1="${f(Z(minZ))}" x2="${dimX}" y2="${f(Z(maxZ))}"/>`
      + `<line x1="${dimX - 6}" y1="${f(Z(minZ))}" x2="${dimX + 6}" y2="${f(Z(minZ))}"/>`
      + `<line x1="${dimX - 6}" y1="${f(Z(maxZ))}" x2="${dimX + 6}" y2="${f(Z(maxZ))}"/></g>`);
    out.push(`<text x="${f((X(minX) + X(maxX)) / 2)}" y="${dimY - 8}" font-size="14" text-anchor="middle" fill="#374151">${metres(maxX - minX)}</text>`);
    const midZ = (Z(minZ) + Z(maxZ)) / 2;
    out.push(`<text x="${dimX - 10}" y="${f(midZ)}" font-size="14" text-anchor="middle" fill="#374151" transform="rotate(-90 ${dimX - 10} ${f(midZ)})">${metres(maxZ - minZ)}</text>`);
    const bar = maxX - minX > 12 ? 5 : maxX - minX > 5 ? 2 : 1;
    const by = height - 40;
    out.push(`<rect x="${pad.l}" y="${by}" width="${f(bar * scale)}" height="8" fill="#1f2937"/>`);
    out.push(`<text x="${f(pad.l + bar * scale + 10)}" y="${by + 9}" font-size="13" fill="#374151">${bar} m</text>`);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${height}" viewBox="0 0 ${widthPx} ${height}" font-family="DejaVu Sans">${out.join('')}</svg>`;
    return { level: level.level, elevation: +level.elevation.toFixed(2), rooms: planRooms, svg };
  });
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
