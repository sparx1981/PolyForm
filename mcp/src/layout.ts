import * as THREE from 'three';
import type { Shape } from '../../src/types';
import { buildingLevels, roofHeadroom } from '../../src/lib/presentation/floorPlans';
import { detectRooms, type SpatialRoom } from '../../src/lib/spatial/rooms';
import { computeStairHoleForSlab } from '../../src/lib/archStairwell';
import { SPATIAL_DEFAULTS } from './rules';
import { inPolygon, orientation, stairFootprint, wallCorners, worldPoints } from './checks';

/**
 * Checks of how a building is used rather than whether it exists: can a door open, can a person walk
 * from the front door to every room, is there headroom on the stairs. They run on a plan grid of each
 * floor (walls, doors, furniture) and on the geometry above the stairs. Pure functions of the objects.
 */

type V2 = [number, number];

export interface LayoutIssue {
  severity: 'error' | 'warning' | 'info';
  code: 'door-swing' | 'unreachable-room' | 'furniture-blocks-route' | 'narrow-passage' | 'no-entrance' | 'no-stairs-to-level' | 'stair-headroom' | 'room-no-window';
  message: string;
  ids: string[];
  level?: number;
}

export interface LayoutReport {
  issues: LayoutIssue[];
  errors: number;
  warnings: number;
  info: number;
  /** Which checks actually ran, so a report never implies more than was checked. */
  checked: string[];
  /** Checks that could not run, and why. */
  skipped: string[];
}

const nums = (s: Shape) => (Array.isArray(s.args) ? (s.args as number[]) : []);
const LEVEL_GAP = 0.5;
/** Furniture below this height (rugs) does not block a walker, nor above the walker's head. */
const WALK_BAND: V2 = [0.15, 1.9];
const FIXED = new Set(['wall', 'door', 'window', 'staircase', 'terrain', 'patio', 'fence', 'water', 'tree', 'bush', 'rock', 'lamp', 'road']);

interface Grid {
  x0: number; z0: number; cell: number; nx: number; nz: number;
}

const idx = (g: Grid, i: number, j: number) => j * g.nx + i;

/** Marks the cells inside a convex plan polygon. */
function paint(g: Grid, mask: Uint8Array, poly: V2[], value = 1) {
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((Math.max(...xs) - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - g.z0) / g.cell)), j1 = Math.min(g.nz - 1, Math.ceil((Math.max(...zs) - g.z0) / g.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (inConvex([g.x0 + (i + 0.5) * g.cell, g.z0 + (j + 0.5) * g.cell], poly)) mask[idx(g, i, j)] = value;
  }
}

function inConvex(p: V2, poly: V2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) < 1e-12) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Distance from each free cell to the nearest blocked cell (two-pass chamfer, metres). */
function distances(g: Grid, blocked: Uint8Array): Float32Array {
  const d = new Float32Array(g.nx * g.nz);
  const BIG = 1e9, a = g.cell, b = g.cell * Math.SQRT2;
  for (let k = 0; k < d.length; k++) d[k] = blocked[k] ? 0 : BIG;
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const k = idx(g, i, j);
    if (i > 0) d[k] = Math.min(d[k], d[k - 1] + a);
    if (j > 0) { d[k] = Math.min(d[k], d[k - g.nx] + a); if (i > 0) d[k] = Math.min(d[k], d[k - g.nx - 1] + b); if (i < g.nx - 1) d[k] = Math.min(d[k], d[k - g.nx + 1] + b); }
  }
  for (let j = g.nz - 1; j >= 0; j--) for (let i = g.nx - 1; i >= 0; i--) {
    const k = idx(g, i, j);
    if (i < g.nx - 1) d[k] = Math.min(d[k], d[k + 1] + a);
    if (j < g.nz - 1) { d[k] = Math.min(d[k], d[k + g.nx] + a); if (i < g.nx - 1) d[k] = Math.min(d[k], d[k + g.nx + 1] + b); if (i > 0) d[k] = Math.min(d[k], d[k + g.nx - 1] + b); }
  }
  return d;
}

