import type { Shape, TerrainData } from '../../types';

/** Optical presets: how fast each colour channel is absorbed and scattered per metre. */
export type WaterClarity = 'clear' | 'lake' | 'pond' | 'murky';

export interface WaterData {
  /** Outline in metres, relative to the shape position (whose y is the water level). */
  points: [number, number][];
  /** Deepest point below the water level, metres. */
  depth: number;
  clarity: WaterClarity;
  /** Dig a basin into the terrain under the outline (the default). */
  dig: boolean;
}

export const WATER_CLARITY: Record<WaterClarity, { label: string; absorb: [number, number, number]; scatter: [number, number, number] }> = {
  // Clearwater's calibrated shallow sea: red goes first, then blue; green-blue shallows.
  clear: { label: 'Crystal clear', absorb: [0.40, 0.074, 0.088], scatter: [0.028, 0.052, 0.068] },
  lake: { label: 'Clean lake', absorb: [0.55, 0.13, 0.12], scatter: [0.05, 0.08, 0.09] },
  pond: { label: 'Garden pond', absorb: [0.75, 0.32, 0.45], scatter: [0.07, 0.10, 0.06] },
  murky: { label: 'Murky', absorb: [1.4, 0.9, 1.1], scatter: [0.25, 0.22, 0.12] },
};

type Vec = { x: number; z: number };

export function waterWorldOutline(shape: Shape): Vec[] {
  const [px, , pz] = shape.position;
  return (shape.waterData?.points ?? []).map(([x, z]) => ({ x: px + x, z: pz + z }));
}

export function pointInPolygon(x: number, z: number, polygon: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the outline; positive inside, negative outside. */
export function signedEdgeDistance(x: number, z: number, polygon: Vec[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return pointInPolygon(x, z, polygon) ? best : -best;
}

/** Largest distance from the edge to any interior point, sampled: sets how quickly the bed deepens. */
function inscribedRadius(polygon: Vec[]): number {
  const xs = polygon.map(p => p.x), zs = polygon.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  let best = 0;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
    best = Math.max(best, signedEdgeDistance(minX + (maxX - minX) * i / 12, minZ + (maxZ - minZ) * j / 12, polygon));
  }
  return Math.max(best, 0.1);
}

/** Water depth at a signed edge distance: a short shallow shelf, then a smooth bowl. */
export function bedDepth(distanceInside: number, depth: number, radius: number): number {
  const lip = Math.min(0.15, depth);
  const t = Math.max(0, Math.min(1, distanceInside / Math.max(0.5, radius * 0.85)));
  return lip + (depth - lip) * t * t * (3 - 2 * t);
}

/** How far past the outline the basin is dug: one terrain grid cell (plus a little). */
export function waterMargin(terrain: Shape | undefined): number {
  const data = terrain?.terrainData;
  if (!data) return 0;
  const cell = Math.max(data.width / Math.max(1, data.gridX - 1), data.depth / Math.max(1, data.gridY - 1));
  return Math.min(cell * 1.05, 4);
}

/**
 * The outline pushed outward by `distance` (mitred, with long spikes clipped). The water
 * surface uses it so it reaches the dug margin; ground above the level simply hides it.
 */
export function offsetOutline(points: [number, number][], distance: number): [number, number][] {
  if (distance <= 0 || points.length < 3) return points;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    area += ax * bz - bx * az;
  }
  const outward = area > 0 ? 1 : -1;
  return points.map((p, i) => {
    const prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
    const normal = (a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
      return [outward * dz / length, -outward * dx / length];
    };
    const n1 = normal(prev, p), n2 = normal(p, next);
    let nx = n1[0] + n2[0], nz = n1[1] + n2[1];
    const length = Math.hypot(nx, nz) || 1;
    nx /= length; nz /= length;
    // Mitre length, clipped so sharp corners don't shoot out.
    const scale = Math.min(3, 1 / Math.max(0.2, nx * n1[0] + nz * n1[1]));
    return [p[0] + nx * distance * scale, p[1] + nz * distance * scale];
  });
}

/** Bank width outside the outline over which low ground is raised to hold the water in. */
const BANK = 1.5;
const FREEBOARD = 0.08;

