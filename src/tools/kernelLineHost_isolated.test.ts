import { describe, it, expect } from 'vitest';
import { KernelLineHost } from './kernelLineHost';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';

const cam = vec3(0, 0, -1);

const square = (host: KernelLineHost, points: readonly ReturnType<typeof vec3>[]) => {
  for (let i = 0; i < points.length; i++) {
    host.commitIsolatedSegment(points[i]!, points[(i + 1) % points.length]!);
  }
};

describe('commitIsolatedSegment — two overlapping shapes stay independent', () => {
  it('two overlapping rectangles produce two independent faces, not a three-way merge', () => {
    // The actual regression this exists to fix: with the ordinary,
    // sticky commitSegment (what Rectangle/Circle/Triangle used to call
    // via lineBinding.commitDrag), two overlapping rectangles split into
    // three faces — two L-shaped remainders plus a shared overlap piece
    // — because crossing an edge always means "connect into it." A
    // rectangle drawn as one gesture is a different kind of action, and
    // should not do that.
    const host = new KernelLineHost({ cameraDirection: cam });
    square(host, [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)]);
    expect(host.graph.faces.size).toBe(1);

    square(host, [vec3(2, 0, 2), vec3(6, 0, 2), vec3(6, 0, 6), vec3(2, 0, 6)]);
    expect(host.graph.faces.size).toBe(2);
    expect(checkIntegrity(host.graph)).toEqual([]);
    for (const f of host.graph.faces.values()) {
      expect(host.graph.loops.get(f.outerLoop)!.uses.length).toBe(4);
    }
  });

  it('still allows a deliberate shared-corner snap between two isolated shapes', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    square(host, [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)]);
    const vertexCountBefore = host.graph.vertices.size;

    // Rectangle B shares a full edge with rectangle A — a deliberate
    // adjacency, not an incidental crossing. Only 2 genuinely new
    // vertices, and the shared edge itself gets reused, not duplicated.
    square(host, [vec3(4, 0, 0), vec3(8, 0, 0), vec3(8, 0, 4), vec3(4, 0, 4)]);
    expect(host.graph.faces.size).toBe(2);
    expect(checkIntegrity(host.graph)).toEqual([]);
    expect(host.graph.vertices.size).toBe(vertexCountBefore + 2);
  });

  it('one segment is one undo entry, same as commitSegment', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const depthBefore = host.undoDepth;
    host.commitIsolatedSegment(vec3(0, 0, 0), vec3(4, 0, 0));
    expect(host.undoDepth).toBe(depthBefore + 1);
  });

  it('rejects a zero-length segment the same way commitSegment does', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const result = host.commitIsolatedSegment(vec3(0, 0, 0), vec3(0, 0, 0));
    expect(result.ok).toBe(false);
    expect(host.graph.edges.size).toBe(0);
  });
});