/** Cells reachable from `from` through cells that `pass` allows (4-connected). */
function flood(g: Grid, from: number[], pass: (k: number) => boolean): Uint8Array {
  const seen = new Uint8Array(g.nx * g.nz);
  const stack = from.filter(k => pass(k));
  for (const k of stack) seen[k] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % g.nx, j = (k - i) / g.nx;
    for (const n of [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, j > 0 ? k - g.nx : -1, j < g.nz - 1 ? k + g.nx : -1]) {
      if (n >= 0 && !seen[n] && pass(n)) { seen[n] = 1; stack.push(n); }
    }
  }
  return seen;
}

/** The plan rectangle of a shape, from its mesh (or box size), turned as the shape is. */
function planRect(s: Shape): V2[] | null {
  const q = orientation(s);
  const pos = s.geometryData?.positions as number[] | undefined;
  let minX: number, maxX: number, minZ: number, maxZ: number;
  if (pos && pos.length >= 9) {
    minX = Infinity; maxX = -Infinity; minZ = Infinity; maxZ = -Infinity;
    const sc = s.scale ?? [1, 1, 1];
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i] * sc[0]); maxX = Math.max(maxX, pos[i] * sc[0]);
      minZ = Math.min(minZ, pos[i + 2] * sc[2]); maxZ = Math.max(maxZ, pos[i + 2] * sc[2]);
    }
  } else if (s.type === 'box') {
    const [w = 1, , d = 1] = nums(s);
    minX = -w / 2; maxX = w / 2; minZ = -d / 2; maxZ = d / 2;
  } else if (s.type === 'cylinder') {
    const r = nums(s)[1] ?? 0.5;
    minX = -r; maxX = r; minZ = -r; maxZ = r;
  } else return null;
  return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].map(([x, z]) => {
    const v = new THREE.Vector3(x, 0, z).applyQuaternion(q);
    return [s.position[0] + v.x, s.position[2] + v.z] as V2;
  });
}

const isStructure = (s: Shape) =>
  FIXED.has(s.type) || s.hidden || s.tags?.some(t => t === 'architecture' || t.startsWith('roof') || t === 'porch' || t === 'floor-slab' || t === 'ceiling-slab' || t === 'foundation-skirt')
  || s.roofData !== undefined || /slab|skirt|ceiling|roof|railing/i.test(s.name ?? '');

/** Furniture and fittings that stand in the way of someone walking across floor `elevation`. */
function obstaclesAt(shapes: Shape[], elevation: number): { shape: Shape; rect: V2[] }[] {
  const out: { shape: Shape; rect: V2[] }[] = [];
  for (const s of shapes) {
    if (isStructure(s)) continue;
    const points = worldPoints(s, 200);
    if (!points.length) continue;
    const low = Math.min(...points.map(p => p.y)) - elevation, high = Math.max(...points.map(p => p.y)) - elevation;
    // Only what stands on this storey's floor and rises into the walker's height.
    if (high < WALK_BAND[0] || low > WALK_BAND[1] || low < -0.5) continue;
    const rect = planRect(s);
    if (rect) out.push({ shape: s, rect });
  }
  return out;
}

const isSliding = (d: Shape) => /slid|bifold|roller|garage|pocket|curtain/i.test(`${d.archStyle ?? ''} ${d.name ?? ''}`);

function doorBand(door: Shape, wall: Shape | undefined, along: number, out: number): V2[] {
  const width = nums(door)[0] ?? 0.9;
  const thick = wall ? (nums(wall)[2] ?? 0.2) : 0.2;
  const d = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation(wall ?? door));
  const dir: V2 = [d.x, d.z], perp: V2 = [-dir[1], dir[0]];
  const [cx, cz] = [door.position[0], door.position[2]];
  const a = (width + along) / 2, b = thick / 2 + out;
  return [[cx - dir[0] * a - perp[0] * b, cz - dir[1] * a - perp[1] * b], [cx + dir[0] * a - perp[0] * b, cz + dir[1] * a - perp[1] * b], [cx + dir[0] * a + perp[0] * b, cz + dir[1] * a + perp[1] * b], [cx - dir[0] * a + perp[0] * b, cz - dir[1] * a + perp[1] * b]];
}

