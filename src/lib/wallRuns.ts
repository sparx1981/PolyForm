import * as THREE from 'three';
import type { Shape } from '../types';

/**
 * Wall runs: pieces of wall joined end to end, flush and at a gentle angle (a curved wall made
 * of many short pieces, or straight pieces in line), act as one wall. They are drawn without
 * lines where the pieces meet, and selected and painted together; a real corner (sharper than
 * 30 degrees) ends a run.
 */

/** Pieces meeting at more than this turn are a corner, not one wall. */
export const RUN_CORNER = (30 * Math.PI) / 180;
/** Below this turn a join counts as straight on (for "same shape" painting). */
const STRAIGHT_TURN = (0.5 * Math.PI) / 180;

export interface WallRuns {
  /** Every wall's run (ids, including itself). */
  runOf: Map<string, string[]>;
  /** Which ends of a wall join the next piece of its run (start = its local -x end). */
  joined: Map<string, { start: boolean; end: boolean }>;
  /** Pieces that turn against a neighbour (part of a curve), as opposed to running straight on. */
  curved: Set<string>;
  /** The pieces each wall is joined to. */
  neighbours: Map<string, string[]>;
}

interface Piece { id: string; start: THREE.Vector2; end: THREE.Vector2; dir: THREE.Vector2; base: number; height: number; thickness: number }

function pieceOf(s: Shape): Piece | null {
  if (s.type !== 'wall' || s.hidden || !Array.isArray(s.args)) return null;
  const [length = 0, height = 0, thickness = 0.2] = s.args as number[];
  if (length < 1e-3) return null;
  const q = s.quaternion
    ? new THREE.Quaternion(...s.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation || [0, 0, 0])));
  const d3 = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const dir = new THREE.Vector2(d3.x, d3.z);
  if (dir.lengthSq() < 1e-9) return null;
  dir.normalize();
  const c = new THREE.Vector2(s.position[0], s.position[2]);
  return {
    id: s.id,
    start: c.clone().addScaledVector(dir, -length / 2),
    end: c.clone().addScaledVector(dir, length / 2),
    dir, base: s.position[1] - height / 2, height, thickness,
  };
}

