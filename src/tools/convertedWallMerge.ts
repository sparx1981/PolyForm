/**
 * PolyForm — merging curved wall pieces into one flat section.
 *
 * Convert To Wall turns a curve into one flat wall per drawn piece, and a
 * door or window sits on one piece. Where the pieces are too narrow for the
 * opening wanted, real curved buildings use a short flat section in the
 * curve; this builds exactly that, by replacing a run of neighbouring
 * pieces with one straight wall running between the run's two end joints.
 *
 * The end joints are the neighbours' own corners, so the pieces either
 * side still meet the merged wall flush. Across the merged section the
 * outside and inside faces become the two chords of the curve, which are
 * parallel on a circle; the wall there is a touch thinner than the rest
 * (by the cosine of half the angle it spans — about 2% for a door on a
 * typical round room).
 */

import type { Shape } from '../types';
import { buildWallShapes, type WallConversionPlan, type WallPiece } from './kernelConvertToWall';

export const CURVED_PIECE_TAG = 'wall-curved-piece';
const MERGED_PIECE_TAG = 'wall-merged-piece';
const JOINT_TOL = 0.003;

interface P2 {
  x: number;
  z: number;
}

/** A wall's mitred footprint in world X/Z: outer-start, inner-start, inner-end, outer-end. */
function worldFootprint(wall: Shape): [P2, P2, P2, P2] | null {
  const fp = wall.wallMiterFootprint;
  if (!fp || !wall.quaternion) return null;
  const [, qy, , qw] = wall.quaternion;
  const theta = 2 * Math.atan2(qy, qw);
  // Yaw by theta maps local +X to (cos, -sin) and local +Z to (sin, cos).
  const ax = { x: Math.cos(theta), z: -Math.sin(theta) };
  const az = { x: Math.sin(theta), z: Math.cos(theta) };
  const toWorld = ([lx, lz]: [number, number]): P2 => ({
    x: wall.position[0] + lx * ax.x + lz * az.x,
    z: wall.position[2] + lx * ax.z + lz * az.z,
  });
  return [toWorld(fp[0]), toWorld(fp[1]), toWorld(fp[2]), toWorld(fp[3])];
}

const near = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z) <= JOINT_TOL;
const mid = (a: P2, b: P2): P2 => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/** One end joint of a wall: its outer and inner corner there. */
interface Joint {
  outer: P2;
  inner: P2;
}

interface Piece {
  wall: Shape;
  a: Joint;
  b: Joint;
}

function asPiece(wall: Shape): Piece | null {
  const fp = worldFootprint(wall);
  if (!fp) return null;
  return { wall, a: { outer: fp[0], inner: fp[1] }, b: { outer: fp[3], inner: fp[2] } };
}

const sameJoint = (j: Joint, k: Joint) => near(j.outer, k.outer) && near(j.inner, k.inner);

export function isCurvedPiece(wall: Shape): boolean {
  return wall.type === 'wall' && !!wall.tags?.includes(CURVED_PIECE_TAG) && !!wall.wallMiterFootprint;
}

export interface MergeResult {
  readonly ok: true;
  /** Walls to remove. */
  readonly removeIds: readonly string[];
  readonly merged: Shape;
  /** Doors and windows re-hosted onto the merged wall. */
  readonly rehosted: readonly Shape[];
  readonly width: number;
}

export interface MergeRejection {
  readonly ok: false;
  readonly reason: string;
}

/** Centreline width of the flat wall spanning two end joints. */
function spanWidth(start: Joint, end: Joint): number {
  const s = mid(start.outer, start.inner);
  const e = mid(end.outer, end.inner);
  return Math.hypot(e.x - s.x, e.z - s.z);
}

/**
 * Plans merging the clicked curved piece with as few neighbouring curved
 * pieces as needed (taken alternately from either side, so the flat
 * section stays centred where the user clicked) for the result to be at
 * least `minWidth` wide.
 */