/** Whether a door's leaf can swing: a square of the door's width on at least one side must be clear. */
function swingSides(g: Grid, solid: Uint8Array, door: Shape, wall: Shape): [boolean, boolean] {
  const width = nums(door)[0] ?? 0.9;
  const thick = nums(wall)[2] ?? 0.2;
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation(wall));
  const normal: V2 = [n.x, n.z], along = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation(wall));
  const dir: V2 = [along.x, along.z];
  const clear = (side: number) => {
    const near = thick / 2 + 0.02, far = thick / 2 + width + SPATIAL_DEFAULTS.doorSwingBuffer;
    const c = (u: number, v: number): V2 => [door.position[0] + dir[0] * u + normal[0] * side * v, door.position[2] + dir[1] * u + normal[1] * side * v];
    const half = width / 2 + SPATIAL_DEFAULTS.doorSwingBuffer;
    const poly: V2[] = [c(-half, near), c(half, near), c(half, far), c(-half, far)];
    const probe = new Uint8Array(solid.length);
    paint(g, probe, poly);
    for (let k = 0; k < probe.length; k++) if (probe[k] && solid[k]) return false;
    return true;
  };
  return [clear(1), clear(-1)];
}

export function checkLayout(shapes: Shape[], opts: { circulationWidth?: number; localWidth?: number } = {}): LayoutReport {
  const issues: LayoutIssue[] = [];
  const checked: string[] = [];
  const skipped: string[] = [];
  const primary = opts.circulationWidth ?? SPATIAL_DEFAULTS.primaryCirculationWidth;
  const local = opts.localWidth ?? SPATIAL_DEFAULTS.secondaryCirculationWidth;
  const levels = buildingLevels(shapes);
  if (!levels.length) {
    return { issues, errors: 0, warnings: 0, info: 0, checked, skipped: ['No walls, so there is no building to check.'] };
  }
  const rooms = detectRooms(shapes);
  const wallById = new Map(shapes.filter(s => s.type === 'wall').map(w => [w.id, w]));
  const stairs = shapes.filter(s => s.type === 'staircase' && !s.hidden);
  let ranDoors = false, ranCirculation = false;

  for (const level of levels) {
    const walls = level.walls;
    const corners = walls.flatMap(w => wallCorners(w));
    const xs = corners.map(p => p[0]), zs = corners.map(p => p[1]);
    let cell = 0.05;
    const w = Math.max(...xs) - Math.min(...xs) + 4, h = Math.max(...zs) - Math.min(...zs) + 4;
    while ((w / cell) * (h / cell) > 600_000) cell *= 1.5;
    const g: Grid = { x0: Math.min(...xs) - 2, z0: Math.min(...zs) - 2, cell, nx: Math.ceil(w / cell), nz: Math.ceil(h / cell) };

    const wallMask = new Uint8Array(g.nx * g.nz);
    for (const wall of walls) paint(g, wallMask, wallCorners(wall));
    const doors = level.openings.filter(o => o.type === 'door');
    // Doorways: carve them out of the walls so people can pass.
    const doorMask = new Uint8Array(wallMask.length);
    for (const d of doors) paint(g, doorMask, doorBand(d, wallById.get(d.hostWallId ?? ''), 0, 0.1));
    const open = new Uint8Array(wallMask.length);
    for (let k = 0; k < open.length; k++) open[k] = wallMask[k] && !doorMask[k] ? 1 : 0;

    const obstacles = obstaclesAt(shapes, level.elevation);
    const furnMask = new Uint8Array(wallMask.length);
    for (const o of obstacles) paint(g, furnMask, o.rect);

    // Door swing: the leaf needs a clear square on one side.
    for (const d of doors) {
      const wall = wallById.get(d.hostWallId ?? '');
      if (!wall || isSliding(d)) continue;
      ranDoors = true;
      const solid = new Uint8Array(wallMask.length);
      for (let k = 0; k < solid.length; k++) solid[k] = (open[k] || furnMask[k]) && !doorMask[k] ? 1 : 0;
      const [a, b] = swingSides(g, solid, d, wall);
      if (!a && !b) {
        issues.push({ severity: 'warning', code: 'door-swing', level: level.level, ids: [d.id], message: `Door ${d.id} cannot swing open fully on either side: something (a wall, furniture or the room corner) is within ${round(nums(d)[0] ?? 0.9)} m of it. Move the furniture, shift the door along its wall, or make it a sliding or outward-opening door.` });
      }
    }

    // Circulation: from the way in, can a walker of the given width reach every room?
    const blockedNoFurn = open;
    const blocked = new Uint8Array(open.length);
    for (let k = 0; k < blocked.length; k++) blocked[k] = open[k] || furnMask[k] ? 1 : 0;
    const closed = new Uint8Array(open.length);
    for (let k = 0; k < closed.length; k++) closed[k] = wallMask[k] ? 1 : 0;
    const outside = flood(g, [0], k => !closed[k]);

    const toCell = (p: V2) => idx(g, Math.floor((p[0] - g.x0) / g.cell), Math.floor((p[1] - g.z0) / g.cell));
    let sources: number[] = [];
    if (level.level === 1) {
      for (const d of doors) {
        const wall = wallById.get(d.hostWallId ?? '');
        if (!wall) continue;
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation(wall));
        const t = (nums(wall)[2] ?? 0.2) / 2 + 0.3;
        const a: V2 = [d.position[0] + n.x * t, d.position[2] + n.z * t], b: V2 = [d.position[0] - n.x * t, d.position[2] - n.z * t];
        const ka = toCell(a), kb = toCell(b);
        if (outside[ka] && !outside[kb]) sources.push(kb);
        else if (outside[kb] && !outside[ka]) sources.push(ka);
      }
      if (!sources.length) {
        issues.push({ severity: 'warning', code: 'no-entrance', level: level.level, ids: [], message: 'No door leads in from outside on the ground floor, so there is no way in to check routes from.' });
        continue;
      }
    } else {
      // Upstairs, people arrive by the stairs.
      for (const s of stairs) {
        const f = stairFootprint(s);
        if (Math.abs(f.top - level.elevation) > LEVEL_GAP) continue;
        const reach = f.length / 2 + 0.45;
        sources.push(toCell([f.centre[0] + f.climb[0] * reach, f.centre[1] + f.climb[1] * reach]));
      }
      if (!sources.length) {
        issues.push({ severity: 'warning', code: 'no-stairs-to-level', level: level.level, ids: [], message: `Level ${level.level} has no stairs arriving at it, so it cannot be reached on foot.` });
        continue;
      }
    }
    ranCirculation = true;

    const reachWith = (width: number, withFurniture: boolean) => {
      const free = withFurniture ? blocked : blockedNoFurn;
      const dist = distances(g, free);
      return flood(g, sources, k => !free[k] && (dist[k] >= width / 2 - g.cell || doorMask[k] === 1));
    };
    const local75 = reachWith(local, true), local75NoFurn = reachWith(local, false), wide = reachWith(primary, true);
    for (const room of rooms.filter(r => Math.abs(r.elevation - level.elevation) < LEVEL_GAP)) {
      const inside = cellsIn(g, room);
      if (!inside.length) continue;
      const some = (m: Uint8Array) => inside.some(k => m[k]);
      const name = room.name ?? `room ${room.id.slice(0, 12)}`;
      if (!some(local75)) {
        issues.push(some(local75NoFurn)
          ? { severity: 'error', code: 'furniture-blocks-route', level: level.level, ids: [room.id], message: `Furniture blocks the way into ${name}: it can be reached with the furniture removed but not with it in place at ${local} m wide. Move the furniture that stands in front of a door or in a passage.` }
          : { severity: 'error', code: 'unreachable-room', level: level.level, ids: [room.id], message: `${name} cannot be reached on foot at ${local} m wide: no doorway or passage leads to it (or the doors are too narrow).` });
      } else if (!some(wide)) {
        issues.push({ severity: 'warning', code: 'narrow-passage', level: level.level, ids: [room.id], message: `The route into ${name} narrows below ${primary} m somewhere (between walls, furniture or a door). It is passable at ${local} m.` });
      }
    }
  }
  if (ranDoors) checked.push('door swing'); else skipped.push('door swing: no hinged doors found');
  if (ranCirculation) checked.push('circulation (can every room be reached on foot)'); else skipped.push('circulation: no entrance or stairs to start from');

  // Stairs: headroom above the travelled line.
  if (stairs.length) {
    checked.push('stair headroom');
    for (const stair of stairs) issues.push(...stairHeadroom(shapes, stair, levels));
  } else skipped.push('stair headroom: no stairs');

  checked.push('rooms with no window');
  for (const room of rooms) {
    const windows = room.openingIds.filter(id => shapes.find(s => s.id === id)?.type === 'window');
    if (!windows.length && room.areaM2 >= 4) {
      issues.push({ severity: 'info', code: 'room-no-window', ids: [room.id], level: room.level, message: `${room.name ?? 'A room'} (${round(room.areaM2, 1)} m²) has no window. Fine for a hall, bathroom or store; add one for a habitable room.` });
    }
  }

  const count = (s: LayoutIssue['severity']) => issues.filter(i => i.severity === s).length;
  return { issues, errors: count('error'), warnings: count('warning'), info: count('info'), checked, skipped };
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

