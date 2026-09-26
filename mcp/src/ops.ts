import * as THREE from 'three';
import type { Shape } from '../../src/types';
import { DeveloperSDK } from '../../src/services/developerService';
import { sampleTerrainElevation } from '../../src/lib/archRoomAssembly';
import { defaultWaterLevel } from '../../src/lib/water/waterBody';
import { fenceStyleInfo } from '../../src/lib/fence/fenceTypes';
import type { FenceStyle } from '../../src/lib/fence/fenceTypes';
import { DEFAULT_PATIO_TEMPLATE, type PatioKind, type PatioToolSettings } from '../../src/lib/patio/patioTypes';
import { makePatioShape, patioGroundHelpers, patioLevel, patioWallEdges, terrainAt, wallFaces } from '../../src/lib/patio/patioPlacement';
import { polygonArea, denseOutline, type Vec2 } from '../../src/lib/patio/patioGeometry';
import { LANDSCAPE_TEXTURES } from '../../src/lib/landscapeTextures';
import { ToolError } from './store';

export type Vec3 = [number, number, number];

export const newId = () => Math.random().toString(36).slice(2, 11);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const r3 = (v: readonly number[]) => v.map(n => round(n)) as number[];

/** Plain-words size of an object (metres), from the arguments each type is built from. */
export function sizeOf(s: Shape): string | undefined {
  const a = Array.isArray(s.args) ? (s.args as number[]) : [];
  switch (s.type) {
    case 'box': case 'rect': return `${round(a[0])} × ${round(a[1])} × ${round(a[2])} m (w × h × d)`;
    case 'wall': return `${round(a[0])} m long, ${round(a[1])} m high, ${round(a[2])} m thick`;
    case 'door': case 'window': return `${round(a[0])} × ${round(a[1])} m`;
    case 'sphere': case 'dome': return `radius ${round(a[0])} m`;
    case 'cylinder': return `radius ${round(a[1])} m, height ${round(a[2])} m`;
    case 'cone': case 'pyramid': return `radius ${round(a[0])} m, height ${round(a[1])} m`;
    case 'donut': return `radius ${round(a[0])} m, tube ${round(a[1])} m`;
    case 'terrain': return s.terrainData ? `${round(s.terrainData.width)} × ${round(s.terrainData.depth)} m` : undefined;
    case 'fence': return s.fenceData ? `${round(a[0] ?? 0)} m run, ${round(s.fenceData.height)} m high` : undefined;
    case 'patio': return s.patioData ? `${round(polygonArea(denseOutline(s.patioData.points, s.patioData.bulges ?? [], 0.25).points))} m² ${s.patioData.kind}` : undefined;
    case 'water': return s.waterData ? `${round(polygonArea(s.waterData.points))} m², ${round(s.waterData.depth)} m deep` : undefined;
    default: return undefined;
  }
}

function rotationDeg(s: Shape): number[] | undefined {
  let e: THREE.Euler | undefined;
  if (s.quaternion) e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...s.quaternion));
  else if (s.rotation) e = new THREE.Euler(...s.rotation);
  if (!e) return undefined;
  const deg = [e.x, e.y, e.z].map(r => round(THREE.MathUtils.radToDeg(r), 1));
  return deg.every(d => d === 0) ? undefined : deg;
}

/** A compact line about one object, for lists. */
export function describe(s: Shape) {
  return {
    id: s.id,
    name: s.name ?? s.type,
    type: s.type,
    position: r3(s.position),
    rotationDeg: rotationDeg(s),
    size: sizeOf(s),
    color: s.color,
    material: s.materialPreset,
    hidden: s.hidden || undefined,
    inWall: s.hostWallId,
  };
}

/** Full detail of one object, without bulky mesh data. */
export function detail(s: Shape) {
  const { geometryData, terrainData, ...rest } = s as any;
  const out: any = { ...rest };
  if (geometryData) out.geometryData = '(mesh data omitted)';
  if (terrainData) {
    const { heights, heightMap, ...t } = terrainData;
    let lowest = Infinity, highest = -Infinity;
    for (const h of heights ?? []) { if (h < lowest) lowest = h; if (h > highest) highest = h; }
    out.terrainData = {
      ...t,
      heights: heights ? `(${heights.length} heights omitted)` : undefined,
      heightRange: heights?.length ? { lowest: round(lowest), highest: round(highest) } : undefined,
    };
  }
  return out;
}