export function planCurvedMerge(
  shapes: readonly Shape[],
  wallId: string,
  minWidth: number,
  makeId: () => string,
): MergeResult | MergeRejection {
  const clicked = shapes.find((s) => s.id === wallId);
  if (!clicked || !isCurvedPiece(clicked)) return { ok: false, reason: 'Only curved wall pieces can be merged.' };
  const start = asPiece(clicked);
  if (!start) return { ok: false, reason: 'This wall has no footprint to merge.' };

  const candidates = shapes.filter((s) => s.id !== wallId && isCurvedPiece(s) && !s.hidden)
    .map(asPiece)
    .filter((p): p is Piece => p !== null);

  // The run, as a chain of pieces from its first joint to its last.
  let first: Joint = start.a;
  let last: Joint = start.b;
  const run: Piece[] = [start];
  const used = new Set<string>([wallId]);

  const extend = (end: 'first' | 'last'): boolean => {
    const joint = end === 'first' ? first : last;
    for (const p of candidates) {
      if (used.has(p.wall.id)) continue;
      // Same height and base, or the merged wall could not be one box.
      const [, h] = p.wall.args as number[];
      if (Math.abs((h ?? 0) - ((clicked.args as number[])[1] ?? 0)) > 1e-3) continue;
      if (Math.abs(p.wall.position[1] - clicked.position[1]) > 1e-3) continue;
      let far: Joint | null = null;
      if (sameJoint(p.a, joint)) far = p.b;
      else if (sameJoint(p.b, joint)) far = p.a;
      if (!far) continue;
      used.add(p.wall.id);
      if (end === 'first') {
        run.unshift(p);
        first = far;
      } else {
        run.push(p);
        last = far;
      }
      return true;
    }
    return false;
  };

  let turn: 'last' | 'first' = 'last';
  while (spanWidth(first, last) < minWidth) {
    const grew = extend(turn) || extend(turn === 'last' ? 'first' : 'last');
    if (!grew) {
      return {
        ok: false,
        reason: `Not enough curved pieces next to this one to make ${minWidth.toFixed(1)} m of flat wall.`,
      };
    }
    // A closed ring merged all the way round would meet itself.
    if (sameJoint(first, last)) return { ok: false, reason: 'The curve is too small for an opening this wide.' };
    turn = turn === 'last' ? 'first' : 'last';
  }
  if (run.length === 1) return { ok: false, reason: 'This piece is already wide enough.' };

  // Build the merged wall with the same construction as Convert To Wall.
  const startC = mid(first.outer, first.inner);
  const endC = mid(last.outer, last.inner);
  const along = { x: endC.x - startC.x, z: endC.z - startC.z };
  const len = Math.hypot(along.x, along.z);
  const dir = { x: along.x / len, z: along.z / len };
  let outward = { x: dir.z, z: -dir.x };
  const outerMid = mid(first.outer, last.outer);
  if ((outerMid.x - startC.x) * outward.x + (outerMid.z - startC.z) * outward.z < 0) {
    outward = { x: -outward.x, z: -outward.z };
  }
  // Perpendicular gap between the outer and inner chords, averaged over both ends.
  const gap = (j: Joint) => (j.outer.x - j.inner.x) * outward.x + (j.outer.z - j.inner.z) * outward.z;
  const thickness = (gap(first) + gap(last)) / 2;

  const [, height] = clicked.args as number[];
  const piece: WallPiece = {
    start: startC,
    end: endC,
    outward,
    corners: [first.outer, first.inner, last.inner, last.outer],
    length: len,
    curved: false,
  };
  const plan: WallConversionPlan = {
    ok: true,
    sourceFaces: [],
    flat: false,
    baseY: clicked.position[1] - (height ?? 0) / 2,
    height: height ?? 0,
    thickness,
    pieces: [piece],
    color: clicked.color,
    warnings: [],
  };
  const built = buildWallShapes(plan, {
    height: height ?? 0,
    color: clicked.color,
    story: 1,
    makeId,
    existingWallCount: 0,
  })[0]!;
  const removeIds = run.map((p) => p.wall.id);
  const merged: Shape = {
    ...clicked,
    id: built.id,
    name: `${clicked.name ?? 'Wall'} (flat section)`,
    position: built.position,
    quaternion: built.quaternion!,
    args: built.args,
    wallMiterFootprint: built.wallMiterFootprint!,
    tags: [...(clicked.tags ?? []).filter((t) => t !== CURVED_PIECE_TAG), MERGED_PIECE_TAG],
    customData: {
      ...(clicked.customData ?? {}),
      convertedToWall: { ...((clicked.customData as { convertedToWall?: object } | undefined)?.convertedToWall ?? {}), curved: false, mergedPieces: run.length },
    },
  };
  delete (merged as { timberFrame?: unknown }).timberFrame;

  // Doors and windows on any of the merged pieces move onto the new flat
  // wall, flush with it and kept within its length.
  const removed = new Set(removeIds);
  const q = merged.quaternion!;
  const halfLen = len / 2;
  const rehosted = shapes
    .filter((s) => (s.type === 'door' || s.type === 'window') && s.hostWallId && removed.has(s.hostWallId))
    .map((s) => {
      const width = Array.isArray(s.args) ? (s.args[0] as number) || 0.9 : 0.9;
      const rel = { x: s.position[0] - merged.position[0], z: s.position[2] - merged.position[2] };
      const lx = Math.max(-halfLen + width / 2, Math.min(halfLen - width / 2, rel.x * dir.x + rel.z * dir.z));
      return {
        ...s,
        hostWallId: merged.id,
        position: [merged.position[0] + dir.x * lx, s.position[1], merged.position[2] + dir.z * lx] as [number, number, number],
        quaternion: q,
      };
    });

  return { ok: true, removeIds, merged, rehosted, width: len };
}
