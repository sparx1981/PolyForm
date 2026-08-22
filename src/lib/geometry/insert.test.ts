import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, edgePoints, getEdge } from './topology';
import { insertEdge, createEdgeIndex, type InsertContext } from './insert';
import { vec3, distance } from './math';
import { DEFAULT_TOLERANCES } from './types';

function ctx(): InsertContext {
  const graph = createGraph();
  return { graph, tolerances: DEFAULT_TOLERANCES, index: createEdgeIndex(graph, 1) };
}

describe('basic insertion', () => {
  it('creates one edge and two vertices', () => {
    const c = ctx();
    const r = insertEdge(c, vec3(0, 0, 0), vec3(1, 0, 0));
    expect(r.edges).toHaveLength(1);
    expect(c.graph.vertices.size).toBe(2);
    expect(r.touched.size).toBe(1);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('discards an edge below MIN_EDGE_LENGTH', () => {
    const c = ctx();
    const r = insertEdge(c, vec3(0, 0, 0), vec3(1e-6, 0, 0));
    expect(r.edges).toHaveLength(0);
    expect(c.graph.edges.size).toBe(0);
  });

  it('merges an endpoint landing within tolerance of an existing vertex', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(1 + 1e-5, 0, 0), vec3(1, 1, 0));
    // No near-duplicate vertex. R1
    expect(c.graph.vertices.size).toBe(3);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });
});

describe('crossing edges (R2)', () => {
  it('two crossing lines give 4 edges and 5 vertices', () => {
    const c = ctx();
    insertEdge(c, vec3(-1, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(0, -1, 0), vec3(0, 1, 0));
    expect(c.graph.edges.size).toBe(4);
    expect(c.graph.vertices.size).toBe(5);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('does not split when segments merely touch at a shared endpoint', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(1, 1, 0));
    expect(c.graph.edges.size).toBe(2);
    expect(c.graph.vertices.size).toBe(3);
  });

  it('leaves skew lines alone', () => {
    const c = ctx();
    insertEdge(c, vec3(-1, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(0, -1, 5), vec3(0, 1, 5));
    expect(c.graph.edges.size).toBe(2);
    expect(c.graph.vertices.size).toBe(4);
  });

  it('splits an existing edge when a new endpoint lands on its interior', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(1, 1, 0));
    expect(c.graph.edges.size).toBe(3);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });
});

describe('colinear overlap (R2b)', () => {
  it('exact retrace creates nothing but still marks the graph changed', () => {
    // The behaviour retrace-to-heal depends on. Skipping derivation when no
    // edge was created is the obvious optimisation and it breaks healing. §6.2
    const c = ctx();
    const first = insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    const originalId = first.edges[0]!;
    const before = c.graph.edges.size;

    const retrace = insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));

    expect(c.graph.edges.size).toBe(before);
    expect(retrace.wasOverdraw).toBe(true);
    expect(retrace.touched.size).toBeGreaterThan(0);
    // Existing edge identity preserved — it carries the uses live faces hold.
    expect(retrace.edges).toEqual([originalId]);
    expect(retrace.touched.has(originalId)).toBe(true);
  });

  it('retrace in the reverse direction is still a retrace', () => {
    const c = ctx();
    const first = insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    const r = insertEdge(c, vec3(2, 0, 0), vec3(0, 0, 0));
    expect(c.graph.edges.size).toBe(1);
    expect(r.edges).toEqual(first.edges);
    expect(r.wasOverdraw).toBe(true);
  });

  it('half-overlap extending past the end yields 2 edges', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(3, 0, 0));
    // 0-1, 1-2, 2-3
    expect(c.graph.edges.size).toBe(3);
    expect(c.graph.vertices.size).toBe(4);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('fully contained overlap yields 3 edges with no duplicates', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(3, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(2, 0, 0));
    expect(c.graph.edges.size).toBe(3);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('drawing over two contiguous colinear edges creates nothing new', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(2, 0, 0));
    const before = c.graph.edges.size;
    const r = insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    expect(c.graph.edges.size).toBe(before);
    expect(r.edges).toHaveLength(2);
    expect(r.wasOverdraw).toBe(true);
  });

  it('never leaves two edges occupying the same span', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    insertEdge(c, vec3(0.5, 0, 0), vec3(1.5, 0, 0));
    insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    const spans = [...c.graph.edges.values()].map(e => {
      const [a, b] = edgePoints(c.graph, e);
      return [Math.min(a.x, b.x), Math.max(a.x, b.x)].join(':');
    });
    expect(new Set(spans).size).toBe(spans.length);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('parallel but separated lines do not overlap-resolve', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(2, 0, 0));
    insertEdge(c, vec3(0, 1, 0), vec3(2, 1, 0));
    expect(c.graph.edges.size).toBe(2);
    expect(c.graph.vertices.size).toBe(4);
  });
});

describe('closed loops', () => {
  it('four segments close a square with 4 edges and 4 vertices', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(1, 1, 0));
    insertEdge(c, vec3(1, 1, 0), vec3(0, 1, 0));
    insertEdge(c, vec3(0, 1, 0), vec3(0, 0, 0));
    expect(c.graph.edges.size).toBe(4);
    expect(c.graph.vertices.size).toBe(4);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('a diagonal across a square splits nothing but adds one edge', () => {
    const c = ctx();
    insertEdge(c, vec3(0, 0, 0), vec3(1, 0, 0));
    insertEdge(c, vec3(1, 0, 0), vec3(1, 1, 0));
    insertEdge(c, vec3(1, 1, 0), vec3(0, 1, 0));
    insertEdge(c, vec3(0, 1, 0), vec3(0, 0, 0));
    insertEdge(c, vec3(0, 0, 0), vec3(1, 1, 0));
    expect(c.graph.edges.size).toBe(5);
    expect(c.graph.vertices.size).toBe(4);
  });
});

describe('determinism', () => {
  it('produces identical graphs across runs', () => {
    const build = () => {
      const c = ctx();
      insertEdge(c, vec3(-1, 0, 0), vec3(1, 0, 0));
      insertEdge(c, vec3(0, -1, 0), vec3(0, 1, 0));
      insertEdge(c, vec3(-1, -1, 0), vec3(1, 1, 0));
      return [...c.graph.edges.keys()].sort((a, b) => a - b).join(',');
    };
    expect(build()).toBe(build());
  });
});
