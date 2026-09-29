import type { Shape } from '../types';
import { extractRoomFootprintPolygon, insetPolygon2D, slabInsetToInternalFace } from './archRoofGenerator';

/**
 * Floor slabs made by earlier versions were pulled in a whole wall thickness from the walls' centre
 * lines, which left half a wall (10 cm or more) of open gap between the slab and the internal face
 * of the walls. This finds those slabs and moves their outline out to the internal face, so they
 * rest against the wall. Only slabs whose outline is exactly what the old generator produced are
 * touched; a slab that was drawn or edited by hand is left alone. Returns the same array when
 * nothing needed moving.
 */

const MATCH_TOLERANCE = 0.03;
/** Walls belong to a slab when their bottom or top is this close to the slab's middle height. */
const LEVEL_TOLERANCE = 0.3;

type V2 = [number, number];

const wallThickness = (w: Shape) => (Array.isArray(w.args) ? w.args[2] || 0.2 : 0.2);
const wallHeight = (w: Shape) => (Array.isArray(w.args) ? w.args[1] || 2.8 : 2.8);

function isPolySlab(s: Shape): boolean {
  const a = s.args as { vertices?: unknown } | undefined;
  return s.type === 'poly' && !s.hidden && !!s.tags?.includes('floor-slab') && Array.isArray(a?.vertices) && a!.vertices.length >= 3;
}

/** Every polygon point has a partner within tolerance in the other (order and start point free). */
function samePolygon(a: V2[], b: V2[]): boolean {
  if (a.length !== b.length) return false;
  const near = (p: V2, list: V2[]) => list.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) <= MATCH_TOLERANCE);
  return a.every(p => near(p, b)) && b.every(p => near(p, a));
}

export function alignSlabsToWalls(shapes: Shape[]): Shape[] {
  const walls = shapes.filter(s => s.type === 'wall' && !s.hidden);
  if (walls.length < 3) return shapes;
  let changed = false;

  const out = shapes.map(slab => {
    if (!isPolySlab(slab)) return slab;
    const args = slab.args as { vertices: V2[]; height?: number };
    const thickness = typeof args.height === 'number' ? args.height : 0.2;
    const y = slab.position[1];

    const level = walls.filter(w => {
      const half = wallHeight(w) / 2;
      return Math.abs(w.position[1] - half - y) <= LEVEL_TOLERANCE + thickness / 2 || Math.abs(w.position[1] + half - y) <= LEVEL_TOLERANCE + thickness / 2;
    });
    if (level.length < 3) return slab;

    const footprint = extractRoomFootprintPolygon(level);
    if (!footprint || footprint.outline !== 'centerline') return slab;

    const avg = level.reduce((sum, w) => sum + wallThickness(w), 0) / level.length;
    const old = insetPolygon2D(footprint.polygon, Math.max(avg, 0.2));
    const current: V2[] = args.vertices.map(([u, v]) => [u + slab.position[0], v + slab.position[2]]);
    if (!samePolygon(old, current)) return slab;

    const fixed = insetPolygon2D(footprint.polygon, slabInsetToInternalFace('centerline', avg));
    changed = true;
    return {
      ...slab,
      args: { ...args, vertices: fixed.map(([x, z]) => [x - slab.position[0], z - slab.position[2]] as V2) },
    };
  });

  return changed ? out : shapes;
}