/** An overview of a whole model. */
export function summarize(shapes: Shape[]) {
  const counts: Record<string, number> = {};
  const box = new THREE.Box3();
  let wallLength = 0, patioArea = 0, deckArea = 0, fenceLength = 0;
  for (const s of shapes) {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
    if (s.type !== 'measurement') box.expandByPoint(new THREE.Vector3(...s.position));
    const a = Array.isArray(s.args) ? (s.args as number[]) : [];
    if (s.type === 'wall') wallLength += a[0] ?? 0;
    if (s.type === 'fence') fenceLength += a[0] ?? 0;
    if (s.type === 'patio' && s.patioData) {
      const area = polygonArea(denseOutline(s.patioData.points, s.patioData.bulges ?? [], 0.25).points);
      if (s.patioData.kind === 'deck') deckArea += area; else patioArea += area;
    }
    if (s.type === 'terrain' && s.terrainData) {
      box.expandByPoint(new THREE.Vector3(s.position[0] - s.terrainData.width / 2, s.position[1], s.position[2] - s.terrainData.depth / 2));
      box.expandByPoint(new THREE.Vector3(s.position[0] + s.terrainData.width / 2, s.position[1], s.position[2] + s.terrainData.depth / 2));
    }
  }
  return {
    objects: shapes.length,
    byType: counts,
    extent: box.isEmpty() ? undefined : { min: r3(box.min.toArray()), max: r3(box.max.toArray()) },
    totals: {
      wallLengthM: round(wallLength) || undefined,
      fenceLengthM: round(fenceLength) || undefined,
      patioAreaM2: round(patioArea) || undefined,
      deckAreaM2: round(deckArea) || undefined,
    },
  };
}

/**
 * Runs the app's own scripting library against a list of objects, so the connector builds
 * rooms, walls, roofs, stairs, terrain, plants and materials exactly as `sdk.*` scripts do.
 */
export function withSdk<T>(shapes: Shape[], run: (sdk: any) => T): { shapes: Shape[]; result: T; created: Shape[]; log: string[] } {
  let current = shapes;
  const log: string[] = [];
  const setShapes = (u: Shape[] | ((prev: Shape[]) => Shape[])) => { current = typeof u === 'function' ? u(current) : u; };
  const updateColor = (id: string, color: string) => setShapes(prev => prev.map(s => (s.id === id ? { ...s, color } : s)));
  const sdk: any = new DeveloperSDK(current, setShapes, updateColor, null, {});
  sdk.log = (message: string) => log.push(message);
  const before = new Set(shapes.map(s => s.id));
  const result = run(sdk);
  return { shapes: current, result, created: current.filter(s => !before.has(s.id)), log };
}

export function findShape(shapes: Shape[], id: string): Shape {
  const s = shapes.find(x => x.id === id) ?? shapes.find(x => x.name?.toLowerCase() === id.toLowerCase());
  if (!s) throw new ToolError(`No object "${id}" in this model. Use list_objects to find ids.`);
  return s;
}

function orientation(s: Shape): THREE.Quaternion {
  if (s.quaternion) return new THREE.Quaternion(...s.quaternion);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0, 0, 0])));
}

/**
 * A door or window set into a wall, placed the way the app's door and window tools place them
 * (the wall then cuts its own opening). `along` is the distance from the wall's start end to the
 * opening's centre; by default the middle of the wall.
 */
export function openingInWall(wall: Shape, kind: 'door' | 'window', opts: { along?: number; width?: number; height?: number; sill?: number; color?: string; name?: string }): Shape {
  if (wall.type !== 'wall' || !Array.isArray(wall.args)) throw new ToolError(`"${wall.name ?? wall.id}" is not a wall.`);
  const [wallLen, wallH, wallT = 0.2] = wall.args as number[];
  const width = opts.width ?? (kind === 'door' ? 0.9 : 1.2);
  const height = opts.height ?? (kind === 'door' ? 2.1 : 1.2);
  const sill = kind === 'door' ? 0 : opts.sill ?? 0.9;
  if (width >= wallLen) throw new ToolError(`The ${kind} (${width} m) is wider than the wall (${round(wallLen)} m).`);
  if (sill + height > wallH) throw new ToolError(`The ${kind} is taller than the wall (${round(wallH)} m).`);
  const maxX = wallLen / 2 - width / 2;
  const localX = Math.max(-maxX, Math.min(maxX, (opts.along ?? wallLen / 2) - wallLen / 2));
  const localY = -wallH / 2 + sill + height / 2;
  const q = orientation(wall);
  const world = new THREE.Vector3(localX, localY, 0).applyQuaternion(q).add(new THREE.Vector3(...wall.position));
  return {
    id: newId(),
    name: opts.name ?? (kind === 'door' ? 'Door' : 'Window'),
    type: kind,
    position: [world.x, world.y, world.z],
    quaternion: [q.x, q.y, q.z, q.w],
    args: [width, height, wallT],
    color: opts.color ?? '#ffffff',
    roughness: 0.4,
    metalness: 0.05,
    opacity: 1,
    hostWallId: wall.id,
  };
}

