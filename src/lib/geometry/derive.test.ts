import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopPoints, removeFace } from './topology';
import { insertEdge, createEdgeIndex, type InsertContext } from './insert';
import { derive, orientNormal, sampleUV, makeUVBasis } from './derive';
import { vec3, planeBasis, normalize, distance } from './math';
import { signedArea } from './polygon';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId, FaceId } from './types';

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
  const run = () => derive(graph, touched, OPTS);
  return { graph, c, draw, run, touched };
}

const square = (s: ReturnType<typeof scene>, size = 2) => {
  s.draw(0, 0, size, 0); s.draw(size, 0, size, size);
  s.draw(size, size, 0, size); s.draw(0, size, 0, 0);
};

const faceArea = (g: ReturnType<typeof createGraph>, id: FaceId) => {
  const f = g.faces.get(id)!;
  const b = planeBasis(f.plane);
  const outer = signedArea(loopPoints(g, f.outerLoop).map(p => ({
    x: (p.x - b.origin.x) * b.u.x + (p.y - b.origin.y) * b.u.y + (p.z - b.origin.z) * b.u.z,
    y: (p.x - b.origin.x) * b.v.x + (p.y - b.origin.y) * b.v.y + (p.z - b.origin.z) * b.v.z,
  })));
  let holes = 0;
  for (const l of f.innerLoops) {
    holes += Math.abs(signedArea(loopPoints(g, l).map(p => ({
      x: (p.x - b.origin.x) * b.u.x + (p.y - b.origin.y) * b.u.y + (p.z - b.origin.z) * b.u.z,
      y: (p.x - b.origin.x) * b.v.x + (p.y - b.origin.y) * b.v.y + (p.z - b.origin.z) * b.v.z,
    }))));
  }
  return Math.abs(outer) - holes;
};

describe('face creation (R3)', () => {
  it('a closed square derives one face', () => {
    const s = scene(); square(s);
    const r = s.run();
    expect(r.created).toHaveLength(1);
    expect(s.graph.faces.size).toBe(1);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('an open chain derives nothing', () => {
    const s = scene();
    s.draw(0, 0, 1, 0); s.draw(1, 0, 1, 1);
    expect(s.run().created).toHaveLength(0);
  });

  it('a non-coplanar closed loop derives nothing', () => {
    const graph = createGraph();
    const c: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(1,0,0)], [vec3(1,0,0), vec3(1,1,0)],
      [vec3(1,1,0), vec3(0,1,1)], [vec3(0,1,1), vec3(0,0,0)],
    ] as const) {
      for (const t of insertEdge(c, a, b).touched) touched.add(t);
    }
    const r = derive(graph, touched, OPTS);
    expect(r.created).toHaveLength(0);
  });
});

describe('splitting (R4)', () => {
  it('a line across a face gives two faces of the same total area', () => {
    const s = scene(); square(s, 2);
    s.run();
    const before = [...s.graph.faces.keys()].reduce((a, id) => a + faceArea(s.graph, id), 0);

    s.touched.clear();
    s.draw(0, 0, 2, 2);
    s.run();

    expect(s.graph.faces.size).toBe(2);
    const after = [...s.graph.faces.keys()].reduce((a, id) => a + faceArea(s.graph, id), 0);
    expect(after).toBeCloseTo(before, 9);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });
});

