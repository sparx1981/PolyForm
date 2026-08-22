/**
 * PolyForm geometry kernel — spatial index.
 *
 * A uniform hash grid rather than a BVH. Every edit removes and re-inserts
 * edges (Phase 1a splits them, Phase 8 deletes them), and a hash grid does
 * both in O(1) with no rebalancing, whereas a BVH degrades under incremental
 * churn and needs periodic rebuilds. Drawn geometry is also fairly uniformly
 * distributed, which is the case a grid handles best. §6.5
 *
 * Generic over the item ID so the same structure indexes edges, faces or
 * vertices without duplication.
 */

import type { Bounds, Vec3 } from './types';

export interface Ray {
  readonly origin: Vec3;
  /** Unit length. */
  readonly direction: Vec3;
}

const boundsOf = (points: readonly Vec3[]): Bounds => {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
};

export const boundsFromPoints = boundsOf;

export const expandBounds = (b: Bounds, by: number): Bounds => ({
  min: { x: b.min.x - by, y: b.min.y - by, z: b.min.z - by },
  max: { x: b.max.x + by, y: b.max.y + by, z: b.max.z + by },
});

export const boundsOverlap = (a: Bounds, b: Bounds): boolean =>
  a.min.x <= b.max.x && a.max.x >= b.min.x &&
  a.min.y <= b.max.y && a.max.y >= b.min.y &&
  a.min.z <= b.max.z && a.max.z >= b.min.z;

export const boundsContainPoint = (b: Bounds, p: Vec3): boolean =>
  p.x >= b.min.x && p.x <= b.max.x &&
  p.y >= b.min.y && p.y <= b.max.y &&
  p.z >= b.min.z && p.z <= b.max.z;

/**
 * Items spanning more cells than this in any axis are held in an overflow
 * list checked on every query, rather than stamped into thousands of cells.
 * Without it, one model-spanning edge would cost more to insert than the
 * entire rest of the model.
 */
const MAX_CELL_SPAN = 32;

export class SpatialIndex<T> {
  private readonly cells = new Map<string, Set<T>>();
  private readonly itemBounds = new Map<T, Bounds>();
  private readonly oversized = new Set<T>();
  readonly cellSize: number;

