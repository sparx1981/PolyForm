import * as THREE from 'three';
import type { Shape } from '../types';
import { createParametricStaircaseGeometry } from './parametricStairs';
import { wallRect } from './buildingRoofs';

/**
 * Where a staircase may stand. It may touch a wall (an internal wall is a fine thing to climb beside)
 * but not pass through one, and at the top there must be room for a person to step off: a clear patch
 * at least as wide as the exit and 0.9 m deep. Everything is worked out in plan (x / z) and compared
 * against the walls whose height overlaps the flight (or, for the exit, the space above the top step).
 */

type V2 = [number, number];
export const STAIR_EXIT_DEPTH = 0.9;
const TOUCH = 0.03; // walls may touch the stair; only a deeper overlap is a clash
const HEADROOM = 2.0;

export interface StairPlacement {
  ok: boolean;
  /** Why it can't go here, in a sentence for the status bar. */
  reason?: string;
  /** The flight's plan outline, and the patch a person steps off onto (both in world x / z). */
  footprint: V2[];
  exit: V2[] | null;
  /** The world height of the top step, where the exit patch lies. */
  topY: number;
}

interface LocalOutline {
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** Which way the top of the flight leads, and how far along that axis and across it the top steps reach. */
  exitAxis: 'x' | 'z'; exitSign: 1 | -1; exitAt: number; exitFrom: number; exitTo: number;
}

const cache = new Map<string, LocalOutline>();

