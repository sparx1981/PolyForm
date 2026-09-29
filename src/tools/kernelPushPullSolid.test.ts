import { describe, expect, it } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { commitKernelPushPull } from './kernelPushPull';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import type { FaceId, Vec3 } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });
const ring = (h: KernelArcHost, pts: Vec3[]) => { for (let i = 0; i < pts.length; i++) h.commitSegment(pts[i]!, pts[(i + 1) % pts.length]!); };
const square = (h: KernelArcHost, x0: number, z0: number, x1: number, z1: number, y = 0) =>
  ring(h, [vec3(x0, y, z0), vec3(x1, y, z0), vec3(x1, y, z1), vec3(x0, y, z1)]);
const faces = (h: KernelArcHost) => [...h.graph.faces.entries()];
/** The face facing `dir` that sits furthest that way. */
const facing = (h: KernelArcHost, dir: 'up' | 'down' | 'east'): FaceId => {
  const axis = dir === 'east' ? 'x' : 'y';
  const sign = dir === 'down' ? -1 : 1;
  let best: FaceId | null = null; let score = -Infinity;
  for (const [id, f] of faces(h)) {
    if (f.plane.normal[axis] * sign < 0.9) continue;
    const at = f.plane.point[axis] * sign;
    if (at > score) { score = at; best = id; }
  }
  return best!;
};
const heights = (h: KernelArcHost) => {
  const ys = [...h.graph.vertices.values()].map(v => v.position.y);
  return [Math.min(...ys), Math.max(...ys)];
};
const closed = (h: KernelArcHost) => [...h.graph.edges.values()].every(e => e.uses.length === 2);
const box = (h: KernelArcHost, w = 4, height = 2) => {
  square(h, 0, 0, w, w);
  commitKernelPushPull(h, [...h.graph.faces.keys()][0]!, height);
};

describe('push/pull on a solid', () => {
  it('a second push on the top of a box moves the top and stretches the walls', () => {
    const h = host(); box(h);
    expect(h.graph.faces.size).toBe(6);
    expect(commitKernelPushPull(h, facing(h, 'up'), 1)).toBe(true);
    expect(h.graph.faces.size).toBe(6); // no new slab, no divider
    expect(heights(h)).toEqual([0, 3]);
    expect(closed(h)).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('keeps going on later pushes without adding faces', () => {
    const h = host(); box(h);
    for (let i = 0; i < 3; i++) expect(commitKernelPushPull(h, facing(h, 'up'), 1)).toBe(true);
    expect(h.graph.faces.size).toBe(6);
    expect(heights(h)[1]).toBeCloseTo(5, 6);
  });

  it('pushing the top down shortens the box', () => {
    const h = host(); box(h);
    expect(commitKernelPushPull(h, facing(h, 'up'), -0.5)).toBe(true);
    expect(h.graph.faces.size).toBe(6);
    expect(heights(h)[1]).toBeCloseTo(1.5, 6);
    expect(closed(h)).toBe(true);
  });

  it('will not push a top through the bottom', () => {
    const h = host(); box(h);
    expect(commitKernelPushPull(h, facing(h, 'up'), -3)).toBe(false);
    expect(heights(h)).toEqual([0, 2]);
    expect(closed(h)).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('pushing a side face lengthens the box', () => {
    const h = host(); box(h);
    expect(commitKernelPushPull(h, facing(h, 'east'), 2)).toBe(true);
    expect(h.graph.faces.size).toBe(6);
    const xs = [...h.graph.vertices.values()].map(v => v.position.x);
    expect(Math.max(...xs)).toBeCloseTo(6, 6);
    expect(closed(h)).toBe(true);
  });

  it('is one undo step', () => {
    const h = host(); box(h);
    commitKernelPushPull(h, facing(h, 'up'), 1);
    h.undo();
    expect(heights(h)).toEqual([0, 2]);
    expect(h.graph.faces.size).toBe(6);
  });

  it('with the copy modifier it stacks a new slab and keeps the divider', () => {
    const h = host(); box(h);
    expect(commitKernelPushPull(h, facing(h, 'up'), 1, { copy: true })).toBe(true);
    expect(h.graph.faces.size).toBeGreaterThan(6);
    expect(heights(h)).toEqual([0, 3]);
  });

  it('a rectangle drawn on top pushed up grows a bump with no floor under it', () => {
    const h = host(); box(h, 6, 2);
    square(h, 1, 1, 3, 3, 2);
    const patch = faces(h).find(([, f]) => f.plane.normal.y > 0.9 && Math.abs(f.plane.point.y - 2) < 1e-6 && f.outerLoop !== undefined && f.innerLoops.length === 0 && faces(h).length > 6 && [...h.graph.vertices.values()].length >= 12)?.[0];
    expect(patch).toBeDefined();
    // The small square is the one whose area is 4.
    const small = faces(h).filter(([, f]) => f.plane.normal.y > 0.9 && Math.abs(f.plane.point.y - 2) < 1e-6).map(([id]) => id);
    const before = h.graph.faces.size;
    const target = small.find(id => {
      const f = h.graph.faces.get(id)!; return f.innerLoops.length === 0;
    })!;
    expect(commitKernelPushPull(h, target, 1)).toBe(true);
    expect(h.graph.faces.size).toBe(before + 4); // four walls, the cap replaces the consumed face
    expect(heights(h)[1]).toBe(3);
    expect(closed(h)).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('a rectangle on top pushed down carves a recess', () => {
    const h = host(); box(h, 6, 2);
    square(h, 1, 1, 3, 3, 2);
    const target = faces(h).find(([, f]) => f.plane.normal.y > 0.9 && Math.abs(f.plane.point.y - 2) < 1e-6 && f.innerLoops.length === 0)![0];
    expect(commitKernelPushPull(h, target, -1)).toBe(true);
    expect(closed(h)).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('a free-standing square still gets a box with its base kept', () => {
    const h = host(); square(h, 0, 0, 4, 4);
    expect(commitKernelPushPull(h, [...h.graph.faces.keys()][0]!, 2)).toBe(true);
    expect(h.graph.faces.size).toBe(6);
    expect(closed(h)).toBe(true);
  });
});