describe('islands and holes', () => {
  it('a closed cycle inside a face gives an island plus a hole', () => {
    const s = scene();
    square(s, 6);
    s.draw(2, 2, 4, 2); s.draw(4, 2, 4, 4); s.draw(4, 4, 2, 4); s.draw(2, 4, 2, 2);
    s.run();

    expect(s.graph.faces.size).toBe(2);
    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1);
    const island = [...s.graph.faces.values()].find(f => f.innerLoops.length === 0);
    expect(outer).toBeDefined();
    expect(island).toBeDefined();
    // Outer area excludes the hole: 36 - 4 = 32
    expect(faceArea(s.graph, outer!.id)).toBeCloseTo(32, 9);
    expect(faceArea(s.graph, island!.id)).toBeCloseTo(4, 9);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('the hole loop winds counter to the outer loop', () => {
    // Tessellators infer hole-versus-island from RELATIVE winding. Get this
    // wrong and the hole fills in. §6.4
    const s = scene();
    square(s, 6);
    s.draw(2, 2, 4, 2); s.draw(4, 2, 4, 4); s.draw(4, 4, 2, 4); s.draw(2, 4, 2, 2);
    s.run();
    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const b = planeBasis(outer.plane);
    const to2 = (p: {x:number;y:number;z:number}) => ({
      x: (p.x-b.origin.x)*b.u.x + (p.y-b.origin.y)*b.u.y + (p.z-b.origin.z)*b.u.z,
      y: (p.x-b.origin.x)*b.v.x + (p.y-b.origin.y)*b.v.y + (p.z-b.origin.z)*b.v.z,
    });
    const outerArea = signedArea(loopPoints(s.graph, outer.outerLoop).map(to2));
    const innerArea = signedArea(loopPoints(s.graph, outer.innerLoops[0]!).map(to2));
    expect(outerArea).toBeGreaterThan(0);
    expect(innerArea).toBeLessThan(0);
  });

  it('the island and the hole share the same edges', () => {
    // Same Edge objects used twice with opposite EdgeUse directions. §2.4
    const s = scene();
    square(s, 6);
    s.draw(2, 2, 4, 2); s.draw(4, 2, 4, 4); s.draw(4, 4, 2, 4); s.draw(2, 4, 2, 2);
    s.run();
    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const island = [...s.graph.faces.values()].find(f => f.innerLoops.length === 0)!;
    const holeEdges = new Set(s.graph.loops.get(outer.innerLoops[0]!)!.uses.map(u => u.edge));
    const islandEdges = new Set(s.graph.loops.get(island.outerLoop)!.uses.map(u => u.edge));
    expect([...holeEdges].sort()).toEqual([...islandEdges].sort());
    for (const eid of holeEdges) {
      const e = s.graph.edges.get(eid)!;
      expect(e.uses.length).toBe(2);
      expect(e.uses[0]!.reversed).not.toBe(e.uses[1]!.reversed);
    }
  });
});

describe('preserve-or-create (§7.4)', () => {
  it('untouched faces keep their face IDs across an unrelated rebuild', () => {
    const s = scene();
    square(s, 2);
    s.run();
    const originalId = [...s.graph.faces.keys()][0]!;

    // Draw an unrelated square elsewhere on the same plane.
    s.touched.clear();
    s.draw(10, 0, 12, 0); s.draw(12, 0, 12, 2); s.draw(12, 2, 10, 2); s.draw(10, 2, 10, 0);
    s.run();

    expect(s.graph.faces.has(originalId)).toBe(true);
    expect(s.graph.faces.size).toBe(2);
  });

  it('a deleted face stays deleted across an unrelated edit', () => {
    // Simplify preserve-or-create to "always create" and this is the ONLY
    // test that fails. §10.4
    const s = scene();
    square(s, 2);
    s.run();
    const id = [...s.graph.faces.keys()][0]!;
    removeFace(s.graph, id);
    expect(s.graph.faces.size).toBe(0);

    s.touched.clear();
    s.draw(10, 0, 12, 0); s.draw(12, 0, 12, 2); s.draw(12, 2, 10, 2); s.draw(10, 2, 10, 0);
    s.run();

    // The new square derived; the deleted one did NOT come back.
    expect(s.graph.faces.size).toBe(1);
  });

  it('retracing one boundary edge brings a deleted face back', () => {
    // Retrace-to-heal, end to end: overdraw creates no edge but sets the
    // change flag, and derivation then sees a touched cycle. §2.3, §6.2
    const s = scene();
    square(s, 2);
    s.run();
    removeFace(s.graph, [...s.graph.faces.keys()][0]!);
    expect(s.graph.faces.size).toBe(0);

    s.touched.clear();
    const r = s.draw(0, 0, 2, 0);
    expect(r.wasOverdraw).toBe(true);
    expect(s.graph.edges.size).toBe(4);
    s.run();

    expect(s.graph.faces.size).toBe(1);
  });

  it('drawing across a void fills it as two faces', () => {
    const s = scene();
    square(s, 2);
    s.run();
    removeFace(s.graph, [...s.graph.faces.keys()][0]!);

    s.touched.clear();
    s.draw(0, 0, 2, 2);
    s.run();

    expect(s.graph.faces.size).toBe(2);
  });
});

describe('attributes and UV (§6.3)', () => {
  it('both halves of a split keep the material', () => {
    const s = scene(); square(s, 2);
    s.run();
    const f = s.graph.faces.get([...s.graph.faces.keys()][0]!)!;
    f.attributes.materialFront = 'brick';

    s.touched.clear();
    s.draw(0, 0, 2, 2);
    s.run();

    expect(s.graph.faces.size).toBe(2);
    for (const face of s.graph.faces.values()) {
      expect(face.attributes.materialFront).toBe('brick');
    }
  });

  it('texture is continuous across the cut', () => {
    // The UV basis is world-anchored, so sampling either side of the cut at
    // equal world distance gives the same UV — no shift, no rescale. §6.3
    const s = scene(); square(s, 2);
    s.run();
    const f = s.graph.faces.get([...s.graph.faces.keys()][0]!)!;
    const uvBefore = f.attributes.uv!;
    const probe = vec3(0.5, 0.5, 0);
    const before = sampleUV(probe, uvBefore);

    s.touched.clear();
    s.draw(0, 0, 2, 2);
    s.run();

    for (const face of s.graph.faces.values()) {
      const after = sampleUV(probe, face.attributes.uv!);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it('UV basis is world-anchored, not normalised to the face bounds', () => {
    // Bounds-normalisation is the standard mistake; its symptom is every
    // split rescaling the texture. A 2-unit and a 6-unit square must produce
    // the same UV for the same world point.
    const a = scene(); square(a, 2); a.run();
    const b = scene(); square(b, 6); b.run();
    const probe = vec3(1, 1, 0);
    const uvA = sampleUV(probe, [...a.graph.faces.values()][0]!.attributes.uv!);
    const uvB = sampleUV(probe, [...b.graph.faces.values()][0]!.attributes.uv!);
    expect(uvA.x).toBeCloseTo(uvB.x, 9);
    expect(uvA.y).toBeCloseTo(uvB.y, 9);
  });
});

describe('orientation (§6.4)', () => {
  it('a horizontal face comes out facing up', () => {
    const n = orientNormal({ point: vec3(0,0,0), normal: vec3(0,0,-1) },
      { tolerance: T.COPLANARITY_TOLERANCE });
    expect(n.z).toBeGreaterThan(0);
  });

  it('snapshot consistency stops a split flipping half a wall', () => {
    const n = orientNormal({ point: vec3(0,0,0), normal: vec3(1,0,0) },
      { snapshotNormal: vec3(-1,0,0), tolerance: T.COPLANARITY_TOLERANCE });
    expect(n.x).toBeLessThan(0);
  });

  it('neighbour consistency wins over everything else', () => {
    const n = orientNormal({ point: vec3(0,0,0), normal: vec3(0,0,1) },
      { neighbourNormal: vec3(0,0,-1), snapshotNormal: vec3(0,0,1), tolerance: T.COPLANARITY_TOLERANCE });
    expect(n.z).toBeLessThan(0);
  });

  it('is deterministic with no camera at all', () => {
    // Headless: batch import, a script, a test. §6.4
    const a = orientNormal({ point: vec3(0,0,0), normal: normalize(vec3(1,2,3)) },
      { tolerance: T.COPLANARITY_TOLERANCE });
    const b = orientNormal({ point: vec3(0,0,0), normal: normalize(vec3(-1,-2,-3)) },
      { tolerance: T.COPLANARITY_TOLERANCE });
    expect(distance(a, b)).toBeCloseTo(0, 9);
  });
});

describe('determinism', () => {
  it('the same script yields the same face count and IDs', () => {
    const run = () => {
      const s = scene();
      square(s, 4);
      s.draw(0, 0, 4, 4);
      s.run();
      return [...s.graph.faces.keys()].sort((a, b) => a - b).join(',');
    };
    expect(run()).toBe(run());
  });
});
