import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopVertexIds, getVertex } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { pushPull } from './pushpull';
import { filletSolid } from './fillet';
import { vec3 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId } from './types';

const OPTS = { tolerances: T, upAxis: vec3(0, 1, 0) };

function scene() {
  const graph = createGraph();
  const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
  return { graph, ctx };
}

function square(s: ReturnType<typeof scene>, w = 4, d = 4) {
  const p = [vec3(0, 0, 0), vec3(w, 0, 0), vec3(w, 0, d), vec3(0, 0, d)];
  const touched = new Set<EdgeId>();
  for (let i = 0; i < 4; i++) {
    for (const t of insertEdge(s.ctx, p[i]!, p[(i + 1) % 4]!).touched) touched.add(t);
  }
  derive(s.graph, touched, OPTS);
}

function box(s: ReturnType<typeof scene>, w = 4, d = 4, h = 2) {
  square(s, w, d);
  const baseId = [...s.graph.faces.keys()][0]!;
  const r = pushPull(s.ctx, baseId, h, { tolerances: T });
  derive(s.graph, r.touched, OPTS);
}

function outwardOrientationOk(g: ReturnType<typeof createGraph>): boolean {
  const allPts: { x: number; y: number; z: number }[] = [];
  for (const f of g.faces.values()) {
    for (const vid of loopVertexIds(g, f.outerLoop)) allPts.push(getVertex(g, vid).position);
  }
  const c = allPts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
  c.x /= allPts.length; c.y /= allPts.length; c.z /= allPts.length;
  for (const f of g.faces.values()) {
    const toFace = { x: f.plane.point.x - c.x, y: f.plane.point.y - c.y, z: f.plane.point.z - c.z };
    const d = toFace.x * f.plane.normal.x + toFace.y * f.plane.normal.y + toFace.z * f.plane.normal.z;
    if (d < 0) return false;
  }
  return true;
}

describe('filletSolid — construction', () => {
  it('produces the exact expected face count and topology for a box', () => {
    const s = scene(); box(s, 4, 4, 2);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 4);
    expect(result.ok).toBe(true);
    // 6 shrunk faces + 12 edges × segments quads + 8 corners × segments² triangles.
    expect(s.graph.faces.size).toBe(6 + 12 * 4 + 8 * 4 * 4);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(outwardOrientationOk(s.graph)).toBe(true);
  });

  it('produces the correct face count across a range of segment counts and radii', () => {
    for (const segments of [1, 2, 3, 6, 8]) {
      for (const radius of [0.1, 0.3, 0.5, 0.9]) {
        const s = scene(); box(s, 4, 4, 2);
        const result = filletSolid(s.ctx, [...s.graph.faces.keys()], radius, segments);
        expect(result.ok).toBe(true);
        expect(s.graph.faces.size).toBe(6 + 12 * segments + 8 * segments * segments);
        expect(checkIntegrity(s.graph)).toEqual([]);
        expect(outwardOrientationOk(s.graph)).toBe(true);
      }
    }
  });

  it('works on a non-cube rectangular box, not just a symmetric one', () => {
    const s = scene(); box(s, 10, 3, 1.5);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.4, 5);
    expect(result.ok).toBe(true);
    expect(s.graph.faces.size).toBe(6 + 12 * 5 + 8 * 5 * 5);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('degenerates to a flat-corner chamfer shape at segments=1 without breaking', () => {
    const s = scene(); box(s, 4, 4, 2);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 1);
    expect(result.ok).toBe(true);
    expect(s.graph.faces.size).toBe(6 + 12 * 1 + 8 * 1 * 1); // 26, same shape as chamfer
    expect(checkIntegrity(s.graph)).toEqual([]);
  });
});

describe('filletSolid — stability', () => {
  it('survives an unrelated derive() call elsewhere in the model', () => {
    // The exact same protection chamferSolid has, and for the identical
    // reason: every new face here is marked chamferLocked by
    // createDirectFace (reused directly, not re-derived), so derive()
    // excludes these edges from its input entirely unless something is
    // specifically touching them — see derive()'s and chamfer.ts's own
    // doc comments for the full mechanism.
    const s = scene(); box(s, 4, 4, 2);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 4);
    expect(result.ok).toBe(true);
    const expected = 6 + 12 * 4 + 8 * 4 * 4;
    expect(s.graph.faces.size).toBe(expected);

    const p2 = [vec3(20, 0, 0), vec3(24, 0, 0), vec3(24, 0, 4), vec3(20, 0, 4)];
    const touched2 = new Set<EdgeId>();
    for (let i = 0; i < 4; i++) {
      for (const t of insertEdge(s.ctx, p2[i]!, p2[(i + 1) % 4]!).touched) touched2.add(t);
    }
    derive(s.graph, touched2, OPTS);

    expect(s.graph.faces.size).toBe(expected + 1); // + 1 new, unrelated square
    const filletFaces = [...s.graph.faces.values()].filter(
      (f) => (f.attributes.custom as { chamferLocked?: boolean } | undefined)?.chamferLocked,
    );
    expect(filletFaces).toHaveLength(expected);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });
});

describe('filletSolid — eligibility and refusals', () => {
  it('refuses a triangular prism (non-90-degree corners)', () => {
    const s = scene();
    const touched = new Set<EdgeId>();
    const p = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(2, 0, 3.46)];
    for (let i = 0; i < 3; i++) {
      for (const t of insertEdge(s.ctx, p[i]!, p[(i + 1) % 3]!).touched) touched.add(t);
    }
    derive(s.graph, touched, OPTS);
    const baseId = [...s.graph.faces.keys()][0]!;
    const r = pushPull(s.ctx, baseId, 2, { tolerances: T });
    derive(s.graph, r.touched, OPTS);
    const before = s.graph.faces.size;

    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 4);
    expect(result.ok).toBe(false);
    expect(s.graph.faces.size).toBe(before);
  });

  it('refuses a face with a hole, leaving the graph untouched', () => {
    const s = scene();
    square(s, 8, 8);
    const inner = [vec3(2, 0, 2), vec3(4, 0, 2), vec3(4, 0, 4), vec3(2, 0, 4)];
    const touched = new Set<EdgeId>();
    for (let i = 0; i < 4; i++) {
      for (const t of insertEdge(s.ctx, inner[i]!, inner[(i + 1) % 4]!).touched) touched.add(t);
    }
    derive(s.graph, new Set([...s.graph.edges.keys()]), OPTS);
    const outer = [...s.graph.faces.values()].find((f) => f.innerLoops.length === 1)!;
    const r = pushPull(s.ctx, outer.id, 2, { tolerances: T });
    derive(s.graph, r.touched, OPTS);
    const before = s.graph.faces.size;

    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 4);
    expect(result.ok).toBe(false);
    expect(s.graph.faces.size).toBe(before);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('refuses a non-positive radius, leaving the graph untouched', () => {
    const s = scene(); box(s, 4, 4, 2);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0, 4);
    expect(result.ok).toBe(false);
    expect(s.graph.faces.size).toBe(6);
  });

  it('refuses fewer than 1 segment, leaving the graph untouched', () => {
    const s = scene(); box(s, 4, 4, 2);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 0);
    expect(result.ok).toBe(false);
    expect(s.graph.faces.size).toBe(6);
  });

  it('refuses too few faces to form a closed solid', () => {
    const s = scene(); square(s, 4, 4);
    const result = filletSolid(s.ctx, [...s.graph.faces.keys()], 0.3, 4);
    expect(result.ok).toBe(false);
  });
});
