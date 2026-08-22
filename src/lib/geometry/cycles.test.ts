import { describe, it, expect } from 'vitest';
import { createGraph, addVertex, addEdge } from './topology';
import { insertEdge, createEdgeIndex, type InsertContext } from './insert';
import { findCycles, edgeSetHash } from './cycles';
import { vec3 } from './math';
import { DEFAULT_TOLERANCES } from './types';
import type { EdgeId } from './types';

const XY_BASIS = {
  origin: vec3(0, 0, 0), u: vec3(1, 0, 0), v: vec3(0, 1, 0), normal: vec3(0, 0, 1),
};

function build(segments: [number, number, number, number][]) {
  const graph = createGraph();
  const c: InsertContext = { graph, tolerances: DEFAULT_TOLERANCES, index: createEdgeIndex(graph, 1) };
  for (const [x0, y0, x1, y1] of segments) insertEdge(c, vec3(x0, y0, 0), vec3(x1, y1, 0));
  const region = new Set<EdgeId>(graph.edges.keys());
  return { graph, region, result: findCycles(graph, region, XY_BASIS, DEFAULT_TOLERANCES) };
}

const SQUARE: [number, number, number, number][] = [
  [0, 0, 2, 0], [2, 0, 2, 2], [2, 2, 0, 2], [0, 2, 0, 0],
];

describe('winding invariants', () => {
  it('every returned ring is counter-clockwise', () => {
    // Outer loops positive, inner loops negative, sums to the true area. §6.4
    for (const segs of [SQUARE, [...SQUARE, [0, 0, 2, 2] as [number,number,number,number]]]) {
      const { result } = build(segs);
      for (const r of result.rings) expect(r.signedArea).toBeGreaterThan(0);
    }
  });
});

describe('basic shapes', () => {
  it('rectangle gives 1 ring of the right area', () => {
    const { result } = build(SQUARE);
    expect(result.rings).toHaveLength(1);
    expect(result.rings[0]!.signedArea).toBeCloseTo(4, 9);
    expect(result.rings[0]!.edges).toHaveLength(4);
  });

  it('rectangle plus a diagonal gives 2 rings summing to the same area', () => {
    const { result } = build([...SQUARE, [0, 0, 2, 2]]);
    expect(result.rings).toHaveLength(2);
    const total = result.rings.reduce((s, r) => s + r.signedArea, 0);
    expect(total).toBeCloseTo(4, 9);
  });

  it('concave L-shape gives 1 ring', () => {
    const { result } = build([
      [0, 0, 3, 0], [3, 0, 3, 1], [3, 1, 1, 1],
      [1, 1, 1, 3], [1, 3, 0, 3], [0, 3, 0, 0],
    ]);
    expect(result.rings).toHaveLength(1);
    expect(result.rings[0]!.signedArea).toBeCloseTo(5, 9);
  });

  it('rectangle with an inner square gives an island plus a hole', () => {
    // Drawing a closed cycle inside a face: an inner face is derived AND the
    // outer face gains an inner loop. Both use the same edges. §2.4
    const { result } = build([
      [0, 0, 4, 0], [4, 0, 4, 4], [4, 4, 0, 4], [0, 4, 0, 0],
      [1, 1, 3, 1], [3, 1, 3, 3], [3, 3, 1, 3], [1, 3, 1, 1],
    ]);
    expect(result.rings).toHaveLength(2);
    const outerIdx = result.rings.findIndex(r => Math.abs(r.signedArea - 16) < 1e-9);
    const innerIdx = result.rings.findIndex(r => Math.abs(r.signedArea - 4) < 1e-9);
    expect(outerIdx).toBeGreaterThanOrEqual(0);
    expect(innerIdx).toBeGreaterThanOrEqual(0);
    expect(result.parentOf[innerIdx]).toBe(outerIdx);
    expect(result.parentOf[outerIdx]).toBe(-1);
  });

  it('inner square bisected gives the outer plus two islands', () => {
    const { result } = build([
      [0, 0, 6, 0], [6, 0, 6, 6], [6, 6, 0, 6], [0, 6, 0, 0],
      [1, 1, 5, 1], [5, 1, 5, 5], [5, 5, 1, 5], [1, 5, 1, 1],
      [1, 3, 5, 3],
    ]);
    // outer + two halves of the island
    expect(result.rings).toHaveLength(3);
    const children = result.parentOf.filter(p => p >= 0);
    expect(children).toHaveLength(2);
  });
});

describe('THE minimal-turn check: figure-eight', () => {
  it('two triangles sharing one degree-4 vertex give exactly 2 faces', () => {
    // A traversal that takes SOME edge in the right rotational direction
    // rather than the strictly adjacent one traces a self-crossing perimeter
    // around both triangles and emits one invalid face. This is the cheapest
    // available check that the traversal is genuinely correct. §6.2
    const { result, graph } = build([
      [0, 0, 2, 0], [2, 0, 1, 2], [1, 2, 0, 0],      // lower triangle
      [1, 2, 3, 2], [3, 2, 2, 4], [2, 4, 1, 2],      // upper triangle, shares (1,2)
    ]);
    expect(result.rings).toHaveLength(2);
    for (const r of result.rings) {
      expect(r.edges).toHaveLength(3);
      expect(r.signedArea).toBeGreaterThan(0);
    }
    // The pinch vertex is legal geometry: degree 4, no non-manifold EDGE.
    const pinch = [...graph.vertices.values()].find(v =>
      Math.abs(v.position.x - 1) < 1e-9 && Math.abs(v.position.y - 2) < 1e-9)!;
    expect(pinch.edges.length).toBe(4);
  });
});