export function wallRuns(shapes: Shape[]): WallRuns {
  const pieces = shapes.map(pieceOf).filter((p): p is Piece => !!p);
  const joined = new Map<string, { start: boolean; end: boolean }>();
  const neighbours = new Map<string, string[]>();
  const curved = new Set<string>();
  for (const p of pieces) { joined.set(p.id, { start: false, end: false }); neighbours.set(p.id, []); }

  // Each end joins at most one other piece: the nearest end of a compatible wall.
  type End = { piece: Piece; which: 'start' | 'end'; at: THREE.Vector2 };
  const ends: End[] = pieces.flatMap(p => [{ piece: p, which: 'start' as const, at: p.start }, { piece: p, which: 'end' as const, at: p.end }]);
  const cell = 0.5;
  const grid = new Map<string, End[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const e of ends) {
    const k = key(e.at.x, e.at.y);
    grid.set(k, [...(grid.get(k) ?? []), e]);
  }
  const taken = new Set<string>();
  const turning = new Map<string, { turn: number; straight: number }>();
  const endKey = (e: End) => `${e.piece.id}:${e.which}`;
  const candidates: { a: End; b: End; d: number }[] = [];
  for (const a of ends) {
    const cx = Math.floor(a.at.x / cell), cz = Math.floor(a.at.y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const b of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (b.piece.id <= a.piece.id) continue;
        const pa = a.piece, pb = b.piece;
        const reach = Math.max(0.05, Math.min(pa.thickness, pb.thickness) * 0.75);
        const d = a.at.distanceTo(b.at);
        if (d > reach) continue;
        if (Math.abs(pa.base - pb.base) > 0.05 || Math.abs(pa.thickness - pb.thickness) > 0.05 || Math.abs(pa.height - pb.height) > 0.05) continue;
        if (Math.abs(pa.dir.dot(pb.dir)) < Math.cos(RUN_CORNER)) continue;
        candidates.push({ a, b, d });
      }
    }
  }
  candidates.sort((x, y) => x.d - y.d);
  for (const { a, b } of candidates) {
    if (taken.has(endKey(a)) || taken.has(endKey(b))) continue;
    taken.add(endKey(a)); taken.add(endKey(b));
    joined.get(a.piece.id)![a.which] = true;
    joined.get(b.piece.id)![b.which] = true;
    neighbours.get(a.piece.id)!.push(b.piece.id);
    neighbours.get(b.piece.id)!.push(a.piece.id);
    // A turn counts towards a curve only between pieces of a similar length: a curve is made of
    // like pieces, while a long straight wall meets a curve's short pieces at a slight angle.
    const la = a.piece.start.distanceTo(a.piece.end), lb = b.piece.start.distanceTo(b.piece.end);
    const alike = Math.max(la, lb) < 2 * Math.min(la, lb) - 1e-9;
    const bends = Math.abs(a.piece.dir.dot(b.piece.dir)) < Math.cos(STRAIGHT_TURN);
    for (const id of [a.piece.id, b.piece.id]) {
      const t = turning.get(id) ?? { turn: 0, straight: 0 };
      // Straight on counts as straight; a bend counts as curve only between like pieces.
      if (!bends) t.straight++; else if (alike) t.turn++;
      turning.set(id, t);
    }
  }
  // Part of a curve when it turns (against a like piece) at more of its joins than it runs
  // straight on, so a straight wall between two curves stays straight.
  for (const [id, t] of turning) if (t.turn > t.straight) curved.add(id);

  // Runs: the joined pieces, connected.
  const runOf = new Map<string, string[]>();
  for (const p of pieces) {
    if (runOf.has(p.id)) continue;
    const run: string[] = [];
    const stack = [p.id];
    const seen = new Set(stack);
    while (stack.length) {
      const id = stack.pop()!;
      run.push(id);
      for (const n of neighbours.get(id) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    for (const id of run) runOf.set(id, run);
  }
  return { runOf, joined, curved, neighbours };
}

/** The part of a wall's run with the same shape as it: the curve it is in, or the straight stretch. */
export function sameShapePart(runs: WallRuns, id: string): string[] {
  const kind = runs.curved.has(id);
  const out: string[] = [];
  const stack = [id];
  const seen = new Set(stack);
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const n of runs.neighbours.get(cur) ?? []) {
      if (seen.has(n) || runs.curved.has(n) !== kind) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return out;
}

/**
 * The planes (in the wall's local frame) of the ends that join the next piece of its run: a
 * point on the plane and its normal. Edge lines lying in these planes are not drawn.
 */
export function joinedEndPlanes(shape: Shape, ends: { start: boolean; end: boolean }): { point: THREE.Vector3; normal: THREE.Vector3 }[] {
  if (!Array.isArray(shape.args)) return [];
  const [length = 0] = shape.args as number[];
  const planes: { point: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  const fp = shape.wallMiterFootprint;
  const endFace = (which: 'start' | 'end'): [[number, number], [number, number]] => {
    if (fp) {
      // Corners: outer-start, inner-start, inner-end, outer-end, with the start end at -x.
      const [a, b, c, d] = fp;
      const startFirst = a[0] + b[0] <= c[0] + d[0];
      const s: [[number, number], [number, number]] = startFirst ? [a, b] : [c, d];
      const e: [[number, number], [number, number]] = startFirst ? [c, d] : [a, b];
      return which === 'start' ? s : e;
    }
    const x = which === 'start' ? -length / 2 : length / 2;
    return [[x, -1], [x, 1]];
  };
  for (const which of ['start', 'end'] as const) {
    if (!ends[which]) continue;
    const [p, q] = endFace(which);
    const along = new THREE.Vector3(q[0] - p[0], 0, q[1] - p[1]);
    if (along.lengthSq() < 1e-12) continue;
    const normal = new THREE.Vector3(along.z, 0, -along.x).normalize();
    planes.push({ point: new THREE.Vector3(p[0], 0, p[1]), normal });
  }
  return planes;
}

/** Edge segment positions (pairs of points) with those lying in any of the planes removed. */
export function edgesOffPlanes(positions: ArrayLike<number>, planes: { point: THREE.Vector3; normal: THREE.Vector3 }[], tol = 1e-3): number[] {
  const out: number[] = [];
  const on = (p: { point: THREE.Vector3; normal: THREE.Vector3 }, x: number, y: number, z: number) =>
    Math.abs((x - p.point.x) * p.normal.x + (y - p.point.y) * p.normal.y + (z - p.point.z) * p.normal.z) < tol;
  for (let i = 0; i + 5 < positions.length; i += 6) {
    const ax = positions[i]!, ay = positions[i + 1]!, az = positions[i + 2]!;
    const bx = positions[i + 3]!, by = positions[i + 4]!, bz = positions[i + 5]!;
    // Dropped only when the whole edge lies in one joined end.
    if (planes.some(p => on(p, ax, ay, az) && on(p, bx, by, bz))) continue;
    out.push(ax, ay, az, bx, by, bz);
  }
  return out;
}
