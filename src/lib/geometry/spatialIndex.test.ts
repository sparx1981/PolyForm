import { describe, it, expect } from 'vitest';
import { SpatialIndex, boundsFromPoints, boundsOverlap, suggestCellSize } from './spatialIndex';
import { vec3 } from './math';
import type { Bounds } from './types';

const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Bounds =>
  ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

/** Deterministic PRNG so failures reproduce exactly. No Math.random. §10.3 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('SpatialIndex basics', () => {
  it('inserts and finds by bounds', () => {
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(0, 0, 0, 1, 1, 1));
    idx.insert(2, b(10, 10, 10, 11, 11, 11));
    expect(idx.queryBounds(b(0, 0, 0, 2, 2, 2))).toEqual([1]);
    expect(idx.queryBounds(b(9, 9, 9, 12, 12, 12))).toEqual([2]);
  });

  it('leaves no stale entry after removal', () => {
    // A stale candidate is worse than a missing one: Phase 1a would try to
    // intersect against an edge that no longer exists.
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(0, 0, 0, 1, 1, 1));
    expect(idx.remove(1)).toBe(true);
    expect(idx.queryBounds(b(-5, -5, -5, 5, 5, 5))).toEqual([]);
    expect(idx.has(1)).toBe(false);
    expect(idx.size).toBe(0);
  });

  it('moves an item on re-insert without duplicating it', () => {
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(0, 0, 0, 1, 1, 1));
    idx.update(1, b(20, 20, 20, 21, 21, 21));
    expect(idx.queryBounds(b(0, 0, 0, 2, 2, 2))).toEqual([]);
    expect(idx.queryBounds(b(19, 19, 19, 22, 22, 22))).toEqual([1]);
    expect(idx.size).toBe(1);
  });

  it('returns deterministic ordering', () => {
    const idx = new SpatialIndex<number>(1);
    for (const i of [5, 2, 9, 1]) idx.insert(i, b(0, 0, 0, 1, 1, 1));
    expect(idx.queryBounds(b(0, 0, 0, 1, 1, 1))).toEqual([1, 2, 5, 9]);
  });

  it('rejects a non-positive cell size', () => {
    expect(() => new SpatialIndex<number>(0)).toThrow();
  });

  it('handles an item spanning many cells', () => {
    const idx = new SpatialIndex<number>(0.01); // forces the oversized path
    idx.insert(1, b(-100, -100, -100, 100, 100, 100));
    expect(idx.queryBounds(b(0, 0, 0, 1, 1, 1))).toEqual([1]);
    idx.remove(1);
    expect(idx.queryBounds(b(0, 0, 0, 1, 1, 1))).toEqual([]);
  });
});

describe('SpatialIndex at scale', () => {
  it('returns exactly the correct candidates for 10,000 edges', () => {
    const rnd = mulberry32(42);
    const idx = new SpatialIndex<number>(2);
    const all: { id: number; bounds: Bounds }[] = [];
    for (let i = 0; i < 10000; i++) {
      const x = rnd() * 100, y = rnd() * 100, z = rnd() * 100;
      const bb = boundsFromPoints([vec3(x, y, z), vec3(x + rnd(), y + rnd(), z + rnd())]);
      idx.insert(i, bb);
      all.push({ id: i, bounds: bb });
    }
    const query = b(20, 20, 20, 30, 30, 30);
    const expected = all.filter(a => boundsOverlap(a.bounds, query)).map(a => a.id).sort((p, q) => p - q);
    expect(idx.queryBounds(query)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('beats a linear scan', () => {
    const rnd = mulberry32(7);
    const idx = new SpatialIndex<number>(2);
    const all: { id: number; bounds: Bounds }[] = [];
    for (let i = 0; i < 10000; i++) {
      const x = rnd() * 200, y = rnd() * 200, z = rnd() * 200;
      const bb = boundsFromPoints([vec3(x, y, z), vec3(x + 0.5, y + 0.5, z + 0.5)]);
      idx.insert(i, bb);
      all.push({ id: i, bounds: bb });
    }
    const query = b(50, 50, 50, 52, 52, 52);

    const t0 = performance.now();
    for (let k = 0; k < 200; k++) idx.queryBounds(query);
    const indexed = performance.now() - t0;

    const t1 = performance.now();
    for (let k = 0; k < 200; k++) all.filter(a => boundsOverlap(a.bounds, query));
    const linear = performance.now() - t1;

    expect(indexed).toBeLessThan(linear);
  });
});

describe('ray query', () => {
  it('finds items along an axis-aligned ray', () => {
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(5, 0, 0, 6, 1, 1));
    idx.insert(2, b(0, 5, 0, 1, 6, 1));
    const hits = idx.queryRay({ origin: vec3(0, 0.5, 0.5), direction: vec3(1, 0, 0) }, 20);
    expect(hits).toContain(1);
    expect(hits).not.toContain(2);
  });

  it('finds items along a diagonal ray', () => {
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(4.9, 4.9, 4.9, 5.1, 5.1, 5.1));
    const d = 1 / Math.sqrt(3);
    const hits = idx.queryRay({ origin: vec3(0, 0, 0), direction: vec3(d, d, d) }, 50);
    expect(hits).toContain(1);
  });

  it('respects maxDistance', () => {
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(50, 0, 0, 51, 1, 1));
    const hits = idx.queryRay({ origin: vec3(0, 0.5, 0.5), direction: vec3(1, 0, 0) }, 5);
    expect(hits).not.toContain(1);
  });

  it('terminates on a ray through empty space', () => {
    const idx = new SpatialIndex<number>(1);
    idx.insert(1, b(0, 0, 0, 1, 1, 1));
    expect(() => idx.queryRay({ origin: vec3(1000, 1000, 1000), direction: vec3(1, 0, 0) })).not.toThrow();
  });
});

describe('suggestCellSize', () => {
  it('scales with mean extent', () => {
    expect(suggestCellSize([1, 1, 1])).toBe(2);
    expect(suggestCellSize([])).toBe(1);
  });
});
