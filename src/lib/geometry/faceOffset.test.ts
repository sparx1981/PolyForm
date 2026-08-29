import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { pushPull } from './pushpull';
import {
  offsetPolygon2D, insertFaceOffset, signedDistanceToPolygon2D,
} from './faceOffset';
import { vec2, vec3, distance } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId, FaceId } from './types';

const up = vec3(0, 1, 0);
const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1), upAxis: up };

function scene() {
  const graph = createGraph();
  const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
  const touched = new Set<EdgeId>();
  const draw = (a: ReturnType<typeof vec3>, b: ReturnType<typeof vec3>) => {
    for (const t of insertEdge(ctx, a, b).touched) touched.add(t);
  };
  const run = () => { const r = derive(graph, touched, OPTS); touched.clear(); return r; };
  return { graph, ctx, draw, run, touched };
}

function square(s: ReturnType<typeof scene>, n = 4) {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) s.draw(p[i]!, p[(i+1)%4]!);
  s.run();
}

// ---------------------------------------------------------------------------
// Pure 2D polygon offset — the mitred construction itself (unchanged)
// ---------------------------------------------------------------------------

describe('offsetPolygon2D — mitred corners, not averaged normals', () => {
  it('grows a square by exactly dist on every side', () => {
    const sq = [vec2(0,0), vec2(4,0), vec2(4,4), vec2(0,4)];
    const out = offsetPolygon2D(sq, 1);
    expect(out[0]!.x).toBeCloseTo(-1, 9);
    expect(out[0]!.y).toBeCloseTo(-1, 9);
    expect(out[2]!.x).toBeCloseTo(5, 9);
    expect(out[2]!.y).toBeCloseTo(5, 9);
  });

  it('shrinks a square symmetrically with a negative distance', () => {
    const sq = [vec2(0,0), vec2(4,0), vec2(4,4), vec2(0,4)];
    const out = offsetPolygon2D(sq, -1);
    expect(out[0]!.x).toBeCloseTo(1, 9);
    expect(out[0]!.y).toBeCloseTo(1, 9);
  });

  it('handles a NON-orthogonal corner correctly', () => {
    const tri = [vec2(0,0), vec2(4,0), vec2(0,3)];
    const out = offsetPolygon2D(tri, 0.5);
    const n = tri.length;
    for (let i = 0; i < n; i++) {
      const a = tri[i]!, b = tri[(i+1)%n]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const normal = { x: dy / len, y: -dx / len };
      const oa = out[i]!;
      const rel = { x: oa.x - a.x, y: oa.y - a.y };
      const projOntoNormal = rel.x * normal.x + rel.y * normal.y;
      expect(Math.abs(projOntoNormal)).toBeGreaterThan(0.4);
    }
  });

  it('is winding-agnostic', () => {
    const ccw = [vec2(0,0), vec2(4,0), vec2(4,4), vec2(0,4)];
    const cw = [...ccw].reverse();
    const outCCW = offsetPolygon2D(ccw, 1);
    const outCW = offsetPolygon2D(cw, 1);
    const bbox = (pts: typeof outCCW) => ({
      minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)),
    });
    const a = bbox(outCCW), b = bbox(outCW);
    expect(a.maxX - a.minX).toBeCloseTo(6, 9);
    expect(b.maxX - b.minX).toBeCloseTo(6, 9);
  });

  it('a near-zero distance is a no-op', () => {
    const sq = [vec2(0,0), vec2(4,0), vec2(4,4), vec2(0,4)];
    const out = offsetPolygon2D(sq, 1e-13);
    expect(out).toEqual(sq);
  });

  it('falls back gracefully at a straight (colinear) vertex', () => {
    const pts = [vec2(0,0), vec2(2,0), vec2(4,0), vec2(4,4), vec2(0,4)];
    const out = offsetPolygon2D(pts, 1);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// insertFaceOffset — the actual operation, and the whole point of the fix:
// TWO independently selectable faces afterward, not a reshaped single one.
// ---------------------------------------------------------------------------

describe('insertFaceOffset', () => {
  it('shrinking a lone square produces TWO faces: an inner shape and an outer frame', () => {
    const s = scene(); square(s, 4);
    const id = [...s.graph.faces.keys()][0]!;

    const r = insertFaceOffset(s.ctx, id, -1);
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);

    expect(s.graph.faces.size).toBe(2);
    const withHole = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1);
    const withoutHole = [...s.graph.faces.values()].find(f => f.innerLoops.length === 0);
    expect(withHole).toBeDefined();   // the frame: outer boundary, inner ring as a hole
    expect(withoutHole).toBeDefined(); // the new inner shape, standing alone
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('BOTH resulting faces are independently selectable — the bug this fixes', () => {
    // The original defect: only one face existed afterward, so the "outer"
    // half was neither visible, selectable, nor paintable. Two distinct
    // FaceIds proves that is no longer true.
    const s = scene(); square(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    const r = insertFaceOffset(s.ctx, id, -1);
    derive(s.graph, r.touched, OPTS);

    const ids = [...s.graph.faces.keys()];
    expect(new Set(ids).size).toBe(2);
    for (const fid of ids) expect(s.graph.faces.get(fid)).toBeDefined();
  });

  it('growing (positive distance) also produces two faces, original now the hole', () => {
    const s = scene(); square(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    const r = insertFaceOffset(s.ctx, id, 1);
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(s.graph.faces.size).toBe(2);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('the original boundary is completely unchanged', () => {
    const s = scene(); square(s, 4);
    const before = [...s.graph.vertices.values()].map(v => ({ ...v.position }));
    const id = [...s.graph.faces.keys()][0]!;
    const r = insertFaceOffset(s.ctx, id, -1);
    derive(s.graph, r.touched, OPTS);
    // Every ORIGINAL vertex is still exactly where it was — nothing moved,
    // only new geometry was added alongside it.
    for (const p of before) {
      const stillThere = [...s.graph.vertices.values()].some(v => distance(v.position, p) < 1e-9);
      expect(stillThere).toBe(true);
    }
  });

  it('works on a face that is part of an already-extruded box', () => {
    // The move-based version had to refuse this (moving a shared boundary
    // would tear the neighbour). Insertion never touches the original
    // boundary, so a box wall is just as offsettable as a free rectangle.
    const s = scene(); square(s, 4);
    const baseId = [...s.graph.faces.keys()][0]!;
    const pp = pushPull(s.ctx, baseId, 2, { tolerances: T });
    for (const t of pp.touched) s.touched.add(t);
    s.run();

    const wall = [...s.graph.faces.values()].find(f => Math.abs(f.plane.normal.y) < 0.5)!;
    const before = s.graph.faces.size;
    const r = insertFaceOffset(s.ctx, wall.id, -0.5);
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(s.graph.faces.size).toBe(before + 1);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('refuses a face that already has a hole', () => {
    const s = scene();
    square(s, 8);
    const inner = [vec3(2,0,2), vec3(4,0,2), vec3(4,0,4), vec3(2,0,4)];
    for (let i = 0; i < 4; i++) s.draw(inner[i]!, inner[(i+1)%4]!);
    s.run();
    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const r = insertFaceOffset(s.ctx, outer.id, -1);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/hole/);
  });

  it('reports a missing face cleanly', () => {
    const s = scene();
    expect(insertFaceOffset(s.ctx, 999 as FaceId, -1).ok).toBe(false);
  });

  it('rejects a distance below MIN_EDGE_LENGTH', () => {
    const s = scene(); square(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    const r = insertFaceOffset(s.ctx, id, 1e-9);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cursor-position-based distance (unchanged)
// ---------------------------------------------------------------------------

describe('signed distance to polygon — drives the live cursor preview', () => {
  const sq = [vec2(0,0), vec2(4,0), vec2(4,4), vec2(0,4)];

  it('is negative for a point inside', () => {
    expect(signedDistanceToPolygon2D(vec2(2,2), sq)).toBeLessThan(0);
  });

  it('is positive for a point outside', () => {
    expect(signedDistanceToPolygon2D(vec2(6,2), sq)).toBeGreaterThan(0);
  });

  it('magnitude matches the actual distance to the nearest edge', () => {
    expect(signedDistanceToPolygon2D(vec2(5,2), sq)).toBeCloseTo(1, 6);
    expect(signedDistanceToPolygon2D(vec2(3,2), sq)).toBeCloseTo(-1, 6);
  });

  it('is (approximately) zero right on the boundary', () => {
    expect(Math.abs(signedDistanceToPolygon2D(vec2(4,2), sq))).toBeCloseTo(0, 6);
  });
});