  constructor(cellSize = 1) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new Error(`SpatialIndex cellSize must be positive and finite, got ${cellSize}`);
    }
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.itemBounds.size;
  }

  private key(ix: number, iy: number, iz: number): string {
    return `${ix},${iy},${iz}`;
  }

  private cellIndex(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  private cellRange(b: Bounds) {
    return {
      x0: this.cellIndex(b.min.x), x1: this.cellIndex(b.max.x),
      y0: this.cellIndex(b.min.y), y1: this.cellIndex(b.max.y),
      z0: this.cellIndex(b.min.z), z1: this.cellIndex(b.max.z),
    };
  }

  /** Insert, or move an item already present. */
  insert(item: T, bounds: Bounds): void {
    if (this.itemBounds.has(item)) this.remove(item);
    this.itemBounds.set(item, bounds);

    const r = this.cellRange(bounds);
    const span = Math.max(r.x1 - r.x0, r.y1 - r.y0, r.z1 - r.z0) + 1;
    if (span > MAX_CELL_SPAN) {
      this.oversized.add(item);
      return;
    }

    for (let ix = r.x0; ix <= r.x1; ix++) {
      for (let iy = r.y0; iy <= r.y1; iy++) {
        for (let iz = r.z0; iz <= r.z1; iz++) {
          const k = this.key(ix, iy, iz);
          let cell = this.cells.get(k);
          if (!cell) {
            cell = new Set<T>();
            this.cells.set(k, cell);
          }
          cell.add(item);
        }
      }
    }
  }

  /**
   * Remove an item completely. Leaves no stale entry — a stale candidate is
   * worse than a missing one, because Phase 1a would try to intersect against
   * an edge that no longer exists.
   */
  remove(item: T): boolean {
    const bounds = this.itemBounds.get(item);
    if (!bounds) return false;
    this.itemBounds.delete(item);

    if (this.oversized.delete(item)) return true;

    const r = this.cellRange(bounds);
    for (let ix = r.x0; ix <= r.x1; ix++) {
      for (let iy = r.y0; iy <= r.y1; iy++) {
        for (let iz = r.z0; iz <= r.z1; iz++) {
          const k = this.key(ix, iy, iz);
          const cell = this.cells.get(k);
          if (!cell) continue;
          cell.delete(item);
          if (cell.size === 0) this.cells.delete(k);
        }
      }
    }
    return true;
  }

  update(item: T, bounds: Bounds): void {
    this.insert(item, bounds);
  }

  has(item: T): boolean {
    return this.itemBounds.has(item);
  }

  getBounds(item: T): Bounds | undefined {
    return this.itemBounds.get(item);
  }

  clear(): void {
    this.cells.clear();
    this.itemBounds.clear();
    this.oversized.clear();
  }

  /**
   * Candidates whose bounds overlap the query. A superset — callers still do
   * exact tests. Deterministic ordering: results are sorted so that traversal
   * order never varies between runs. §10.3
   */
  queryBounds(query: Bounds): T[] {
    const found = new Set<T>();
    const r = this.cellRange(query);
    const span = Math.max(r.x1 - r.x0, r.y1 - r.y0, r.z1 - r.z0) + 1;

    if (span > MAX_CELL_SPAN) {
      // Query is huge; scanning items beats stamping through millions of cells.
      for (const [item, b] of this.itemBounds) if (boundsOverlap(b, query)) found.add(item);
      return this.sorted(found);
    }

    for (let ix = r.x0; ix <= r.x1; ix++) {
      for (let iy = r.y0; iy <= r.y1; iy++) {
        for (let iz = r.z0; iz <= r.z1; iz++) {
          const cell = this.cells.get(this.key(ix, iy, iz));
          if (!cell) continue;
          for (const item of cell) {
            const b = this.itemBounds.get(item);
            if (b && boundsOverlap(b, query)) found.add(item);
          }
        }
      }
    }
    for (const item of this.oversized) {
      const b = this.itemBounds.get(item);
      if (b && boundsOverlap(b, query)) found.add(item);
    }
    return this.sorted(found);
  }

  queryPoint(p: Vec3, radius = 0): T[] {
    return this.queryBounds({
      min: { x: p.x - radius, y: p.y - radius, z: p.z - radius },
      max: { x: p.x + radius, y: p.y + radius, z: p.z + radius },
    });
  }

  /**
   * Ray query by 3D DDA — walks only the cells the ray actually passes
   * through, rather than everything in its bounding box, which for a diagonal
   * ray across a large model is a very different amount of work.
   */
  queryRay(ray: Ray, maxDistance = Infinity): T[] {
    const found = new Set<T>();
    for (const item of this.oversized) found.add(item);

    const { origin: o, direction: d } = ray;
    let ix = this.cellIndex(o.x);
    let iy = this.cellIndex(o.y);
    let iz = this.cellIndex(o.z);

    const step = (c: number) => (c > 0 ? 1 : c < 0 ? -1 : 0);
    const sx = step(d.x), sy = step(d.y), sz = step(d.z);

    const tDelta = (c: number) => (c === 0 ? Infinity : Math.abs(this.cellSize / c));
    const tdx = tDelta(d.x), tdy = tDelta(d.y), tdz = tDelta(d.z);

    const nextBoundary = (pos: number, idx: number, s: number) =>
      s > 0 ? (idx + 1) * this.cellSize - pos : s < 0 ? pos - idx * this.cellSize : Infinity;

    let tmx = sx === 0 ? Infinity : nextBoundary(o.x, ix, sx) / Math.abs(d.x);
    let tmy = sy === 0 ? Infinity : nextBoundary(o.y, iy, sy) / Math.abs(d.y);
    let tmz = sz === 0 ? Infinity : nextBoundary(o.z, iz, sz) / Math.abs(d.z);

    let travelled = 0;
    // Bounded so a ray that never leaves an empty region cannot spin forever.
    for (let guard = 0; guard < 100000 && travelled <= maxDistance; guard++) {
      const cell = this.cells.get(this.key(ix, iy, iz));
      if (cell) for (const item of cell) found.add(item);

      if (tmx <= tmy && tmx <= tmz) {
        if (sx === 0) break;
        travelled = tmx; tmx += tdx; ix += sx;
      } else if (tmy <= tmz) {
        if (sy === 0) break;
        travelled = tmy; tmy += tdy; iy += sy;
      } else {
        if (sz === 0) break;
        travelled = tmz; tmz += tdz; iz += sz;
      }
      if (!Number.isFinite(travelled)) break;
    }
    return this.sorted(found);
  }

  /** All items, deterministically ordered. */
  all(): T[] {
    return this.sorted(new Set(this.itemBounds.keys()));
  }

  private sorted(items: Set<T>): T[] {
    return [...items].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : 1,
    );
  }
}

/**
 * A cell size around twice the mean item extent keeps occupancy low without
 * stamping items across many cells. Falls back to the tolerance scale for an
 * empty model.
 */
export function suggestCellSize(extents: readonly number[], fallback = 1): number {
  if (extents.length === 0) return fallback;
  let sum = 0;
  for (const e of extents) sum += e;
  const mean = sum / extents.length;
  return mean > 0 && Number.isFinite(mean) ? mean * 2 : fallback;
}
