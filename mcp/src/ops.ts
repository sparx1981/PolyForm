import * as THREE from 'three';
import type { Shape } from '../../src/types';
import { DeveloperSDK } from '../../src/services/developerService';
import type { FenceStyle } from '../../src/lib/fence/fenceTypes';
import type { PatioKind, PatioToolSettings } from '../../src/lib/patio/patioTypes';
import { polygonArea, denseOutline, type Vec2 } from '../../src/lib/patio/patioGeometry';
import { LANDSCAPE_TEXTURES } from '../../src/lib/landscapeTextures';
import { buildFence, buildPatio, buildWaterBody, originalGroundAt } from '../../src/lib/siteBuilders';
import { RoofSurface } from '../../src/lib/roofSurface';
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
      // Balconies (patioData.kind 'balcony') are part of the building, not garden area.
      if (s.patioData.kind === 'deck') deckArea += area; else if (s.patioData.kind === 'patio') patioArea += area;
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
export function withSdk<T>(
  shapes: Shape[],
  run: (sdk: any) => T,
  extraSetters: Record<string, unknown> = {},
): { shapes: Shape[]; result: T; created: Shape[]; log: string[] } {
  let current = shapes;
  const log: string[] = [];
  const setShapes = (u: Shape[] | ((prev: Shape[]) => Shape[])) => { current = typeof u === 'function' ? u(current) : u; };
  const updateColor = (id: string, color: string) => setShapes(prev => prev.map(s => (s.id === id ? { ...s, color } : s)));
  const sdk: any = new DeveloperSDK(current, setShapes, updateColor, null, extraSetters);
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
  return originalGroundAt(shapes);
}

/** Builder errors are the caller's input, so they reach Claude as tool errors. */
function asToolError<T>(build: () => T): T {
  try {
    return build();
  } catch (err) {
    throw new ToolError(err instanceof Error ? err.message : String(err));
  }
}

/** A fence run through ground points [x, z], as the fence tool makes one. */
export function fenceRun(shapes: Shape[], points: Vec2[], opts: { closed?: boolean; style?: FenceStyle; height?: number; color?: string; finish?: string }): Shape {
  return asToolError(() => buildFence(shapes, points, { ...opts, id: newId() }));
}