function localOutline(width: number, targetHeight: number, style: string, structure: string): LocalOutline | null {
  const key = `${width}|${targetHeight}|${style}|${structure}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let geometry: THREE.BufferGeometry;
  try {
    geometry = createParametricStaircaseGeometry({ targetHeight, width, stairStyle: style, stairStructure: structure as never, railingMode: 'none' }).geometry;
  } catch { return null; }
  const pos = geometry.getAttribute('position');
  if (!pos || !pos.count) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  // The top steps: where a person steps off. Their centre against the whole outline says which way it leads.
  let tx = 0, tz = 0, n = 0;
  let tMinX = Infinity, tMaxX = -Infinity, tMinZ = Infinity, tMaxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < maxY - 0.02) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    tx += x; tz += z; n++;
    tMinX = Math.min(tMinX, x); tMaxX = Math.max(tMaxX, x); tMinZ = Math.min(tMinZ, z); tMaxZ = Math.max(tMaxZ, z);
  }
  geometry.dispose();
  if (!n) return null;
  const dx = tx / n - (minX + maxX) / 2, dz = tz / n - (minZ + maxZ) / 2;
  // A stair whose top sits in the middle (a spiral) exits to whichever side is nearer its top's outer edge.
  const alongX = Math.abs(dx) * (maxZ - minZ) > Math.abs(dz) * (maxX - minX);
  const outline: LocalOutline = alongX
    ? { minX, maxX, minZ, maxZ, exitAxis: 'x', exitSign: dx >= 0 ? 1 : -1, exitAt: dx >= 0 ? tMaxX : tMinX, exitFrom: tMinZ, exitTo: tMaxZ }
    : { minX, maxX, minZ, maxZ, exitAxis: 'z', exitSign: dz >= 0 ? 1 : -1, exitAt: dz >= 0 ? tMaxZ : tMinZ, exitFrom: tMinX, exitTo: tMaxX };
  cache.set(key, outline);
  return outline;
}

/** Do two convex polygons overlap by more than `slack` (the depth one pokes into the other)? */
function overlapDepth(a: V2[], b: V2[]): number {
  let least = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      let nx = q[1] - p[1], nz = -(q[0] - p[0]);
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const range = (pts: V2[]) => pts.reduce((r, v) => { const d = v[0] * nx + v[1] * nz; return [Math.min(r[0], d), Math.max(r[1], d)] as [number, number]; }, [Infinity, -Infinity] as [number, number]);
      const ra = range(a), rb = range(b);
      const depth = Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]);
      if (depth <= 0) return 0; // a gap on this axis: they don't overlap
      least = Math.min(least, depth);
    }
  }
  return least;
}

export function checkStairPlacement(
  stair: { position: [number, number, number]; quaternion: [number, number, number, number]; width: number; height: number; style?: string; structure?: string },
  shapes: readonly Shape[],
): StairPlacement | null {
  const outline = localOutline(stair.width, stair.height, stair.style ?? 'straight', stair.structure ?? 'closed');
  if (!outline) return null;
  const q = new THREE.Quaternion(...stair.quaternion);
  const toWorld = (x: number, z: number): V2 => {
    const v = new THREE.Vector3(x, 0, z).applyQuaternion(q);
    return [stair.position[0] + v.x, stair.position[2] + v.z];
  };
  const shrink = TOUCH;
  const { minX, maxX, minZ, maxZ } = outline;
  const footprint: V2[] = [toWorld(minX, minZ), toWorld(maxX, minZ), toWorld(maxX, maxZ), toWorld(minX, maxZ)];
  const testFootprint: V2[] = [toWorld(minX + shrink, minZ + shrink), toWorld(maxX - shrink, minZ + shrink), toWorld(maxX - shrink, maxZ - shrink), toWorld(minX + shrink, maxZ - shrink)];

  const bottomY = stair.position[1] - stair.height / 2;
  const topY = stair.position[1] + stair.height / 2;
  const { exitAxis, exitSign, exitAt, exitFrom, exitTo } = outline;
  const d0 = exitAt, d1 = exitAt + exitSign * STAIR_EXIT_DEPTH;
  const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
  const exit: V2[] = exitAxis === 'x'
    ? [toWorld(lo, exitFrom), toWorld(hi, exitFrom), toWorld(hi, exitTo), toWorld(lo, exitTo)]
    : [toWorld(exitFrom, lo), toWorld(exitFrom, hi), toWorld(exitTo, hi), toWorld(exitTo, lo)];
  // A person needs a little shoulder room either side of the exit too, so only a slightly smaller patch is tested.
  const inset = 0.05;
  const testExit: V2[] = exitAxis === 'x'
    ? [toWorld(lo + (exitSign > 0 ? inset : 0), exitFrom + inset), toWorld(hi - (exitSign > 0 ? 0 : inset), exitFrom + inset), toWorld(hi - (exitSign > 0 ? 0 : inset), exitTo - inset), toWorld(lo + (exitSign > 0 ? inset : 0), exitTo - inset)]
    : [toWorld(exitFrom + inset, lo + (exitSign > 0 ? inset : 0)), toWorld(exitFrom + inset, hi - (exitSign > 0 ? 0 : inset)), toWorld(exitTo - inset, hi - (exitSign > 0 ? 0 : inset)), toWorld(exitTo - inset, lo + (exitSign > 0 ? inset : 0))];

  for (const w of shapes) {
    if (w.type !== 'wall' || w.hidden) continue;
    const a = Array.isArray(w.args) ? (w.args as number[]) : [];
    const wallH = a[1] ?? 2.8;
    const wallBottom = w.position[1] - wallH / 2, wallTop = w.position[1] + wallH / 2;
    const { rect } = wallRect(w);
    // The flight itself.
    if (wallBottom < topY - 0.05 && wallTop > bottomY + 0.05 && overlapDepth(testFootprint, rect) > 0) {
      return { ok: false, reason: 'The stairs would go through a wall. Move them clear (they may touch a wall, not pass through it).', footprint, exit, topY };
    }
    // The exit, at the level of the top step.
    if (wallBottom < topY + HEADROOM && wallTop > topY + 0.3 && overlapDepth(testExit, rect) > 0) {
      return { ok: false, reason: `No room to step off the top: keep ${STAIR_EXIT_DEPTH.toFixed(1)} m clear beyond the top step (shown in orange).`, footprint, exit, topY };
    }
  }
  return { ok: true, footprint, exit, topY };
}