describe('pruning (Phase 3a)', () => {
  it('lollipop: 1 face, antenna pruned but still in the model', () => {
    const { result, graph } = build([...SQUARE, [2, 2, 5, 5]]);
    expect(result.rings).toHaveLength(1);
    expect(result.pruned.size).toBe(1);
    // Pruned means excluded from derivation, NOT deleted.
    expect(graph.edges.size).toBe(5);
    expect(result.diagnostics.some(d => d.kind === 'stray-edge')).toBe(true);
  });

  it('branching antenna: pruning iterates to stable', () => {
    const { result } = build([
      ...SQUARE,
      [2, 2, 4, 4], [4, 4, 6, 4], [4, 4, 4, 6], [6, 4, 7, 5],
    ]);
    expect(result.rings).toHaveLength(1);
    expect(result.pruned.size).toBe(4);
  });

  it('two loops joined by a stick: 2 faces, bridge excluded, no pinched spur', () => {
    // Both ends of the bridge have degree >= 2, so leaf pruning misses it.
    const { result } = build([
      [0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0],
      [1, 0.5, 4, 0.5],
      [4, 0, 5, 0], [5, 0, 5, 1], [5, 1, 4, 1], [4, 1, 4, 0],
    ]);
    expect(result.rings).toHaveLength(2);
    for (const r of result.rings) expect(r.signedArea).toBeCloseTo(1, 9);
    expect(result.pruned.size).toBeGreaterThanOrEqual(1);
  });

  it('an open chain yields no faces at all', () => {
    const { result } = build([[0, 0, 1, 0], [1, 0, 2, 0], [2, 0, 2, 1]]);
    expect(result.rings).toHaveLength(0);
  });
});

describe('sliver rejection', () => {
  it('rejects a needle cycle but keeps its edges', () => {
    // Built directly on the topology store, NOT via insertEdge. With default
    // tolerances any triangle thin enough to be a sliver has its apex within
    // VERTEX_MERGE_TOLERANCE of the base, so insertion collapses it first —
    // defence in depth. The cycle-level guard exists for geometry that did
    // not come through insertion: imports, and vertices moved after the fact.
    const graph = createGraph();
    const a = addVertex(graph, vec3(0, 0, 0)).id;
    const b = addVertex(graph, vec3(1.5e-3, 0, 0)).id;
    const c = addVertex(graph, vec3(0.75e-3, 1.1e-3, 0)).id;
    addEdge(graph, a, b); addEdge(graph, b, c); addEdge(graph, c, a);

    const region = new Set<EdgeId>(graph.edges.keys());
    const result = findCycles(graph, region, XY_BASIS, DEFAULT_TOLERANCES);

    // area = 1.5e-3 * 1.1e-3 / 2 = 8.25e-7, below MIN_FACE_AREA (1e-6)
    expect(result.rings).toHaveLength(0);
    expect(result.diagnostics.some(d => d.kind === 'sliver-rejected')).toBe(true);
    // The cycle is rejected; the EDGES survive and may belong to a larger
    // valid cycle elsewhere. §6.2
    expect(graph.edges.size).toBe(3);
  });

  it('insertion collapses a needle before the cycle finder sees it', () => {
    // Documents the defence-in-depth above as intended behaviour rather than
    // an accident, so a later change to resolveVertex cannot silently remove
    // it without a test going red.
    const { graph, result } = build([
      [0, 0, 1, 0], [1, 0, 0.5, 1e-9], [0.5, 1e-9, 0, 0],
    ]);
    expect(result.rings).toHaveLength(0);
    const apexExists = [...graph.vertices.values()].some(v => v.position.y > 1e-6);
    expect(apexExists).toBe(false);
  });

  it('keeps a legitimately thin face', () => {
    // A 3mm x 4m reveal strip. An aspect-ratio test would destroy this.
    const { result } = build([
      [0, 0, 4, 0], [4, 0, 4, 0.003], [4, 0.003, 0, 0.003], [0, 0.003, 0, 0],
    ]);
    expect(result.rings).toHaveLength(1);
  });
});

describe('determinism', () => {
  it('produces identical rings across runs', () => {
    const a = build([...SQUARE, [0, 0, 2, 2]]);
    const b = build([...SQUARE, [0, 0, 2, 2]]);
    expect(a.result.rings.map(r => r.edges.join(','))).toEqual(
      b.result.rings.map(r => r.edges.join(',')));
  });
});

describe('edgeSetHash', () => {
  it('is order-independent', () => {
    expect(edgeSetHash([3, 1, 2] as EdgeId[])).toBe(edgeSetHash([1, 2, 3] as EdgeId[]));
  });

  it('differs for different sets', () => {
    expect(edgeSetHash([1, 2, 3] as EdgeId[])).not.toBe(edgeSetHash([1, 2, 4] as EdgeId[]));
  });

  it('resists the trivial XOR collision', () => {
    // Raw XOR: 1^2 === 4^7. A mixed hash must not collide here.
    expect(edgeSetHash([1, 2] as EdgeId[])).not.toBe(edgeSetHash([4, 7] as EdgeId[]));
  });

  it('distinguishes sets of different size', () => {
    expect(edgeSetHash([1, 2] as EdgeId[])).not.toBe(edgeSetHash([1, 2, 3] as EdgeId[]));
  });
});
