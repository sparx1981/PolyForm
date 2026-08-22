import { describe, it, expect } from 'vitest';
import { createGraph, addVertex, addEdge } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import {
  runDiagnostics, findStrayEdges, findNonManifoldEdges, findNearCoplanar,
  findDegenerateEdges, autoFlatten, planarityOf,
} from './diagnostics';
import { vec3 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId } from './types';

const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1) };
const ctx = (): InsertContext => {
  const graph = createGraph();
  return { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
};

describe('stray edges', () => {
  it('reports without deleting', () => {
    const c = ctx();
    insertEdge(c, vec3(0,0,0), vec3(1,0,0));
    expect(findStrayEdges(c.graph)).toHaveLength(1);
    expect(c.graph.edges.size).toBe(1);   // still there
  });

  it('does not flag edges that bound a face', () => {
    const c = ctx();
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(2,0,0)], [vec3(2,0,0), vec3(2,2,0)],
      [vec3(2,2,0), vec3(0,2,0)], [vec3(0,2,0), vec3(0,0,0)],
    ] as const) for (const t of insertEdge(c, a, b).touched) touched.add(t);
    derive(c.graph, touched, OPTS);
    expect(findStrayEdges(c.graph)).toHaveLength(0);
  });
});

describe('near-coplanar hint (§3)', () => {
  it('a cycle that JUST misses produces a hint, not silence', () => {
    // "Why didn't a surface appear?" is the most common confusion in
    // derived-face modelling, and silence is the worst answer.
    const c = ctx();
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(2,0,0)], [vec3(2,0,0), vec3(2,2,0)],
      [vec3(2,2,0), vec3(0,2,0.01)], [vec3(0,2,0.01), vec3(0,0,0)],
    ] as const) for (const t of insertEdge(c, a, b).touched) touched.add(t);
    derive(c.graph, touched, OPTS);

    expect(c.graph.faces.size).toBe(0);
    const hints = findNearCoplanar(c.graph, T);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]!.message).toMatch(/no surface was created/);
  });

  it('does not flag geometry that is deliberately non-planar', () => {
    // A wall meeting a floor is not a mistake.
    const c = ctx();
    insertEdge(c, vec3(0,0,0), vec3(2,0,0));
    insertEdge(c, vec3(0,0,0), vec3(0,2,0));
    insertEdge(c, vec3(0,0,0), vec3(0,0,2));
    expect(findNearCoplanar(c.graph, T)).toHaveLength(0);
  });
});

describe('auto-flatten (§3)', () => {
  it('projects near-coplanar points onto their best-fit plane', () => {
    const g = createGraph();
    const ids = [
      addVertex(g, vec3(0,0,0)).id, addVertex(g, vec3(2,0,0)).id,
      addVertex(g, vec3(2,2,0)).id, addVertex(g, vec3(0,2,0.02)).id,
    ];
    const before = planarityOf(ids.map(i => g.vertices.get(i)!.position));
    expect(before.deviation).toBeGreaterThan(T.COPLANARITY_TOLERANCE);

    const r = autoFlatten(g, ids, 0.01);
    expect(r.flattened).toBe(true);
    const after = planarityOf(ids.map(i => g.vertices.get(i)!.position));
    expect(after.deviation).toBeLessThan(1e-9);
  });

  it('refuses beyond the threshold rather than mangling geometry', () => {
    const g = createGraph();
    const ids = [
      addVertex(g, vec3(0,0,0)).id, addVertex(g, vec3(2,0,0)).id,
      addVertex(g, vec3(2,2,0)).id, addVertex(g, vec3(0,2,5)).id,
    ];
    expect(autoFlatten(g, ids, 0.01).flattened).toBe(false);
    expect(g.vertices.get(ids[3]!)!.position.z).toBe(5);
  });
});

describe('non-manifold', () => {
  it('reports an edge used by 3+ faces', () => {
    const g = createGraph();
    const a = addVertex(g, vec3(0,0,0)).id;
    const b = addVertex(g, vec3(1,0,0)).id;
    const e = addEdge(g, a, b);
    for (let i = 0; i < 3; i++) e.uses.push({ edge: e.id, loop: i as never, reversed: false });
    expect(findNonManifoldEdges(g)).toEqual([e.id]);
  });
});

describe('degenerate edges', () => {
  it('finds sub-tolerance edges built outside insertion', () => {
    const g = createGraph();
    const a = addVertex(g, vec3(0,0,0)).id;
    const b = addVertex(g, vec3(1e-6,0,0)).id;
    addEdge(g, a, b);
    expect(findDegenerateEdges(g, T)).toHaveLength(1);
  });
});

describe('full report', () => {
  it('summarises a clean model as clean', () => {
    const c = ctx();
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(2,0,0)], [vec3(2,0,0), vec3(2,2,0)],
      [vec3(2,2,0), vec3(0,2,0)], [vec3(0,2,0), vec3(0,0,0)],
    ] as const) for (const t of insertEdge(c, a, b).touched) touched.add(t);
    derive(c.graph, touched, OPTS);

    const r = runDiagnostics(c.graph, T);
    expect(r.counts.strayEdges).toBe(0);
    expect(r.counts.nonManifoldEdges).toBe(0);
    expect(r.counts.nearCoplanarCycles).toBe(0);
  });

  it('counts a lollipop antenna as stray', () => {
    const c = ctx();
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(2,0,0)], [vec3(2,0,0), vec3(2,2,0)],
      [vec3(2,2,0), vec3(0,2,0)], [vec3(0,2,0), vec3(0,0,0)],
      [vec3(2,2,0), vec3(5,5,0)],
    ] as const) for (const t of insertEdge(c, a, b).touched) touched.add(t);
    derive(c.graph, touched, OPTS);
    expect(runDiagnostics(c.graph, T).counts.strayEdges).toBe(1);
  });
});
