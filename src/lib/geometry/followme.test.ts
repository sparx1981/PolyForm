import { describe, expect, it } from 'vitest';
import { checkIntegrity, createGraph, loopPoints, removeFace } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { followMe, planSweep, sweepSegments } from './followme';
import { cross, dot, sub, vec3 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId, FaceId, Graph, Vec3 } from './types';

const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) };

function scene() {
  const graph = createGraph();
  const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
  const touched = new Set<EdgeId>();
  const ring = (pts: Vec3[]) => {
    for (let i = 0; i < pts.length; i++) for (const t of insertEdge(ctx, pts[i]!, pts[(i + 1) % pts.length]!).touched) touched.add(t);
  };
  const run = () => { derive(graph, touched, OPTS); touched.clear(); };
  return { graph, ctx, ring, run };
}

/** The face whose outline includes all these points. */
function faceWith(g: Graph, pts: Vec3[]): FaceId {
  for (const [id, f] of g.faces) {
    const loop = loopPoints(g, f.outerLoop);
    if (pts.every(p => loop.some(q => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-9))) return id;
  }
  throw new Error('no such face');
}

/** Signed volume of the faces (positive when they all face outwards). */
function volume(g: Graph, faces?: Iterable<FaceId>): number {
  let v = 0;
  for (const id of faces ?? g.faces.keys()) {
    const f = g.faces.get(id)!;
    for (const lid of [f.outerLoop, ...f.innerLoops]) {
      const p = loopPoints(g, lid);
      for (let i = 1; i + 1 < p.length; i++) v += dot(p[0]!, cross(p[i]!, p[i + 1]!)) / 6;
    }
  }
  return v;
}

/** Every edge shared by two faces is walked in opposite directions by them. */
function consistentlyOriented(g: Graph): boolean {
  for (const e of g.edges.values()) {
    if (e.uses.length === 2 && e.uses[0]!.reversed === e.uses[1]!.reversed) return false;
  }
  return true;
}

// A 1 x 1 square in the plane z = 0, facing +z, centred on x = 0.5, y = 0.5.
const square = (z = 0): Vec3[] => [vec3(0, 0, z), vec3(1, 0, z), vec3(1, 1, z), vec3(0, 1, z)];

describe('planSweep', () => {
  it('refuses a shape lying along the path', () => {
    const r = planSweep([square()], vec3(0, 0, 1), [vec3(0.5, 0.5, 0), vec3(3, 0.5, 0)], false, T);
    expect(r.ok).toBe(false);
  });

  it('refuses a bend too tight for the shape', () => {
    // A 1 m square turning a sharp corner 0.1 m from its start.
    const r = planSweep([square()], vec3(0, 0, 1), [vec3(0.5, 0.5, 0), vec3(0.5, 0.5, 0.1), vec3(3, 0.5, -1)], false, T);
    expect(r.ok).toBe(false);
  });

  it('starts at the end of the path nearer the shape', () => {
    const r = planSweep([square()], vec3(0, 0, 1), [vec3(0.5, 0.5, 5), vec3(0.5, 0.5, 0)], false, T);
    expect(r.ok && r.plan.stations[1]![0]!.every(p => Math.abs(p.z - 5) < 1e-9)).toBe(true);
  });

  it('mitres a right-angle bend at 45 degrees', () => {
    const r = planSweep([square()], vec3(0, 0, 1), [vec3(0.5, 0.5, 0), vec3(0.5, 0.5, 4), vec3(4, 0.5, 4)], false, T);
    if (!r.ok) throw new Error(r.reason);
    const mitre = r.plan.stations[1]![0]!;
    // On the plane x + z = 4.5 (through the bend at (0.5, _, 4), normal (1, 0, 1)).
    for (const p of mitre) expect(p.x + p.z).toBeCloseTo(4.5, 9);
    expect(sweepSegments(r.plan)).toHaveLength(4 * 3 + 4 * 2);
  });
});

