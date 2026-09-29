import { describe, expect, it } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { ArcTool } from './arcTool';
import { commitKernelPushPull } from './kernelPushPull';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, loopPoints } from '../lib/geometry/topology';
import { dot, sub } from '../lib/geometry/math';
import type { Graph, Vec3 } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });
const rect = (h: KernelArcHost, w: number, d: number) => {
  const p = [vec3(0, 0, 0), vec3(w, 0, 0), vec3(w, 0, d), vec3(0, 0, d)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i + 1) % 4]!);
};
const near = (a: Vec3, b: Vec3, tol = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol;
const area = (g: Graph) => {
  let total = 0;
  for (const f of g.faces.values()) {
    const p = loopPoints(g, f.outerLoop);
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!, b = p[(i + 1) % p.length]!;
      sx += a.y * b.z - a.z * b.y; sy += a.z * b.x - a.x * b.z; sz += a.x * b.y - a.y * b.x;
    }
    total += Math.hypot(sx, sy, sz) / 2;
  }
  return total;
};

describe('tangentAt', () => {
  it('runs both ways part way along an edge', () => {
    const h = host();
    h.commitSegment(vec3(0, 0, 0), vec3(4, 0, 0));
    const t = h.tangentAt(vec3(2, 0, 0))!;
    expect(t.bothWays).toBe(true);
    expect(Math.abs(t.dir.x)).toBeCloseTo(1, 9);
  });

  it('comes in one way at the free end of a line, and is not offered at a corner or in space', () => {
    const h = host();
    h.commitSegment(vec3(0, 0, 0), vec3(4, 0, 0));
    expect(h.tangentAt(vec3(4, 0, 0))).toEqual({ dir: { x: -1, y: 0, z: 0 }, bothWays: false });
    h.commitSegment(vec3(4, 0, 0), vec3(4, 0, 3));
    expect(h.tangentAt(vec3(4, 0, 0))).toBeNull();
    expect(h.tangentAt(vec3(9, 0, 9))).toBeNull();
  });
});

describe('an arc leaving the middle of an edge', () => {
  it('is tangent to it, whichever way it goes', () => {
    for (const end of [vec3(6, 0, 2), vec3(-2, 0, 2)]) {
      const h = host();
      h.commitSegment(vec3(0, 0, 0), vec3(8, 0, 0));
      const tool = new ArcTool(h);
      tool.activate('twoPoint');
      tool.click(vec3(4, 0, 0));
      tool.click(end);
      const s = tool.move(vec3(5, 0, 5));
      expect(s.tangentActive).toBe(true);
      expect(s.preview).not.toBeNull();
      // Tangent to the edge (along x) where it starts: the first step is along x.
      const spec = s.preview!;
      const startTangentZ = Math.abs(dot(vec3(0, 0, 1), sub(vec3(spec.centre.x, spec.centre.y, spec.centre.z), vec3(4, 0, 0))));
      expect(startTangentZ).toBeCloseTo(spec.radius, 6); // the centre lies straight off the edge
    }
  });
});

describe('filletTargets', () => {
  it('finds the point on the other edge as far from the corner as the start is', () => {
    const h = host();
    rect(h, 6, 4);
    const targets = h.filletTargets(vec3(4.5, 0, 0));
    // Nearer the (6,0,0) corner: 1.5 from it, so 1.5 along its other edge.
    const t = targets.find(x => near(x.corner, vec3(6, 0, 0)))!;
    expect(near(t.end, vec3(6, 0, 1.5))).toBe(true);
  });

  it('offers nothing at a corner, on a straight run, or when the other edge is too short', () => {
    const h = host();
    rect(h, 6, 1);
    expect(h.filletTargets(vec3(0, 0, 0))).toHaveLength(0);
    expect(h.filletTargets(vec3(3, 0, 0)).some(t => near(t.corner, vec3(0, 0, 0)))).toBe(false); // 3 > 1 along the short edge
  });
});

describe('a fillet', () => {
  it('rounds the corner: an arc tangent to both edges, the corner piece gone, one undo step', () => {
    const h = host();
    rect(h, 6, 4);
    const faceBefore = [...h.graph.faces.keys()];
    expect(faceBefore).toHaveLength(1);
    const startArea = area(h.graph);

    const p0 = vec3(4.5, 0, 0);
    const target = h.filletTargets(p0).find(x => near(x.corner, vec3(6, 0, 0)))!;
    const tool = new ArcTool(h);
    tool.activate('twoPoint');
    tool.click(p0);
    tool.click(target.end);
    tool.setFilletCorner(target.corner);
    const s = tool.move(vec3(5.5, 0, 0.5));
    expect(s.tangentActive).toBe(true);
    const spec = s.preview!;
    // Radius r = d * tan(45 deg) = 1.5 for a right angle, centred 1.5 in from both edges.
    expect(spec.radius).toBeCloseTo(1.5, 6);
    expect(near(spec.centre, vec3(4.5, 0, 1.5), 1e-6)).toBe(true);

    const undoDepth = h.undoDepth;
    tool.click(vec3(5.5, 0, 0.5));
    expect(h.undoDepth).toBe(undoDepth + 1);
    expect(checkIntegrity(h.graph)).toEqual([]);

    // The corner piece is gone: the corner vertex no longer exists.
    expect([...h.graph.vertices.values()].some(v => near(v.position, vec3(6, 0, 0)))).toBe(false);
    // One face remains, smaller than the rectangle by exactly the corner piece: r^2 (1 - pi/4).
    expect(h.graph.faces.size).toBe(1);
    const removed = 1.5 * 1.5 * (1 - Math.PI / 4);
    expect(startArea - area(h.graph)).toBeGreaterThan(removed * 0.97);
    expect(startArea - area(h.graph)).toBeLessThan(removed * 1.03);

    // One undo puts the corner back.
    h.undo();
    expect([...h.graph.vertices.values()].some(v => near(v.position, vec3(6, 0, 0)))).toBe(true);
    expect(h.graph.faces.size).toBe(1);
  });

  it("is not offered at a solid's corner, where trimming would tear the walls", () => {
    const h = host();
    rect(h, 6, 4);
    commitKernelPushPull(h, [...h.graph.faces.keys()][0]!, 2);
    expect(checkIntegrity(h.graph)).toEqual([]);
    expect(h.filletTargets(vec3(4.5, 2, 0))).toHaveLength(0); // three edges meet at each top corner
  });
});