/** A pond or lake filling an outline of ground points, as the water tool makes one. */
export function waterBody(shapes: Shape[], points: Vec2[], opts: {
  depth?: number;
  clarity?: string;
  level?: number;
  flow?: { mode: 'still' | 'stream'; direction?: [number, number]; speed?: number; turbulence?: number };
}): Shape {
  return asToolError(() => buildWaterBody(shapes, points, { ...opts, id: newId() }));
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
  return asToolError(() => buildPatio(shapes, points, { ...opts, id: newId() }));
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

/** Roofs the roof tool built (not their gutters, chimneys or dormer parts), the ones a roof window can sit in. */
export function roofsIn(shapes: Shape[]): Shape[] {
  return shapes.filter(s => s.roofData && s.geometryData && !s.hidden && !s.tags?.includes('roof-extra') && !s.tags?.includes('roof-part'));
}

/** The roof asked for, or the only roof; with several and none named, says which there are. */
export function pickRoof(shapes: Shape[], ref?: string): Shape {
  if (ref) {
    const roof = findShape(shapes, ref);
    if (!roofsIn([roof]).length) throw new ToolError(`"${roof.name ?? roof.id}" is not a roof made by add_roof.`);
    return roof;
  }
  const roofs = roofsIn(shapes);
  if (!roofs.length) throw new ToolError('There is no roof yet. Add one with add_roof first.');
  if (roofs.length > 1) throw new ToolError(`There is more than one roof; say which with roof: ${roofs.map(r => `${r.id} (${r.name}, ridge at y ${round(r.position[1])})`).join('; ')}.`);
  return roofs[0];
}

/**
 * A Velux roof window lying in the slope of a roof, placed the way the app's window tool places one on
 * a roof: turned to the slope, a hand's width above the covering, with the roof cutting its own opening.
 * `at` is a world [x, z]; the height and tilt come from the roof's own surface there.
 */
export function roofWindow(roof: Shape, at: [number, number], opts: { width?: number; height?: number; color?: string } = {}): Shape {
  const width = opts.width ?? 0.78, height = opts.height ?? 1.18;
  const q = orientation(roof);
  const toLocal = (x: number, z: number) => new THREE.Vector3(x - roof.position[0], 0, z - roof.position[2]).applyQuaternion(q.clone().invert());
  const surface = new RoofSurface(roof);
  try {
    const l = toLocal(at[0], at[1]);
    const hit = surface.at(l.x, l.z);
    if (!hit) throw new ToolError(`[${round(at[0])}, ${round(at[1])}] is not on the roof. Pick a point over the roof slope (add_roof's footprint), not in the air or past the eaves.`);
    if (hit.normal.y > 0.97) throw new ToolError('That part of the roof is flat. A Velux roof window needs a sloping roof; choose a point on a slope.');
    // The whole window has to lie on this one slope: no ridge, hip or edge under it.
    const horiz = Math.hypot(hit.normal.x, hit.normal.z) || 1;
    const down = new THREE.Vector2(hit.normal.x / horiz, hit.normal.z / horiz);
    const across = new THREE.Vector2(-down.y, down.x);
    const slope = Math.atan2(horiz, hit.normal.y);
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const run = (v * height / 2) * Math.cos(slope);
      const p = new THREE.Vector2(l.x, l.z).addScaledVector(across, u * width / 2).addScaledVector(down, -run);
      const s = surface.at(p.x, p.y);
      const h = s ? Math.hypot(s.normal.x, s.normal.z) || 1 : 0;
      if (!s || (s.normal.x / h) * down.x + (s.normal.z / h) * down.y < 0.97) {
        throw new ToolError(`A ${width} × ${height} m roof window there would run off the slope or cross a ridge or hip. Move it away from the edge and the ridge, or make it smaller.`);
      }
    }
    const n = hit.normal.clone().applyQuaternion(q).normalize();
    const world = new THREE.Vector3(l.x, hit.y, l.z).applyQuaternion(q).add(new THREE.Vector3(...roof.position)).addScaledVector(n, 0.04);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize();
    const uphill = new THREE.Vector3().crossVectors(n, right).normalize();
    const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, uphill, n));
    return {
      id: newId(),
      name: 'Velux Roof Window',
      type: 'window',
      position: r3(world.toArray()) as Vec3,
      quaternion: [turn.x, turn.y, turn.z, turn.w],
      args: [width, height, 0.2],
      color: opts.color ?? '#ffffff',
      archStyle: 'velux-roof',
      roughness: 0.4,
      metalness: 0.05,
      opacity: 1,
    } as Shape;
  } finally {
    surface.dispose();
  }
}

export interface PorchOptions {
  width?: number;
  depth?: number;
  style?: 'flat' | 'lean-to' | 'gable';
  post?: 'round' | 'square';
  posts?: 2 | 4;
  pitchDeg?: number;
  color?: string;
  roofColor?: string;
}

/**
 * A porch over a door: a landing in front of it, posts at the outer corners and a canopy roof that rests
 * on the wall above the door. Built in the frame of the wall the door is in, on the side facing away from
 * the building, so it never sits inside the house. Returns the pieces, which are ordinary objects.
 */
