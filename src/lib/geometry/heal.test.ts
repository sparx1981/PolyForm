import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopPoints, removeFace } from './topology';
import { insertEdge, createEdgeIndex, type InsertContext } from './insert';
import { derive } from './derive';
import { snapshot, restore, runTransaction, deleteEdge, dissolveRedundantVertices, cleanupOrphans } from './heal';
import { vec3, planeBasis } from './math';
import { signedArea } from './polygon';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId } from './types';

const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1) };

function scene() {
  const graph = createGraph();
  const c: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
  const touched = new Set<EdgeId>();
  const draw = (x0: number, y0: number, x1: number, y1: number) => {
    const r = insertEdge(c, vec3(x0, y0, 0), vec3(x1, y1, 0));
    for (const t of r.touched) touched.add(t);
    return r;
  };
  return { graph, c, draw, touched, run: () => derive(graph, touched, OPTS) };
}

const totalArea = (g: ReturnType<typeof createGraph>) => {
  let sum = 0;
  for (const f of g.faces.values()) {
    const b = planeBasis(f.plane);
    const to2 = (p: {x:number;y:number;z:number}) => ({
      x: (p.x-b.origin.x)*b.u.x + (p.y-b.origin.y)*b.u.y + (p.z-b.origin.z)*b.u.z,
      y: (p.x-b.origin.x)*b.v.x + (p.y-b.origin.y)*b.v.y + (p.z-b.origin.z)*b.v.z,
    });
    sum += Math.abs(signedArea(loopPoints(g, f.outerLoop).map(to2)));
    for (const l of f.innerLoops) sum -= Math.abs(signedArea(loopPoints(g, l).map(to2)));
  }
  return sum;
};

const square = (s: ReturnType<typeof scene>, n = 2) => {
  s.draw(0, 0, n, 0); s.draw(n, 0, n, n); s.draw(n, n, 0, n); s.draw(0, n, 0, 0);
};