/** Ground height at a point: the terrain there, or 0. */
export function groundAt(shapes: Shape[]) {
  return patioGroundHelpers(shapes, new Map(), sampleTerrainElevation).originalGround;
}

function outlineLength(points: Vec2[], closed: boolean) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 2) length += Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]);
  return length;
}

/** A fence run through ground points [x, z], as the fence tool makes one. */
export function fenceRun(shapes: Shape[], points: Vec2[], opts: { closed?: boolean; style?: FenceStyle; height?: number; color?: string; finish?: string }): Shape {
  if (points.length < 2) throw new ToolError('A fence needs at least 2 points.');
  const closed = !!opts.closed && points.length > 2;
  const style = opts.style ?? 'post-rail';
  const height = opts.height ?? 1.25;
  const color = opts.color ?? '#7a5a3a';
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cz = points.reduce((a, p) => a + p[1], 0) / points.length;
  const length = outlineLength(points, closed);
  const count = shapes.filter(s => s.type === 'fence').length + 1;
  return {
    id: newId(),
    name: `${fenceStyleInfo(style).label} Fence ${count} (${round(length, 1)} m)`,
    type: 'fence',
    position: [cx, 0, cz],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    args: [length, height],
    color,
    fenceData: {
      points: points.map(([x, z]) => [x - cx, z - cz] as Vec2),
      closed,
      style,
      height,
      seed: Math.floor(Math.random() * 12) + 1,
      finish: (opts.finish ?? 'weathered') as any,
      color,
    },
  };
}

/** A pond or lake filling an outline of ground points, as the water tool makes one. */
export function waterBody(shapes: Shape[], points: Vec2[], opts: { depth?: number; clarity?: string; level?: number }): Shape {
  if (points.length < 3) throw new ToolError('A pond needs at least 3 points.');
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cz = points.reduce((a, p) => a + p[1], 0) / points.length;
  const terrain = terrainAt(shapes, cx, cz);
  const level = opts.level ?? (terrain
    ? defaultWaterLevel(points.map(([x, z]) => ({ x, z })), (x, z) => sampleTerrainElevation(x, z, terrain))
    : 0.02);
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const kind = extent > 30 ? 'Lake' : 'Pond';
  return {
    id: newId(),
    name: `${kind} ${shapes.filter(s => s.type === 'water').length + 1}`,
    type: 'water',
    position: [cx, level, cz],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    args: [],
    color: '#3d7a8c',
    waterData: {
      points: points.map(([x, z]) => [x - cx, z - cz] as Vec2),
      depth: opts.depth ?? 1.2,
      clarity: (opts.clarity ?? 'lake') as any,
      dig: true,
    },
  };
}

/**
 * A patio or deck over an outline of ground points, levelled like the patio tool: with the house
 * floor when an edge runs along a wall, otherwise on the ground.
 */
export function patioOrDeck(shapes: Shape[], points: Vec2[], opts: {
  kind: PatioKind;
  bulges?: number[];
  deckHeight?: number;
  level?: number;
  settings?: Partial<PatioToolSettings['template']>;
}): Shape {
  if (points.length < 3) throw new ToolError('A patio or deck needs at least 3 points.');
  const bulges = points.map((_, i) => opts.bulges?.[i] ?? 0);
  const faces = wallFaces(shapes);
  const wallEdges = patioWallEdges(points, bulges, faces);
  // A corner on a wall face takes that wall's floor level, as snapping does in the app.
  const wallFloors = points.flatMap(p => faces.filter(f => {
    const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((p[0] - f.a[0]) * dx + (p[1] - f.a[1]) * dz) / len2));
    return Math.hypot(p[0] - f.a[0] - dx * t, p[1] - f.a[1] - dz * t) < 0.05;
  }).map(f => f.floor));
  // Walls stack on upper floors; the patio belongs to the floor nearest the ground there.
  const ground = groundAt(shapes);
  const groundHere = points.reduce((sum, [x, z]) => sum + ground(x, z), 0) / points.length;
  const nearest = wallFloors.length
    ? [wallFloors.reduce((best, f) => (Math.abs(f - groundHere) < Math.abs(best - groundHere) ? f : best))]
    : [];
  const level = opts.level ?? patioLevel(points, bulges, opts.kind, opts.deckHeight ?? 0.45, nearest, ground);
  const count = shapes.filter(s => s.type === 'patio' && s.patioData?.kind === opts.kind).length + 1;
  return makePatioShape({
    id: newId(),
    name: `${opts.kind === 'deck' ? 'Deck' : 'Patio'} ${count}`,
    world: points,
    bulges,
    level,
    wallEdges,
    kind: opts.kind,
    template: { ...DEFAULT_PATIO_TEMPLATE, ...opts.settings, lights: { ...DEFAULT_PATIO_TEMPLATE.lights, ...(opts.settings?.lights ?? {}) } },
  });
}