export function porchOverDoor(shapes: Shape[], door: Shape, opts: PorchOptions = {}): Shape[] {
  const wall = door.type === 'door' && door.hostWallId ? shapes.find(s => s.id === door.hostWallId) : undefined;
  if (!wall || wall.type !== 'wall') throw new ToolError(`"${door.name ?? door.id}" is not a door set in a wall. Pass the id of a door from list_objects.`);
  const [, wallH = 2.8, wallT = 0.2] = wall.args as number[];
  const doorW = (door.args as number[])[0] ?? 0.9, doorH = (door.args as number[])[1] ?? 2.1;
  const base = wall.position[1] - wallH / 2;
  const q = orientation(wall);
  const along = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
  let out = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();

  // Outside is the side facing away from the middle of the building's walls on this floor.
  const floorWalls = shapes.filter(s => s.type === 'wall' && !s.hidden && Math.abs(s.position[1] - (s.args as number[])[1] / 2 - base) < 0.5);
  const centre = floorWalls.reduce((c, w) => c.add(new THREE.Vector3(w.position[0], 0, w.position[2])), new THREE.Vector3()).divideScalar(Math.max(1, floorWalls.length));
  if (new THREE.Vector3(door.position[0], 0, door.position[2]).sub(centre).dot(out) < 0) out.negate();
  if (new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).dot(out) < 0) along.negate();

  const width = opts.width ?? Math.max(doorW + 1, 2);
  const depth = opts.depth ?? 1.5;
  const style = opts.style ?? 'gable';
  const color = opts.color ?? '#f5f5f2';
  const roofColor = opts.roofColor ?? '#3a3d42';
  const postH = Math.max(2.4, doorH + 0.3);
  const doorAt = new THREE.Vector3(door.position[0], 0, door.position[2]);
  const spot = (u: number, n: number) => doorAt.clone().addScaledVector(along, u).addScaledVector(out, wallT / 2 + n);
  const frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, new THREE.Vector3(0, 1, 0), out));
  const made: Shape[] = [];
  const keep = (list: Shape[], name: string, patch: Partial<Shape> = {}) => list.forEach(s => made.push({ ...s, name, color: patch.color ?? color, ...patch }));
  const sdkMake = (run: (sdk: any) => unknown) => withSdk([], run).created;
  const place = (v: THREE.Vector3, y: number): Vec3 => r3([v.x, y, v.z]) as Vec3;

  // Landing, with a step down when the floor stands above the ground.
  const landing = sdkMake(sdk => sdk.createBox({ width, height: 0.15, depth, position: [0, 0, 0] }));
  keep(landing.map(s => ({ ...s, position: place(spot(0, depth / 2), base - 0.075), quaternion: [frame.x, frame.y, frame.z, frame.w] as [number, number, number, number] })), 'Porch landing', { color: '#b8b2a6' });
  if (base > 0.25) {
    const step = sdkMake(sdk => sdk.createBox({ width, height: base / 2, depth: 0.35, position: [0, 0, 0] }));
    keep(step.map(s => ({ ...s, position: place(spot(0, depth + 0.175), base / 4), quaternion: [frame.x, frame.y, frame.z, frame.w] as [number, number, number, number] })), 'Porch step', { color: '#b8b2a6' });
  }

  // Posts at the outer corners (and in line with the door's wall too, for four).
  const inset = 0.1;
  const spots: [number, number][] = [[-width / 2 + inset, depth - inset], [width / 2 - inset, depth - inset]];
  if (opts.posts === 4) spots.push([-width / 2 + inset, inset + wallT / 2], [width / 2 - inset, inset + wallT / 2]);
  spots.forEach(([u, n], i) => {
    const post = opts.post === 'square'
      ? sdkMake(sdk => sdk.createBox({ width: 0.14, height: postH, depth: 0.14, position: [0, 0, 0] }))
      : sdkMake(sdk => sdk.createCylinder({ radius: 0.07, height: postH, position: [0, 0, 0] }));
    keep(post.map(s => ({ ...s, position: place(spot(u, n), base + postH / 2) })), `Porch post ${i + 1}`);
  });

  // The canopy, resting on the posts and on the wall above the door.
  const top = base + postH;
  if (style === 'gable') {
    const w = width + 0.3, d = depth + 0.2;
    // The roof tool runs the ridge along the longer side; turn it so that side lies along the wall or out from it.
    const ridgeOut = d >= w;
    const roof = sdkMake(sdk => sdk.architecture.createRoof({ roofType: 'gable', width: ridgeOut ? d : w, depth: ridgeOut ? w : d, pitchAngleDeg: opts.pitchDeg ?? 30, eaveOverhang: 0.12, color: roofColor }));
    const turned = ridgeOut ? frame.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)) : frame.clone();
    keep(roof.map(s => ({ ...s, position: place(spot(0, depth / 2), top), quaternion: [turned.x, turned.y, turned.z, turned.w] as [number, number, number, number] })), 'Porch roof', { color: roofColor });
  } else {
    const slab = sdkMake(sdk => sdk.createBox({ width: width + 0.3, height: 0.12, depth: depth + 0.2, position: [0, 0, 0] }));
    const tilt = style === 'lean-to' ? THREE.MathUtils.degToRad(opts.pitchDeg ?? 12) : 0;
    const q2 = frame.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
    // Lean-to: the wall side stays at the top of the posts' height and the outer edge drops away from it.
    const lift = style === 'lean-to' ? (Math.sin(tilt) * (depth + 0.2)) / 2 : 0;
    keep(slab.map(s => ({ ...s, position: place(spot(0, (depth + 0.2) / 2 - 0.1), top + 0.06 + lift), quaternion: [q2.x, q2.y, q2.z, q2.w] as [number, number, number, number] })), 'Porch roof', { color: roofColor });
  }
  return made.map(s => ({ ...s, id: newId(), tags: [...(s.tags ?? []), 'porch'] }));
}
