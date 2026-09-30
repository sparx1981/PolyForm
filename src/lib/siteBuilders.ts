import type { Shape } from '../types';
import { sampleTerrainElevation } from './archRoomAssembly';
import { defaultWaterLevel } from './water/waterBody';
import { fenceStyleInfo, type FenceStyle } from './fence/fenceTypes';
import { DEFAULT_PATIO_TEMPLATE, type PatioKind, type PatioToolSettings } from './patio/patioTypes';
import { makePatioShape, patioGroundHelpers, patioLevel, patioWallEdges, terrainAt, wallFaces } from './patio/patioPlacement';
import type { Vec2 } from './patio/patioGeometry';

// Fences, ponds and patios built the way their tools build them, from plain inputs. Shared by
// the SDK (sdk.landscape.addFence / addPond / addPatio), the Claude connector, and the action
// recorder, which writes these commands for what the tools drew.

const newId = () => Math.random().toString(36).slice(2, 11);
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

function outlineLength(points: Vec2[], closed: boolean) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  if (closed && points.length > 2) length += Math.hypot(points[0]![0] - points.at(-1)![0], points[0]![1] - points.at(-1)![1]);
  return length;
}

const centre = (points: Vec2[]) => [
  points.reduce((a, p) => a + p[0], 0) / points.length,
  points.reduce((a, p) => a + p[1], 0) / points.length,
] as const;

/** Ground height before any patio levelling, for placing patios and decks. */
export function originalGroundAt(shapes: Shape[]) {
  return patioGroundHelpers(shapes, new Map(), sampleTerrainElevation).originalGround;
}

export interface FenceOptions {
  id?: string;
  name?: string;
  closed?: boolean;
  style?: FenceStyle;
  height?: number;
  color?: string;
  finish?: string;
  /** Picks the fence's natural variation (1-12); random when not given. */
  seed?: number;
}

/** A fence run through ground points [x, z], as the fence tool makes one. */
export function buildFence(shapes: Shape[], points: Vec2[], opts: FenceOptions = {}): Shape {
  if (points.length < 2) throw new Error('A fence needs at least 2 points.');
  const closed = !!opts.closed && points.length > 2;
  const style = opts.style ?? 'post-rail';
  const height = opts.height ?? 1.25;
  const color = opts.color ?? '#7a5a3a';
  const [cx, cz] = centre(points);
  const length = outlineLength(points, closed);
  const count = shapes.filter(s => s.type === 'fence').length + 1;
  return {
    id: opts.id ?? newId(),
    name: opts.name ?? `${fenceStyleInfo(style).label} Fence ${count} (${round(length, 1)} m)`,
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
      seed: opts.seed ?? Math.floor(Math.random() * 12) + 1,
      finish: (opts.finish ?? 'weathered') as any,
      color,
    },
  } as Shape;
}

export interface PondOptions {
  id?: string;
  name?: string;
  depth?: number;
  clarity?: string;
  /** Water level; by default it settles where the ground under the outline holds it. */
  level?: number;
  /** Optional moving-water profile. Ordinary ponds should leave this unset. */
  flow?: { mode: 'still' | 'stream'; direction?: [number, number]; speed?: number; turbulence?: number };
}

/** A pond or lake filling an outline of ground points [x, z], as the water tool makes one. */
export function buildWaterBody(shapes: Shape[], points: Vec2[], opts: PondOptions = {}): Shape {
  if (points.length < 3) throw new Error('A pond needs at least 3 points.');
  const [cx, cz] = centre(points);
  const terrain = terrainAt(shapes, cx, cz);
  const level = opts.level ?? (terrain
    ? defaultWaterLevel(points.map(([x, z]) => ({ x, z })), (x, z) => sampleTerrainElevation(x, z, terrain))
    : 0.02);
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const kind = extent > 30 ? 'Lake' : 'Pond';
  return {
    id: opts.id ?? newId(),
    name: opts.name ?? `${kind} ${shapes.filter(s => s.type === 'water').length + 1}`,
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
      flow: opts.flow,
    },
  } as Shape;
}

export interface PatioOptions {
  id?: string;
  name?: string;
  kind?: PatioKind;
  /** Per corner: how much the edge leaving it bows out (0 = straight). */
  bulges?: number[];
  /** Deck height above the ground, when `level` isn't given. */
  deckHeight?: number;
  /** Walking-surface height; by default taken from a wall it is drawn against, else the ground. */
  level?: number;
  /** Per edge: true where it runs along a wall or another patio (no kerb, railing or steps). */
  wallEdges?: boolean[];
  settings?: Partial<PatioToolSettings['template']>;
}

/**
 * A patio or deck over an outline of ground points [x, z], levelled like the patio tool: with the
 * house floor when an edge runs along a wall, otherwise on the ground.
 */
export function buildPatio(shapes: Shape[], points: Vec2[], opts: PatioOptions = {}): Shape {
  if (points.length < 3) throw new Error('A patio or deck needs at least 3 points.');
  const kind = opts.kind ?? 'patio';
  const bulges = points.map((_, i) => opts.bulges?.[i] ?? 0);
  const faces = wallFaces(shapes);
  const wallEdges = opts.wallEdges ?? patioWallEdges(points, bulges, faces);
  let level = opts.level;
  if (level === undefined) {
    // A corner on a wall face takes that wall's floor level, as snapping does in the app.
    const wallFloors = points.flatMap(p => faces.filter(f => {
      const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((p[0] - f.a[0]) * dx + (p[1] - f.a[1]) * dz) / len2));
      return Math.hypot(p[0] - f.a[0] - dx * t, p[1] - f.a[1] - dz * t) < 0.05;
    }).map(f => f.floor));
    // Walls stack on upper floors; the patio belongs to the floor nearest the ground there.
    const ground = originalGroundAt(shapes);
    const groundHere = points.reduce((sum, [x, z]) => sum + ground(x, z), 0) / points.length;
    const nearest = wallFloors.length
      ? [wallFloors.reduce((best, f) => (Math.abs(f - groundHere) < Math.abs(best - groundHere) ? f : best))]
      : [];
    level = patioLevel(points, bulges, kind, opts.deckHeight ?? 0.45, nearest, ground);
  }
  const count = shapes.filter(s => s.type === 'patio' && s.patioData?.kind === kind).length + 1;
  return makePatioShape({
    id: opts.id ?? newId(),
    name: opts.name ?? `${kind === 'deck' ? 'Deck' : 'Patio'} ${count}`,
    world: points,
    bulges,
    level,
    wallEdges,
    kind,
    template: { ...DEFAULT_PATIO_TEMPLATE, ...opts.settings, lights: { ...DEFAULT_PATIO_TEMPLATE.lights, ...(opts.settings?.lights ?? {}) } },
  });
}
