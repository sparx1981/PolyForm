/**
 * PolyForm — World View: which imported buildings are still as they came in.
 *
 * With Google's 3D map standing in for the site, an imported building nobody has touched is
 * shown by Google (photographs on every side) and its editable copy is kept hidden but
 * clickable. The moment it is changed, moved or deleted, Google's version is pressed flat where
 * it stood and the editable one takes over. This file decides "still as imported" and works out
 * the outlines that are pressed flat.
 */

import type { Shape, SiteBuildingData, SiteBuildingSnapshot } from '../../types';
import { SITE_BUILDING_COLOR } from './buildings';

export type Ring = [number, number][];

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The parts of a building's data that define its shape and look (not derived flags). */
const identity = (d: SiteBuildingData) => [d.footprint, d.holes ?? null, d.height, d.minHeight ?? 0, d.roof?.planes ?? null];

/** Is this building exactly as it was imported: same place, same shape and height, not painted? */
export function isUntouched(shape: Shape, snapshot: SiteBuildingSnapshot | undefined): boolean {
  if (!snapshot || !shape.siteBuildingData) return false;
  if (!near(shape.position[0], snapshot.position[0]) || !near(shape.position[1], snapshot.position[1]) || !near(shape.position[2], snapshot.position[2])) return false;
  const q = shape.quaternion;
  if (q && (!near(q[0], 0) || !near(q[1], 0) || !near(q[2], 0) || !near(q[3], 1))) return false;
  const s = shape.scale;
  if (s && (!near(s[0], 1) || !near(s[1], 1) || !near(s[2], 1))) return false;
  if (shape.color && shape.color.toLowerCase() !== SITE_BUILDING_COLOR) return false;
  if (shape.hidden) return false;
  return same(identity(shape.siteBuildingData), identity(snapshot.data));
}

export interface SiteEditSets {
  /** Imported buildings still as imported (Google shows them). */
  untouched: Set<string>;
  /** Imported buildings that have been changed or moved (the editable version shows). */
  edited: Shape[];
  /** Imported buildings that were deleted, or are no longer where they were, at their original place. */
  vacated: SiteBuildingSnapshot[];
}

export function siteEditSets(shapes: Shape[], existing: SiteBuildingSnapshot[] | undefined): SiteEditSets {
  const untouched = new Set<string>();
  const edited: Shape[] = [];
  const vacated: SiteBuildingSnapshot[] = [];
  const byId = new Map(shapes.map(s => [s.id, s]));
  for (const snap of existing ?? []) {
    const now = byId.get(snap.id);
    if (!now) { vacated.push(snap); continue; }
    if (isUntouched(now, snap)) untouched.add(snap.id);
    else { edited.push(now); vacated.push(snap); }
  }
  // Site buildings that have no snapshot (added by scripts) count as edited.
  for (const s of shapes) if (s.type === 'site_building' && s.siteBuildingData && !untouched.has(s.id) && !edited.includes(s)) edited.push(s);
  return { untouched, edited, vacated };
}

/** A building's outline in world plan coordinates, [x, z]. Rotation is about the up axis (yaw). */
export function worldRing(ring: Ring, position: [number, number, number], quaternion?: [number, number, number, number], scale?: [number, number, number]): Ring {
  const q = quaternion ?? [0, 0, 0, 1];
  // Yaw from the quaternion (buildings only turn about y).
  const yaw = 2 * Math.atan2(q[1], q[3]);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sx = scale?.[0] ?? 1, sz = scale?.[2] ?? 1;
  return ring.map(([x, z]) => {
    const px = x * sx, pz = z * sz;
    return [position[0] + px * c + pz * s, position[2] - px * s + pz * c] as [number, number];
  });
}

/** Signed area of a ring (positive = counter-clockwise in x/z as drawn). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]!;
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

/**
 * A ring moved outward by `d` metres (inward if negative), by pushing each corner along the
 * mean of its two edge normals. Good for the near-rectangular outlines buildings have; a corner
 * is never pushed further than 3x `d`.
 */
export function growRing(ring: Ring, d: number): Ring {
  const n = ring.length;
  if (n < 3 || d === 0) return ring;
  const sign = ringArea(ring) >= 0 ? 1 : -1; // outward normal is to the right of a counter-clockwise edge
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n]!, b = ring[(i + 1) % n]!;
    const norm = (from: [number, number], to: [number, number]): [number, number] => {
      const dx = to[0] - from[0], dz = to[1] - from[1];
      const len = Math.hypot(dx, dz) || 1;
      return [(dz / len) * sign, (-dx / len) * sign];
    };
    const n1 = norm(a, p), n2 = norm(p, b);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-9) return p;
    mx /= ml; mz /= ml;
    // Miter length: d / cos(half-angle), where cos = mean-normal . edge-normal.
    const cos = Math.max(1 / 3, mx * n1[0] + mz * n1[1]);
    const k = d / cos;
    return [p[0] + mx * k, p[1] + mz * k] as [number, number];
  });
}
