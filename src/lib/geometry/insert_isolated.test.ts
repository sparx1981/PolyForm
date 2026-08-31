import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity } from './topology';
import { createEdgeIndex, insertEdge, insertIsolatedEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { vec3 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId } from './types';

const OPTS = { tolerances: T, upAxis: vec3(0, 1, 0) };

describe('insertIsolatedEdge', () => {
  it('two overlapping rectangles stay two independent faces, not a three-way merge', () => {
    const graph = createGraph();
    const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };

    const touched1 = new Set<EdgeId>();
    const a = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)];
    for (let i = 0; i < 4; i++) {
      for (const t of insertIsolatedEdge(ctx, a[i]!, a[(i + 1) % 4]!).touched) touched1.add(t);
    }
    derive(graph, touched1, OPTS);
    expect(graph.faces.size).toBe(1);

    const touched2 = new Set<EdgeId>();
    const b = [vec3(2, 0, 2), vec3(6, 0, 2), vec3(6, 0, 6), vec3(2, 0, 6)];
    for (let i = 0; i < 4; i++) {
      for (const t of insertIsolatedEdge(ctx, b[i]!, b[(i + 1) % 4]!).touched) touched2.add(t);
    }
    derive(graph, touched2, OPTS);

    // The key assertion: exactly TWO faces, not three. Each rectangle
    // stays intact and independent, even though they geometrically
    // overlap in the (2,2)-(4,4) region.
    expect(graph.faces.size).toBe(2);
    expect(checkIntegrity(graph)).toEqual([]);

    // Each face should still be its own simple 4-sided rectangle, not an
    // L-shape or a shared sliver.
    for (const f of graph.faces.values()) {
      expect(graph.loops.get(f.outerLoop)!.uses.length).toBe(4);
    }
  });

  it('still allows deliberate vertex snapping between an isolated ring and existing geometry', () => {
    const graph = createGraph();
    const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };

    const touched1 = new Set<EdgeId>();
    const a = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)];
    for (let i = 0; i < 4; i++) {
      for (const t of insertIsolatedEdge(ctx, a[i]!, a[(i + 1) % 4]!).touched) touched1.add(t);
    }
    derive(graph, touched1, OPTS);
    const vertexCountBefore = graph.vertices.size;

    // A second rectangle sharing an EXACT corner with the first (4,0,0) —
    // a deliberate snap, not an incidental crossing. Should reuse that
    // vertex, not create a duplicate on top of it.
    const touched2 = new Set<EdgeId>();
    const b = [vec3(4, 0, 0), vec3(8, 0, 0), vec3(8, 0, 4), vec3(4, 0, 4)];
    for (let i = 0; i < 4; i++) {
      for (const t of insertIsolatedEdge(ctx, b[i]!, b[(i + 1) % 4]!).touched) touched2.add(t);
    }
    derive(graph, touched2, OPTS);

    expect(graph.faces.size).toBe(2);
    expect(checkIntegrity(graph)).toEqual([]);
    // Only 2 new vertices, not 4 duplicates on top of shared corners —
    // rectangle B shares TWO corners with rectangle A ((4,0,0) and (4,0,4)),
    // so only (8,0,0) and (8,0,4) are genuinely new. Also implicitly
    // confirms the shared edge itself is reused (findEdgeBetween), not
    // duplicated — otherwise checkIntegrity above would already have caught it.
    expect(graph.vertices.size).toBe(vertexCountBefore + 2);
  });

  it('a ring with a genuinely zero-length side commits nothing for that side', () => {
    const graph = createGraph();
    const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
    const result = insertIsolatedEdge(ctx, vec3(0, 0, 0), vec3(0, 0, 0));
    expect(result.edges).toHaveLength(0);
  });
});