/** Moves, turns or resizes an object. Rotation is about the vertical axis unless all three are given. */
export function transformShape(s: Shape, t: { position?: Vec3; offset?: Vec3; rotateYDeg?: number; rotationDeg?: Vec3; scale?: number | Vec3 }): Shape {
  let position: Vec3 = [...s.position] as Vec3;
  if (t.position) position = t.position;
  if (t.offset) position = [position[0] + t.offset[0], position[1] + t.offset[1], position[2] + t.offset[2]];
  const next: Shape = { ...s, position };
  if (t.rotationDeg) {
    const e = new THREE.Euler(...t.rotationDeg.map(d => THREE.MathUtils.degToRad(d)) as Vec3);
    const q = new THREE.Quaternion().setFromEuler(e);
    next.rotation = [e.x, e.y, e.z];
    next.quaternion = s.quaternion ? [q.x, q.y, q.z, q.w] : undefined;
  } else if (t.rotateYDeg) {
    const q = orientation(s).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(t.rotateYDeg)));
    const e = new THREE.Euler().setFromQuaternion(q);
    next.rotation = [e.x, e.y, e.z];
    if (s.quaternion) next.quaternion = [q.x, q.y, q.z, q.w];
  }
  if (t.scale !== undefined) {
    const k: Vec3 = typeof t.scale === 'number' ? [t.scale, t.scale, t.scale] : t.scale;
    const base = s.scale ?? [1, 1, 1];
    next.scale = [base[0] * k[0], base[1] * k[1], base[2] * k[2]];
  }
  if (next.quaternion === undefined) delete next.quaternion;
  return next;
}

/** Moves the doors and windows hosted in a wall along with it, so they stay in its openings. */
export function carryHosted(before: Shape, after: Shape, shapes: Shape[]): Shape[] {
  if (before.type !== 'wall') return shapes;
  const from = new THREE.Matrix4().compose(new THREE.Vector3(...before.position), orientation(before), new THREE.Vector3(1, 1, 1));
  const to = new THREE.Matrix4().compose(new THREE.Vector3(...after.position), orientation(after), new THREE.Vector3(1, 1, 1));
  const delta = to.multiply(from.invert());
  const turn = new THREE.Quaternion().setFromRotationMatrix(delta);
  return shapes.map(s => {
    if (s.hostWallId !== before.id) return s;
    const p = new THREE.Vector3(...s.position).applyMatrix4(delta);
    const q = orientation(s).premultiply(turn);
    return { ...s, position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w], rotation: undefined };
  });
}

/**
 * The app reads most objects' orientation from `quaternion` (its own tools always set it), but
 * the scripting library only sets `rotation`. Give every rotated object a matching quaternion,
 * or the app cuts wall openings in the wrong places.
 */
export function withQuaternions(shapes: Shape[]): Shape[] {
  return shapes.map(s => {
    if (s.quaternion || !s.rotation || s.rotation.every(r => r === 0)) return s;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation));
    return { ...s, quaternion: [q.x, q.y, q.z, q.w] };
  });
}

/** Paints terrain with one of the app's built-in ground textures (no material library needed). */
export function withTerrainTexture(s: Shape, textureId: string): Shape {
  const preset = LANDSCAPE_TEXTURES.find(t => t.id === textureId);
  if (!preset) throw new ToolError(`Unknown terrain texture "${textureId}". See list_catalog terrain_textures.`);
  if (s.type !== 'terrain' || !s.terrainData) return s;
  return {
    ...s,
    color: preset.id,
    textureUrl: preset.id,
    materialBindingId: undefined,
    roughness: preset.roughness ?? 0.8,
    metalness: preset.metalness ?? 0.05,
    terrainData: { ...s.terrainData, textureUrl: preset.id, textureScale: preset.defaultRepeat ?? s.terrainData.textureScale },
  };
}