describe('face merging (R5, R6)', () => {
  it('erasing a dividing edge merges the faces and preserves area', () => {
    const s = scene(); square(s, 2); s.draw(0, 0, 2, 2); s.run();
    expect(s.graph.faces.size).toBe(2);
    const before = totalArea(s.graph);

    const diagonal = [...s.graph.edges.values()].find(e => {
      const [a, b] = [s.graph.vertices.get(e.v0)!.position, s.graph.vertices.get(e.v1)!.position];
      return Math.abs(a.x - a.y) < 1e-9 && Math.abs(b.x - b.y) < 1e-9;
    })!;
    const r = deleteEdge(s.graph, diagonal.id, T);
    derive(s.graph, r.touched, OPTS);

    expect(s.graph.faces.size).toBe(1);
    expect(totalArea(s.graph)).toBeCloseTo(before, 9);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('erasing a boundary edge deletes the face and opens a hole', () => {
    const s = scene(); square(s, 2); s.run();
    expect(s.graph.faces.size).toBe(1);
    const boundary = [...s.graph.edges.keys()][0]!;
    const r = deleteEdge(s.graph, boundary, T);
    derive(s.graph, r.touched, OPTS);
    expect(s.graph.faces.size).toBe(0);
    expect(s.graph.edges.size).toBe(3);
  });

  it('deleting an island face leaves the outer face intact with its hole', () => {
    const s = scene();
    square(s, 6);
    s.draw(2, 2, 4, 2); s.draw(4, 2, 4, 4); s.draw(4, 4, 2, 4); s.draw(2, 4, 2, 2);
    s.run();
    const island = [...s.graph.faces.values()].find(f => f.innerLoops.length === 0)!;
    const outerId = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!.id;

    removeFace(s.graph, island.id);

    // No suppression state needed: the outer face retains its inner loop, so
    // the void is expressed structurally. §7.4
    const outer = s.graph.faces.get(outerId)!;
    expect(outer.innerLoops).toHaveLength(1);
    expect(s.graph.faces.size).toBe(1);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });
});

describe('transactions (§7.0)', () => {
  it('undo restores face IDs identically', () => {
    const s = scene(); square(s, 2); s.run();
    const before = [...s.graph.faces.keys()];
    const snap = snapshot(s.graph);

    s.touched.clear();
    s.draw(0, 0, 2, 2);
    s.run();
    expect(s.graph.faces.size).toBe(2);

    restore(s.graph, snap);
    expect([...s.graph.faces.keys()]).toEqual(before);
    expect(s.graph.edges.size).toBe(4);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('a snapshot is independent of later mutation', () => {
    const s = scene(); square(s, 2); s.run();
    const snap = snapshot(s.graph);
    s.draw(0, 0, 2, 2);
    expect(snap.graph.edges.size).toBe(4);
  });

  it('a snapshot can be restored more than once', () => {
    const s = scene(); square(s, 2); s.run();
    const snap = snapshot(s.graph);
    for (let i = 0; i < 3; i++) {
      s.draw(0, 0, 2, 2);
      restore(s.graph, snap);
      expect(s.graph.edges.size).toBe(4);
    }
  });

  it('a rejected commit leaves the graph bit-identical and consumes no undo', () => {
    const s = scene(); square(s, 2); s.run();
    const edgesBefore = s.graph.edges.size;
    const idBefore = s.graph.nextId.edge;

    const result = runTransaction(s.graph, 'bad', () => ({
      touched: new Set<EdgeId>(), ok: false, reason: 'zero-length',
    }), OPTS);

    expect(result.ok).toBe(false);
    expect(result.undo).toBeUndefined();
    expect(s.graph.edges.size).toBe(edgesBefore);
    expect(s.graph.nextId.edge).toBe(idBefore);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('rolls back when the edit throws', () => {
    const s = scene(); square(s, 2); s.run();
    const before = s.graph.edges.size;
    const r = runTransaction(s.graph, 'boom', () => { throw new Error('bang'); }, OPTS);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('bang');
    expect(s.graph.edges.size).toBe(before);
  });

  it('a retrace is valid, not degenerate — it adds nothing and still commits', () => {
    // Validation must reject geometry that CANNOT EXIST, never an edit that
    // merely ADDS NOTHING. Conflating them breaks healing by a second route.
    const s = scene(); square(s, 2); s.run();
    removeFace(s.graph, [...s.graph.faces.keys()][0]!);

    const r = runTransaction(s.graph, 'retrace', () => {
      const res = insertEdge(s.c, vec3(0, 0, 0), vec3(2, 0, 0));
      expect(res.wasOverdraw).toBe(true);
      return { touched: res.touched };
    }, OPTS);

    expect(r.ok).toBe(true);
    expect(s.graph.faces.size).toBe(1);
  });
});

describe('colinear dissolution (R7)', () => {
  it('does not dissolve a user-placed mid-edge vertex', () => {
    // Users place these deliberately as snap targets. §7.2
    const s = scene();
    s.draw(0, 0, 1, 0);
    s.draw(1, 0, 2, 0);
    const before = s.graph.vertices.size;
    dissolveRedundantVertices(s.graph, T);
    expect(s.graph.vertices.size).toBe(before);
  });

  it('dissolves a vertex that became redundant through a deletion', () => {
    const s = scene();
    s.draw(0, 0, 1, 0);
    s.draw(1, 0, 2, 0);
    s.draw(1, 0, 1, 1);
    expect(s.graph.edges.size).toBe(3);

    const spur = [...s.graph.edges.values()].find(e => {
      const [a, b] = [s.graph.vertices.get(e.v0)!.position, s.graph.vertices.get(e.v1)!.position];
      return Math.abs(a.y - b.y) > 1e-9;
    })!;
    deleteEdge(s.graph, spur.id, T);
    dissolveRedundantVertices(s.graph, T);

    expect(s.graph.edges.size).toBe(1);
    expect(s.graph.vertices.size).toBe(2);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('never splices across a curve boundary', () => {
    const s = scene();
    s.draw(0, 0, 1, 0);
    s.draw(1, 0, 2, 0);
    const [e0, e1] = [...s.graph.edges.values()];
    e0!.curve = 1 as never;
    e1!.curve = 2 as never;
    const mid = [...s.graph.vertices.values()].find(v => v.edges.length === 2)!;
    mid.provenance = 'deletion';
    dissolveRedundantVertices(s.graph, T);
    expect(s.graph.edges.size).toBe(2);
  });

  it('leaves face boundaries to derivation', () => {
    const s = scene(); square(s, 2); s.run();
    const before = s.graph.vertices.size;
    for (const v of s.graph.vertices.values()) v.provenance = 'deletion';
    dissolveRedundantVertices(s.graph, T);
    expect(s.graph.vertices.size).toBe(before);
  });
});

describe('orphan cleanup (§7.3)', () => {
  it('reports an isolated edge without deleting it', () => {
    const s = scene();
    s.draw(0, 0, 1, 0);
    const d = cleanupOrphans(s.graph);
    expect(s.graph.edges.size).toBe(1);
    expect(d.some(x => x.kind === 'stray-edge')).toBe(true);
  });
});