/**
 * Terrain heights with every digging water body's basin applied. Derived, never saved: deleting
 * a pond, moving it or undoing restores the ground exactly, and sculpting is never overwritten.
 */
export function digWaterBasins(terrain: Shape, waters: Shape[]): TerrainData | undefined {
  const data = terrain.terrainData;
  if (!data?.heights) return data;
  const bodies = waters
    .filter(w => w.type === 'water' && !w.hidden && w.waterData?.dig !== false && (w.waterData?.points.length ?? 0) >= 3)
    .map(w => {
      const outline = waterWorldOutline(w);
      const xs = outline.map(p => p.x), zs = outline.map(p => p.z);
      return {
        outline, level: w.position[1], depth: Math.max(0.1, w.waterData!.depth), radius: inscribedRadius(outline),
        box: [Math.min(...xs) - BANK - 4, Math.max(...xs) + BANK + 4, Math.min(...zs) - BANK - 4, Math.max(...zs) + BANK + 4],
      };
    });
  if (!bodies.length) return data;
  const { gridX, gridY, width, depth } = data;
  const [px, py, pz] = terrain.position;
  const heights = data.heights.slice();
  // The terrain is a grid: dig one cell past the outline, or triangles that straddle the edge
  // (and whole small ponds on a coarse grid) stay above the water and hide it.
  const margin = waterMargin(terrain);
  let changed = false;
  for (let iy = 0; iy < gridY; iy++) for (let ix = 0; ix < gridX; ix++) {
    const x = px - width / 2 + (ix / Math.max(1, gridX - 1)) * width;
    const z = pz - depth / 2 + (iy / Math.max(1, gridY - 1)) * depth;
    const index = iy * gridX + ix;
    let y = py + heights[index];
    for (const body of bodies) {
      if (x < body.box[0] || x > body.box[1] || z < body.box[2] || z > body.box[3]) continue;
      const d = signedEdgeDistance(x, z, body.outline);
      if (d >= -margin) {
        y = Math.min(y, body.level - bedDepth(Math.max(d, 0), body.depth, body.radius));
      } else if (-d < margin + BANK) {
        // Raise low ground just outside so the water has a bank to sit against.
        const bank = body.level + FREEBOARD;
        if (y < bank) {
          // Full height for the first 40% of the bank, then easing back to the natural ground.
          const t = Math.max(0, Math.min(1, ((-d - margin) / BANK - 0.4) / 0.6)), w = 1 - t * t * (3 - 2 * t);
          y += (bank - y) * w;
        }
      }
    }
    const local = y - py;
    if (local !== heights[index]) { heights[index] = local; changed = true; }
  }
  return changed ? { ...data, heights } : data;
}

/**
 * Default water level for a new outline: just under the lowest ground along it, so the whole
 * edge meets the water and nothing spills.
 */
export function defaultWaterLevel(outline: Vec[], groundAt: (x: number, z: number) => number): number {
  let low = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    for (let s = 0; s < steps; s++) low = Math.min(low, groundAt(a.x + (b.x - a.x) * s / steps, a.z + (b.z - a.z) * s / steps));
  }
  return low - 0.05;
}

const basinCache = new WeakMap<TerrainData, { key: string; data: TerrainData | undefined }>();

/**
 * Terrain shapes as they should be drawn and sampled, with water basins dug. Cached per
 * terrain until its heights or any digging water body change, so it is cheap to call each render.
 */
export function terrainsWithWaterBasins(shapes: Shape[]): Map<string, Shape> {
  const waters = shapes.filter(s => s.type === 'water' && s.waterData);
  const key = JSON.stringify(waters.map(w => [w.position, w.hidden, w.waterData]));
  const result = new Map<string, Shape>();
  for (const terrain of shapes) {
    if (terrain.type !== 'terrain' || !terrain.terrainData) continue;
    let cached = basinCache.get(terrain.terrainData);
    const fullKey = key + JSON.stringify(terrain.position);
    if (!cached || cached.key !== fullKey) {
      cached = { key: fullKey, data: digWaterBasins(terrain, waters) };
      basinCache.set(terrain.terrainData, cached);
    }
    result.set(terrain.id, cached.data === terrain.terrainData ? terrain : { ...terrain, terrainData: cached.data });
  }
  return result;
}
