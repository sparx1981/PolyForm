import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, addVertex, addEdge, addLoop } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { divideRectangularFace, isSimpleRectangularFace } from './divideSurface';
import { vec3 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId } from './types';

const OPTS = { tolerances: T, upAxis: vec3(0, 1, 0) };

function scene() {
  const graph = createGraph();
  const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
  return { graph, ctx };
}

function rectangle(s: ReturnType<typeof scene>, w = 4, d = 4) {
  const p = [vec3(0, 0, 0), vec3(w, 0, 0), vec3(w, 0, d), vec3(0, 0, d)];
  const touched = new Set<EdgeId>();
  for (let i = 0; i < 4; i++) {
    for (const t of insertEdge(s.ctx, p[i]!, p[(i + 1) % 4]!).touched) touched.add(t);
  }
  derive(s.graph, touched, OPTS);
  return [...s.graph.faces.keys()][0]!;
}

describe('divideRectangularFace', () => {
  it('divides a square into a 3x2 grid of 6 equal-area pieces', () => {
    const s = scene();
    const face = rectangle(s, 6, 4);
    const result = divideRectangularFace(s.ctx, face, 3, 2);
    expect(result.ok).toBe(true);
    derive(s.graph, result.touched, OPTS);

    expect(s.graph.faces.size).toBe(6);
    expect(checkIntegrity(s.graph)).toEqual([]);

    // Each of the 6 pieces should have equal area (24 total / 6 = 4 each).
    // Not asserting specific width/depth values: which of P0->P1 vs
    // P0->P3 ends up as "columns" depends on the face's own winding
    // order, an internal detail of how derive() built its loop — not
    // something this test should assume a fixed mapping for.
    for (const f of s.graph.faces.values()) {
      const pts = [...s.graph.loops.get(f.outerLoop)!.uses].map((use) => {
        const e = s.graph.edges.get(use.edge)!;
        return s.graph.vertices.get(use.reversed ? e.v1 : e.v0)!.position;
      });
      expect(pts).toHaveLength(4);
      const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
      const width = Math.max(...xs) - Math.min(...xs);
      const depth = Math.max(...zs) - Math.min(...zs);
      expect(width * depth).toBeCloseTo(4, 5);
    }
  });

  it('divides into a 1xN grid (columns only) correctly', () => {
    const s = scene();
    const face = rectangle(s, 9, 3);
    const result = divideRectangularFace(s.ctx, face, 3, 1);
    expect(result.ok).toBe(true);
    derive(s.graph, result.touched, OPTS);
    expect(s.graph.faces.size).toBe(3);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('divides into an Nx1 grid (rows only) correctly', () => {
    const s = scene();
    const face = rectangle(s, 3, 9);
    const result = divideRectangularFace(s.ctx, face, 1, 3);
    expect(result.ok).toBe(true);
    derive(s.graph, result.touched, OPTS);
    expect(s.graph.faces.size).toBe(3);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('works on a non-square rectangle, not just a symmetric one', () => {
    const s = scene();
    const face = rectangle(s, 10, 4);
    const result = divideRectangularFace(s.ctx, face, 5, 2);
    expect(result.ok).toBe(true);
    derive(s.graph, result.touched, OPTS);
    expect(s.graph.faces.size).toBe(10);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('the resulting pieces are ordinary, sticky faces — not marked isolatedShape', () => {
    // The one behavioural difference from Rectangle/Circle/Triangle's own
    // shapes this whole module exists to preserve — see this module's own
    // doc comment for why sticky, not isolated, is correct here.
    const s = scene();
    const face = rectangle(s, 4, 4);
    const result = divideRectangularFace(s.ctx, face, 2, 2);
    derive(s.graph, result.touched, OPTS);
    for (const f of s.graph.faces.values()) {
      expect(f.attributes.custom.isolatedShape).toBeUndefined();
    }
  });
});

describe('divideRectangularFace — eligibility and refusals', () => {
  it('refuses a triangle (not 4-sided)', () => {
    const s = scene();
    const p = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(2, 0, 3.46)];
    const touched = new Set<EdgeId>();
    for (let i = 0; i < 3; i++) {
      for (const t of insertEdge(s.ctx, p[i]!, p[(i + 1) % 3]!).touched) touched.add(t);
    }
    derive(s.graph, touched, OPTS);
    const face = [...s.graph.faces.keys()][0]!;
    const result = divideRectangularFace(s.ctx, face, 2, 2);
    expect(result.ok).toBe(false);
  });

  it('refuses a non-rectangular (skewed) quad', () => {
    const s = scene();
    const p = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(5, 0, 4), vec3(1, 0, 4)]; // parallelogram, not a rectangle
    const touched = new Set<EdgeId>();
    for (let i = 0; i < 4; i++) {
      for (const t of insertEdge(s.ctx, p[i]!, p[(i + 1) % 4]!).touched) touched.add(t);
    }
    derive(s.graph, touched, OPTS);
    const face = [...s.graph.faces.keys()][0]!;
    const result = divideRectangularFace(s.ctx, face, 2, 2);
    expect(result.ok).toBe(false);
  });

  it('refuses a face with a hole', () => {
    const s = scene();
    const face = rectangle(s, 8, 8);
    const f = s.graph.faces.get(face)!;
    // Directly construct a genuine hole, the same safe approach chamfer/
    // fillet's own hole tests use — bypasses derive()'s own separate,
    // unrelated quirk with holes drawn the "obvious" way (see those
    // tests' own doc comments for the full reasoning).
    const inner = [vec3(2, 0, 2), vec3(4, 0, 2), vec3(4, 0, 4), vec3(2, 0, 4)];
    const vids = inner.map((p) => addVertex(s.graph, p).id);
    const holeEdgeIds = vids.map((_, i) => addEdge(s.graph, vids[i]!, vids[(i + 1) % 4]!).id);
    const holeLoop = addLoop(s.graph, f.id, holeEdgeIds, 'inner', vids[0]!);
    f.innerLoops.push(holeLoop.id);
    expect(checkIntegrity(s.graph)).toEqual([]);

    const result = divideRectangularFace(s.ctx, face, 2, 2);
    expect(result.ok).toBe(false);
  });

  it('refuses columns or rows below 1', () => {
    const s = scene();
    const face = rectangle(s, 4, 4);
    expect(divideRectangularFace(s.ctx, face, 0, 2).ok).toBe(false);
    expect(divideRectangularFace(s.ctx, face, 2, 0).ok).toBe(false);
  });

  it('refuses 1x1 (nothing to divide)', () => {
    const s = scene();
    const face = rectangle(s, 4, 4);
    expect(divideRectangularFace(s.ctx, face, 1, 1).ok).toBe(false);
  });

  it('refuses a face id that does not exist', () => {
    const s = scene();
    rectangle(s, 4, 4);
    const result = divideRectangularFace(s.ctx, 99999 as any, 2, 2);
    expect(result.ok).toBe(false);
  });
});

describe('isSimpleRectangularFace', () => {
  it('accepts a plain rectangle', () => {
    const s = scene();
    const face = rectangle(s, 4, 4);
    expect(isSimpleRectangularFace(s.graph, face)).toBe(true);
  });

  it('rejects a face id that does not exist', () => {
    const s = scene();
    expect(isSimpleRectangularFace(s.graph, 99999 as any)).toBe(false);
  });
});
