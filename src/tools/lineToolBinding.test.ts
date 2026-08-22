import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { checkIntegrity, removeFace } from '../lib/geometry/topology';
import { vec3 } from '../lib/geometry/math';

/**
 * The binding itself is a React hook, so these exercise the behaviour it
 * delegates to — which is where the risk actually lives.
 */
const cam = vec3(0, 0, -1);
const up = vec3(0, 1, 0);
const host = () => new KernelArcHost({ cameraDirection: cam, upAxis: up });

/** Ground plane in a Y-up world: y = 0, spanning X and Z. */
const groundSquare = (h: KernelArcHost, n = 4) => {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i+1)%4]!);
};

describe('drag-based line commits (the interaction PolyForm actually uses)', () => {
  it('four drags in a closed loop derive one surface', () => {
    // The whole point: today this produces four cylinders and no surface.
    const h = host();
    groundSquare(h);
    expect(h.graph.faces.size).toBe(1);
    expect(h.graph.edges.size).toBe(4);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('the derived face points UP on a Y-up ground plane', () => {
    const h = host();
    groundSquare(h);
    const face = [...h.graph.faces.values()][0]!;
    expect(face.plane.normal.y).toBeGreaterThan(0.99);
  });

  it('a fifth drag across it splits the surface in two', () => {
    const h = host();
    groundSquare(h);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    expect(h.graph.faces.size).toBe(2);
  });

  it('drags that cross split each other', () => {
    const h = host();
    h.commitSegment(vec3(-2,0,0), vec3(2,0,0));
    h.commitSegment(vec3(0,0,-2), vec3(0,0,2));
    expect(h.graph.edges.size).toBe(4);
    expect(h.graph.vertices.size).toBe(5);
  });

  it('a zero-length drag is absorbed and consumes no undo entry', () => {
    // Overwhelmingly a slip — a click that registered as a drag.
    const h = host();
    const r = h.commitSegment(vec3(1,0,1), vec3(1,0,1));
    expect(r.ok).toBe(false);
    expect(h.graph.edges.size).toBe(0);
    expect(h.undoDepth).toBe(0);
  });

  it('one drag is one undo entry', () => {
    const h = host();
    groundSquare(h);
    expect(h.undoDepth).toBe(4);
    h.undo();
    expect(h.graph.faces.size).toBe(0);
    expect(h.graph.edges.size).toBe(3);
  });

  it('re-drawing over an existing edge heals a deleted face', () => {
    // Retrace-to-heal, reachable through the drag interaction. The commit
    // creates no edge and must still derive.
    const h = host();
    groundSquare(h);
    removeFace(h.graph, [...h.graph.faces.keys()][0]!);
    expect(h.graph.faces.size).toBe(0);

    const r = h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    expect(r.ok).toBe(true);
    expect(r.wasOverdraw).toBe(true);
    expect(h.graph.edges.size).toBe(4);   // nothing new created
    expect(h.graph.faces.size).toBe(1);   // and the face is back
  });

  it('snaps an endpoint landing within tolerance of an existing vertex', () => {
    const h = host();
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    h.commitSegment(vec3(4.0000001,0,0), vec3(4,0,4));
    expect(h.graph.vertices.size).toBe(3);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});