describe('followMe', () => {
  it('sweeping along a straight line makes a closed box, facing out', () => {
    const s = scene();
    s.ring(square());
    s.run();
    const id = faceWith(s.graph, square());
    const r = followMe(s.ctx, id, [vec3(0.5, 0.5, 0), vec3(0.5, 0.5, 3)], false, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(s.graph.faces.size).toBe(6);
    expect(consistentlyOriented(s.graph)).toBe(true);
    expect(volume(s.graph)).toBeCloseTo(3, 9);
  });

  it('round a corner: two mitred legs, no wall across the inside', () => {
    const s = scene();
    s.ring(square());
    s.run();
    const id = faceWith(s.graph, square());
    const r = followMe(s.ctx, id, [vec3(0.5, 0.5, 0), vec3(0.5, 0.5, 4), vec3(4, 0.5, 4)], false, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(s.graph.faces.size).toBe(2 + 4 * 2); // two caps, four sides per leg
    expect(consistentlyOriented(s.graph)).toBe(true);
    // Each leg's centre line is 4 m and 3.5 m long to the mitre's middle: 7.5 m of 1 x 1.
    expect(volume(s.graph)).toBeCloseTo(7.5, 9);
  });

  it('keeps a hole running right through (a square tube)', () => {
    const s = scene();
    const outer = [vec3(0, 0, 0), vec3(2, 0, 0), vec3(2, 2, 0), vec3(0, 2, 0)];
    const inner = [vec3(0.5, 0.5, 0), vec3(1.5, 0.5, 0), vec3(1.5, 1.5, 0), vec3(0.5, 1.5, 0)];
    s.ring(outer);
    s.ring(inner);
    s.run();
    const ring = faceWith(s.graph, outer);
    expect(s.graph.faces.get(ring)!.innerLoops).toHaveLength(1);
    // The inner square is its own face; take it away so the ring has a real hole.
    removeFace(s.graph, faceWith(s.graph, inner));

    const r = followMe(s.ctx, ring, [vec3(1, 1, 0), vec3(1, 1, 2)], false, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    const capsWithHoles = [...s.graph.faces.values()].filter(f => f.innerLoops.length === 1);
    expect(capsWithHoles).toHaveLength(2);
    expect(s.graph.faces.size).toBe(2 + 4 + 4);
    expect(consistentlyOriented(s.graph)).toBe(true);
    expect(volume(s.graph)).toBeCloseTo((4 - 1) * 2, 9);
  });

  it('round a closed loop: a frame with no end caps and no walls across it', () => {
    const s = scene();
    // Profile: a 0.5 x 0.5 square standing across the loop's first side, just outside the loop.
    const profile = [vec3(0, 0, 0), vec3(0, 0, -0.5), vec3(0, 0.5, -0.5), vec3(0, 0.5, 0)];
    s.ring(profile);
    s.run();
    const id = faceWith(s.graph, profile);
    const loop = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)];
    const r = followMe(s.ctx, id, loop, true, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(checkIntegrity(s.graph)).toEqual([]);
    const sweepFaces = [...s.graph.faces.keys()].filter(f => f !== id);
    expect(sweepFaces).toHaveLength(4 * 4);
    expect(s.graph.faces.has(id)).toBe(false); // the profile is replaced by the sweep
    expect(consistentlyOriented(s.graph)).toBe(true);
    // Outline 0.5 x 0.5 round a 4 x 4 loop, sitting outside it: centre line is a 4.5 x 4.5 square.
    expect(Math.abs(volume(s.graph, sweepFaces))).toBeCloseTo(0.25 * 4.5 * 4, 6);
    expect(volume(s.graph, sweepFaces)).toBeGreaterThan(0);
  });

  it('follows a path that was drawn as lines, starting at the shape', () => {
    const s = scene();
    s.ring(square());
    const path = [vec3(0.5, 0.5, 0), vec3(0.5, 0.5, 4), vec3(4, 0.5, 4)];
    for (let i = 0; i + 1 < path.length; i++) insertEdge(s.ctx, path[i]!, path[i + 1]!);
    s.run();
    const r = followMe(s.ctx, faceWith(s.graph, square()), path, false, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(s.graph.faces.size).toBe(10);
    expect(volume(s.graph)).toBeCloseTo(7.5, 9);
  });

  it('round the edge of an existing slab: the slab stays', () => {
    const s = scene();
    const slab = [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4)];
    s.ring(slab);
    const profile = [vec3(0, 0, 0), vec3(0, 0, -0.5), vec3(0, 0.5, -0.5), vec3(0, 0.5, 0)];
    s.ring(profile);
    s.run();
    const slabId = faceWith(s.graph, slab);
    const r = followMe(s.ctx, faceWith(s.graph, profile), slab, true, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(s.graph.faces.has(slabId)).toBe(true);
    expect(s.graph.faces.size).toBe(1 + 16);
  });

  it('along a curve: the bends are drawn smooth', () => {
    const s = scene();
    const small = [vec3(-0.1, -0.1, 0), vec3(0.1, -0.1, 0), vec3(0.1, 0.1, 0), vec3(-0.1, 0.1, 0)];
    s.ring(small);
    s.run();
    // A quarter circle of radius 2 in 8 pieces, starting at the origin heading +z.
    const arc = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * (Math.PI / 2);
      return vec3(2 - 2 * Math.cos(a), 0, 2 * Math.sin(a));
    });
    const r = followMe(s.ctx, faceWith(s.graph, small), arc, false, { tolerances: T });
    expect(r.ok).toBe(true);
    derive(s.graph, r.touched, OPTS);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(s.graph.faces.size).toBe(2 + 4 * 8);
    expect([...s.graph.edges.values()].filter(e => e.smooth).length).toBe(4 * 7); // the 7 inner mitre rings
    expect(consistentlyOriented(s.graph)).toBe(true);
    expect(volume(s.graph)).toBeGreaterThan(0);
  });
});

