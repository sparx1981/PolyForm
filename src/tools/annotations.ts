/**
 * PolyForm — placed annotations: dimensions, live area labels and leader labels.
 *
 * All three are saved as 'measurement' shapes (like guides and section planes) so they save,
 * undo and delete with everything else. This file is the pure part; Viewport.tsx wires the tools.
 *
 * - Dimension: two measured points and an offset. The line is drawn parallel to the measured
 *   one, pushed out by `offset`, with extension lines back to the points and a tick at each end.
 * - Area label: points at a drawn face and reads its area and perimeter every time it draws,
 *   so it follows the face. If the face is redrawn (a new id), it finds the face at its anchor.
 * - Leader label: text placed away from what it describes, joined to it by a line.
 */

import type { Shape } from '../types';
import {
  distance, loopPoints, planeBasis, pointInPolygonWithHoles, projectToBasis, tessellateFace, tessellatedArea,
  type FaceId, type Graph, type Vec3,
} from '../lib/geometry';

export type V3 = [number, number, number];

const kindOf = (shape: Pick<Shape, 'type' | 'args'>): string | undefined =>
  shape.type === 'measurement' ? (shape.args as { kind?: string } | undefined)?.kind : undefined;

// ---------------------------------------------------------------------------
// Dimension
// ---------------------------------------------------------------------------

export interface DimensionArgs {
  kind: 'dimension';
  start: V3;
  end: V3;
  /** From the measured line to the dimension line. */
  offset: V3;
  /** Measured length in metres. */
  distance: number;
  /** Text shown instead of the length, if set. */
  text?: string;
}

export const isDimensionShape = (s: Pick<Shape, 'type' | 'args'>) => kindOf(s) === 'dimension';
export const isAreaLabelShape = (s: Pick<Shape, 'type' | 'args'>) => kindOf(s) === 'area';
export const isLeaderShape = (s: Pick<Shape, 'type' | 'args'>) => kindOf(s) === 'leader';
/** Any annotation this file makes. */
export const isAnnotationShape = (s: Pick<Shape, 'type' | 'args'>) =>
  isDimensionShape(s) || isAreaLabelShape(s) || isLeaderShape(s);

export function makeDimensionArgs(start: V3, end: V3, offset: V3): DimensionArgs {
  return { kind: 'dimension', start, end, offset, distance: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) };
}

export interface DimensionGeometry {
  /** The dimension line's ends. */
  a: V3;
  b: V3;
  /** Extension lines: from each measured point out to the dimension line (a little past it). */
  extensions: [V3, V3][];
  /** Where the text sits. */
  mid: V3;
  /** Short strokes across each end of the dimension line. */
  ticks: [V3, V3][];
  length: number;
}

/** How far an extension line runs past the dimension line, and half a tick's length. */
const OVERSHOOT = 0.08;
const TICK = 0.08;

export function dimensionGeometry(args: Pick<DimensionArgs, 'start' | 'end' | 'offset'>): DimensionGeometry {
  const { start, end, offset } = args;
  const a: V3 = [start[0] + offset[0], start[1] + offset[1], start[2] + offset[2]];
  const b: V3 = [end[0] + offset[0], end[1] + offset[1], end[2] + offset[2]];
  const off = Math.hypot(offset[0], offset[1], offset[2]);
  const dir: V3 = off > 1e-9 ? [offset[0] / off, offset[1] / off, offset[2] / off] : [0, 0, 0];
  const past = (p: V3): V3 => [p[0] + dir[0] * OVERSHOOT, p[1] + dir[1] * OVERSHOOT, p[2] + dir[2] * OVERSHOOT];
  const along: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(along[0], along[1], along[2]);
  const u: V3 = len > 1e-9 ? [along[0] / len, along[1] / len, along[2] / len] : [1, 0, 0];
  // A tick leans across the line: half along it and half along the offset side.
  const lean = (p: V3): [V3, V3] => {
    const d: V3 = [(u[0] + dir[0]) * 0.5, (u[1] + dir[1]) * 0.5, (u[2] + dir[2]) * 0.5];
    return [
      [p[0] - d[0] * TICK * 2, p[1] - d[1] * TICK * 2, p[2] - d[2] * TICK * 2],
      [p[0] + d[0] * TICK * 2, p[1] + d[1] * TICK * 2, p[2] + d[2] * TICK * 2],
    ];
  };
  return {
    a, b,
    extensions: off > 1e-9 ? [[start, past(a)], [end, past(b)]] : [],
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    ticks: [lean(a), lean(b)],
    length: len,
  };
}

// ---------------------------------------------------------------------------
// Area label
// ---------------------------------------------------------------------------

export interface AreaLabelArgs {
  kind: 'area';
  faceId: number;
  /** A point on the face, used to find it again if it is redrawn. */
  anchor: V3;
  /** Where the label floats (above the anchor). */
  position: V3;
  /** The last area and perimeter read, shown when the face can't be found. */
  area: number;
  perimeter: number;
}

export interface FaceMeasure { faceId: FaceId; area: number; perimeter: number; }

/** Area (holes taken out) and outer perimeter of a drawn face, in m² and m. */
export function measureFace(g: Graph, faceId: FaceId): FaceMeasure | null {
  const face = g.faces.get(faceId);
  const mesh = face ? tessellateFace(g, faceId) : null;
  if (!face || !mesh) return null;
  const outer = loopPoints(g, face.outerLoop);
  let perimeter = 0;
  for (let i = 0; i < outer.length; i++) perimeter += distance(outer[i]!, outer[(i + 1) % outer.length]!);
  return { faceId, area: tessellatedArea([mesh]), perimeter };
}

/** The face an area label means: its own, else whichever drawn face now holds the anchor. */
export function resolveAreaFace(g: Graph, args: Pick<AreaLabelArgs, 'faceId' | 'anchor'>, tolerance = 1e-3): FaceId | null {
  if (g.faces.has(args.faceId as FaceId)) return args.faceId as FaceId;
  const p: Vec3 = { x: args.anchor[0], y: args.anchor[1], z: args.anchor[2] };
  for (const [id, face] of g.faces) {
    const n = face.plane.normal;
    const o = face.plane.point;
    const off = (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
    if (Math.abs(off) > tolerance) continue;
    const basis = planeBasis(face.plane);
    const outer = loopPoints(g, face.outerLoop).map(q => projectToBasis(q, basis));
    const holes = face.innerLoops.map(l => loopPoints(g, l).map(q => projectToBasis(q, basis)));
    if (pointInPolygonWithHoles(projectToBasis(p, basis), outer, holes)) return id;
  }
  return null;
}

/** "12.40 m²  ·  14.2 m" style text; `unit` is the model's length unit. */
export function areaLabelText(area: number, perimeter: number, unit: 'm' | 'cm' | 'mm' | string, fmtLength: (metres: number) => string): string {
  const scale = unit === 'mm' ? 1e6 : unit === 'cm' ? 1e4 : 1;
  const suffix = unit === 'mm' ? 'mm²' : unit === 'cm' ? 'cm²' : 'm²';
  const value = area * scale;
  const text = value >= 1000 ? Math.round(value).toLocaleString('en-US') : value.toFixed(2);
  return `${text} ${suffix}  ·  ${fmtLength(perimeter)}`;
}

// ---------------------------------------------------------------------------
// Leader label
// ---------------------------------------------------------------------------

export interface LeaderArgs {
  kind: 'leader';
  /** The point the line ends on. */
  target: V3;
  /** Where the text sits. */
  anchor: V3;
  text: string;
}
