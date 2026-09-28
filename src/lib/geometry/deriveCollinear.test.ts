import { describe, it, expect } from 'vitest';
import { KernelLineHost } from '../../tools/kernelLineHost';
import type { Vec3 } from './types';

// A side drawn in several straight pieces (a Bézier's straight span, a polygon clicked part-way
// along a side): the middle pieces only touch pieces of the same line, and used to be left out
// of the face's region, so the face never formed.
const up = { x: 0, y: 1, z: 0 };
const split = (a: Vec3, b: Vec3, n: number): Vec3[] =>
  Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n, z: a.z + (b.z - a.z) * i / n }));
const square = (n: number) => {
  const c: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }];
  return c.flatMap((p, i) => split(p, c[(i + 1) % 4]!, n));
};

describe('faces with sides drawn in several straight pieces', () => {
  for (const n of [1, 2, 3, 8]) {
    it(`closes a face when each side is ${n} piece(s), drawn as one ring`, () => {
      const host = new KernelLineHost({ upAxis: up });
      const r = host.commitIsolatedRing(square(n));
      expect(r.faces).toHaveLength(1);
    });

    it(`closes a face when each side is ${n} piece(s), drawn line by line`, () => {
      const host = new KernelLineHost({ upAxis: up });
      const pts = square(n);
      for (let i = 0; i < pts.length; i++) host.commitSegment(pts[i]!, pts[(i + 1) % pts.length]!);
      expect(host.graph.faces.size).toBe(1);
    });
  }

  it('still leaves a straight line with no corner as a stray edge', () => {
    const host = new KernelLineHost({ upAxis: up });
    host.commitSegment({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    host.commitSegment({ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    host.commitSegment({ x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
    expect(host.graph.faces.size).toBe(0);
  });
});