function cellsIn(g: Grid, room: SpatialRoom): number[] {
  const out: number[] = [];
  const xs = room.boundary.map(p => p[0]), zs = room.boundary.map(p => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((Math.max(...xs) - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - g.z0) / g.cell)), j1 = Math.min(g.nz - 1, Math.ceil((Math.max(...zs) - g.z0) / g.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (inPolygon([g.x0 + (i + 0.5) * g.cell, g.z0 + (j + 0.5) * g.cell], room.boundary)) out.push(idx(g, i, j));
  }
  return out;
}

/**
 * The lowest clear height above the steps along a flight, against the floor above (where it has no
 * stairwell opening) and the roof above. Reported against the 2.0 m target; it is a design target, not a code test.
 */
function stairHeadroom(shapes: Shape[], stair: Shape, levels: ReturnType<typeof buildingLevels>): LayoutIssue[] {
  const f = stairFootprint(stair);
  const rise = f.top - f.bottom;
  const slabs = shapes.filter(s => s.type === 'poly' && !s.hidden && (s.tags?.includes('floor-slab') || /floor slab/i.test(s.name ?? '')) && s.position[1] > f.bottom + 0.5);
  const outlines = slabs.map(slab => {
    const verts = (slab.args as any)?.vertices as V2[] | undefined;
    const thickness = (slab.args as any)?.height ?? 0.2;
    return verts ? { slab, poly: verts.map(([x, z]) => [slab.position[0] + x, slab.position[2] + z] as V2), under: slab.position[1] - thickness / 2 } : null;
  }).filter((x): x is { slab: Shape; poly: V2[]; under: number } => !!x);
  const wells = slabs.map(slab => computeStairHoleForSlab(stair, slab)?.worldPolygon as V2[] | undefined).filter((p): p is V2[] => !!p);
  const roof = roofHeadroom(shapes, levels);
  const upper = [...levels].reverse().find(l => l.elevation <= f.top + LEVEL_GAP)?.elevation ?? f.top;
  const [px, pz] = [f.centre[0], f.centre[1]];
  const steps = Math.max(6, Math.round(f.length / 0.3));
  let worst = Infinity, at: V2 = [px, pz];
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    const x = f.centre[0] + f.climb[0] * (t - 0.5) * f.length, z = f.centre[1] + f.climb[1] * (t - 0.5) * f.length;
    const tread = f.bottom + rise * t;
    let ceiling = Infinity;
    for (const o of outlines) {
      if (inPolygon([x, z], o.poly) && !wells.some(w => inPolygon([x, z], w)) && o.under > tread + 0.05) ceiling = Math.min(ceiling, o.under);
    }
    if (roof) ceiling = Math.min(ceiling, upper + roof(x, z, upper));
    if (ceiling - tread < worst) { worst = ceiling - tread; at = [x, z]; }
  }
  if (!Number.isFinite(worst) || worst >= SPATIAL_DEFAULTS.targetHeadroom) return [];
  return [{
    severity: 'warning', code: 'stair-headroom', ids: [stair.id],
    message: `Headroom over the stairs drops to ${round(worst)} m near [${round(at[0])}, ${round(at[1])}] (target ${SPATIAL_DEFAULTS.targetHeadroom} m). Check the stairwell opening and any sloping roof above; move or turn the stairs, or enlarge the opening.`,
  }];
}
