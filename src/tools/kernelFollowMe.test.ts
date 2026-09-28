import { describe, expect, it } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { commitKernelFollowMe, outlineEdges, pathFromEdge, pathFromFace, previewFollowMe } from './kernelFollowMe';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, loopPoints } from '../lib/geometry/topology';
import type { EdgeId, FaceId, Graph, Vec3 } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });
const chain = (h: KernelArcHost, pts: Vec3[], closed = false) => {
  for (let i = 0; i + 1 < pts.length; i++) h.commitSegment(pts[i]!, pts[i + 1]!);
  if (closed) h.commitSegment(pts[pts.length - 1]!, pts[0]!);
};
const near = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9;
function faceWith(g: Graph, pts: Vec3[]): FaceId {
  for (const [id, f] of g.faces) if (pts.every(p => loopPoints(g, f.outerLoop).some(q => near(p, q)))) return id;
  throw new Error('no such face');
}
function edgeBetween(g: Graph, a: Vec3, b: Vec3): EdgeId {
  for (const [id, e] of g.edges) {
    const p = g.vertices.get(e.v0)!.position, q = g.vertices.get(e.v1)!.position;
    if ((near(p, a) && near(q, b)) || (near(p, b) && near(q, a))) return id;
  }
  throw new Error('no such edge');
}

const square = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(1, 1, 0), vec3(0, 1, 0)];
const lPath = [vec3(0, 0, 0), vec3(0, 0, 4), vec3(4, 0, 4), vec3(4, 0, 8)];

describe('pathFromEdge', () => {
  it('takes the whole run of lines through the clicked one, stopping at the shape', () => {
    const h = host();
    chain(h, square, true);
    chain(h, lPath); // starts at the shape's corner
    const profile = faceWith(h.graph, square);
    const path = pathFromEdge(h.graph, edgeBetween(h.graph, lPath[1]!, lPath[2]!), outlineEdges(h.graph, profile))!;
    expect(path.closed).toBe(false);
    expect(path.edges).toHaveLength(3);
    const pts = path.points;
    // Either direction is fine; the sweep starts at the end nearer the shape.
    const ordered = near(pts[0]!, lPath[0]!) ? pts : [...pts].reverse();
    expect(ordered.every((p, i) => near(p, lPath[i]!))).toBe(true);
  });

  it('goes all the way round a loop', () => {
    const h = host();
    const loop = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)];
    chain(h, loop, true);
    const path = pathFromEdge(h.graph, edgeBetween(h.graph, loop[1]!, loop[2]!))!;
    expect(path.closed).toBe(true);
    expect(path.points).toHaveLength(4);
  });

  it("uses a face's outline as a loop", () => {
    const h = host();
    const loop = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)];
    chain(h, loop, true);
    const path = pathFromFace(h.graph, faceWith(h.graph, loop))!;
    expect(path.closed).toBe(true);
    expect(path.points).toHaveLength(4);
  });
});

describe('commitKernelFollowMe', () => {
  it('sweeps as one undo step, and a failed sweep changes nothing', () => {
    const h = host();
    // A 0.4 x 0.4 profile standing on the start of an L path, facing along it.
    const profile = [vec3(-0.2, 0, 0), vec3(0.2, 0, 0), vec3(0.2, 0.4, 0), vec3(-0.2, 0.4, 0)];
    chain(h, profile, true);
    chain(h, lPath);
    const id = faceWith(h.graph, profile);
    const path = pathFromEdge(h.graph, edgeBetween(h.graph, lPath[0]!, lPath[1]!), outlineEdges(h.graph, id))!;

    const preview = previewFollowMe(h, id, path);
    expect('segments' in preview && preview.segments.length).toBeGreaterThan(0);

    const facesBefore = h.graph.faces.size;
    expect(commitKernelFollowMe(h, id, path).ok).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);
    // The end cap and four sides per leg - and the path line, lying along the bottom, splits
    // the three bottom panels in two, as it would in SketchUp.
    expect(h.graph.faces.size).toBe(facesBefore + 1 + 4 * 3 + 3);
    h.undo();
    expect(h.graph.faces.size).toBe(facesBefore);

    // A shape lying along its path can't be swept: nothing changes.
    const flat = [vec3(10, 0, 10), vec3(11, 0, 10), vec3(11, 0, 11), vec3(10, 0, 11)];
    chain(h, flat, true);
    const flatId = faceWith(h.graph, flat);
    const before = h.graph.faces.size;
    const r = commitKernelFollowMe(h, flatId, { points: [vec3(10.5, 0, 10.5), vec3(14, 0, 10.5)], closed: false, edges: [] });
    expect(r.ok).toBe(false);
    expect(h.graph.faces.size).toBe(before);
  });
});
