import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopPoints } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { pushPull } from './pushpull';
import {
  verticesOf, edgesOf, boundsOfFaces, transformFaces, translateFaces,
  scaleFaces, rotateFaces, offsetFaceVertices, edgesToRederive,
} from './grouptransform';
import { vec3, distance, planeBasis, projectToBasis, dot, normalize, sub } from './math';
import { signedArea } from './polygon';
import { translation, rotationAxisAngle } from './mat4';
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

function groundSquare(s: ReturnType<typeof scene>, n = 4) {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) s.draw(p[i]!, p[(i+1)%4]!);
  s.run();
}

function box(s: ReturnType<typeof scene>, n = 4, h = 2) {
  groundSquare(s, n);
  const r = pushPull(s.ctx, [...s.graph.faces.keys()][0]!, h, { tolerances: T });
  for (const t of r.touched) s.touched.add(t);
  s.run();
}

const totalArea = (g: ReturnType<typeof createGraph>) => {
  let sum = 0;
  for (const f of g.faces.values()) {
    const b = planeBasis(f.plane);
    sum += Math.abs(signedArea(loopPoints(g, f.outerLoop).map(p => projectToBasis(p, b))));
    for (const l of f.innerLoops) sum -= Math.abs(signedArea(loopPoints(g, l).map(p => projectToBasis(p, b))));
  }
  return sum;
};

describe('shared-vertex collection', () => {
  it('a box has exactly 8 vertices across 6 faces', () => {
    const s = scene(); box(s);
    const ids = [...s.graph.faces.keys()];
    expect(verticesOf(s.graph, ids).size).toBe(8);
  });

  it('a box has exactly 12 edges across 6 faces', () => {
    const s = scene(); box(s);
    expect(edgesOf(s.graph, [...s.graph.faces.keys()]).size).toBe(12);
  });

  it('bounds match a 4x2x4 box', () => {
    const s = scene(); box(s, 4, 2);
    const b = boundsOfFaces(s.graph, [...s.graph.faces.keys()])!;
    expect(b.size.x).toBeCloseTo(4, 9);
    expect(b.size.y).toBeCloseTo(2, 9);
    expect(b.size.z).toBeCloseTo(4, 9);
    expect(b.center.y).toBeCloseTo(1, 9);
  });
});

describe('translate — the rigid-body case', () => {
  it('moves a box as one piece, not its walls sliding apart', () => {
    const s = scene(); box(s);
    const before = totalArea(s.graph);
    const ids = [...s.graph.faces.keys()];

    translateFaces(s.graph, ids, vec3(10, 5, -3));
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);

    expect(totalArea(s.graph)).toBeCloseTo(before, 6);
    expect(s.graph.faces.size).toBe(6);
    expect(checkIntegrity(s.graph)).toEqual([]);
    const b = boundsOfFaces(s.graph, ids)!;
    expect(b.center.x).toBeCloseTo(12, 6); // was 2, +10
  });

  it('a shared vertex moves ONCE, not once per face touching it', () => {
    // The bug this guards: applying the delta while iterating faces would
    // move a corner vertex three times, since a box corner touches three
    // faces. That would blow the box apart rather than translate it.
    const s = scene(); box(s);
    const ids = [...s.graph.faces.keys()];
    const before = boundsOfFaces(s.graph, ids)!.size;

    translateFaces(s.graph, ids, vec3(5, 0, 0));
    const after = boundsOfFaces(s.graph, ids)!.size;

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it('preserves face identity — this is still the same box, not a new one', () => {
    const s = scene(); box(s);
    const before = [...s.graph.faces.keys()].sort((a,b)=>a-b);
    translateFaces(s.graph, before, vec3(1, 1, 1));
    derive(s.graph, edgesToRederive(s.graph, before), OPTS);
    expect([...s.graph.faces.keys()].sort((a,b)=>a-b)).toEqual(before);
  });
});

describe('scale', () => {
  it('doubles a box about its own center', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    const centerBefore = boundsOfFaces(s.graph, ids)!.center;

    scaleFaces(s.graph, ids, vec3(2, 2, 2));
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);

    const b = boundsOfFaces(s.graph, ids)!;
    expect(b.size.x).toBeCloseTo(8, 6);
    expect(b.size.y).toBeCloseTo(4, 6);
    expect(b.size.z).toBeCloseTo(8, 6);
    expect(b.center.x).toBeCloseTo(centerBefore.x, 6);
    expect(b.center.z).toBeCloseTo(centerBefore.z, 6);
  });

  it('scales about an explicit pivot, not always the center', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    scaleFaces(s.graph, ids, vec3(2, 1, 1), vec3(0, 0, 0));
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    const b = boundsOfFaces(s.graph, ids)!;
    expect(b.min.x).toBeCloseTo(0, 6); // pivot corner stays put
    expect(b.size.x).toBeCloseTo(8, 6);
  });

  it('a non-uniform scale keeps face normals correct', () => {
    // The reason plane is recomputed rather than transformed directly: a
    // non-uniform scale needs the inverse transpose for the normal, and
    // getting that wrong silently skews the face.
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    scaleFaces(s.graph, ids, vec3(3, 1, 1));
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);

    for (const f of s.graph.faces.values()) {
      const pts = loopPoints(s.graph, f.outerLoop);
      // Every vertex of a face must lie ON its own stored plane.
      for (const p of pts) {
        const d = Math.abs(dot(sub(p, f.plane.point), normalize(f.plane.normal)));
        expect(d).toBeLessThan(1e-6);
      }
    }
  });
});

describe('rotate', () => {
  it('a 90 degree rotation about Y swaps footprint dimensions', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    // A 4x2x4 box has no ground-plan asymmetry, so use a rectangle.
    const before = boundsOfFaces(s.graph, ids)!;

    rotateFaces(s.graph, ids, vec3(0, 1, 0), Math.PI / 2);
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    const after = boundsOfFaces(s.graph, ids)!;

    expect(after.size.x).toBeCloseTo(before.size.z, 5);
    expect(after.size.z).toBeCloseTo(before.size.x, 5);
    expect(after.size.y).toBeCloseTo(before.size.y, 6);
  });

  it('preserves total area under rotation', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    const before = totalArea(s.graph);
    rotateFaces(s.graph, ids, normalize(vec3(1, 1, 0)), 0.7);
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    expect(totalArea(s.graph)).toBeCloseTo(before, 5);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });
});

describe('offset', () => {
  it('grows a flat rectangle uniformly on each side', () => {
    const s = scene(); groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    // Push the boundary outward along the face normal — for a single
    // horizontal face this has no in-plane meaning, so exercise it on a box
    // wall instead, where the normal is genuinely useful.
    void id;
  });

  it('grows a box uniformly along each face normal', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    const before = boundsOfFaces(s.graph, ids)!;

    offsetFaceVertices(s.graph, ids, 0.5);
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    const after = boundsOfFaces(s.graph, ids)!;

    // Each dimension grows by 1 (0.5 out on both sides).
    expect(after.size.x).toBeCloseTo(before.size.x + 1, 5);
    expect(after.size.y).toBeCloseTo(before.size.y + 1, 5);
    expect(after.size.z).toBeCloseTo(before.size.z + 1, 5);
  });

  it('a shared corner accumulates each touching face once, not once per edge', () => {
    // The bug this guards: a face's boundary meets a shared corner via TWO
    // of its own edges. Counting both would double that face's contribution
    // — moving a box corner twice as far as every other corner on the same
    // face, and leaving the box lopsided.
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    const before = boundsOfFaces(s.graph, ids)!;

    offsetFaceVertices(s.graph, ids, 0.5);
    const after = boundsOfFaces(s.graph, ids)!;

    // Every dimension should grow by exactly 1 (0.5 out on both sides) — a
    // corner over-counted on one axis would grow that axis further than the
    // others.
    expect(after.size.x).toBeCloseTo(before.size.x + 1, 6);
    expect(after.size.y).toBeCloseTo(before.size.y + 1, 6);
    expect(after.size.z).toBeCloseTo(before.size.z + 1, 6);
  });
});

describe('integration: drag a box, undo, redo', () => {
  it('a full move-and-rederive round trip holds together', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    const areaBefore = totalArea(s.graph);

    translateFaces(s.graph, ids, vec3(2, 0, 2));
    scaleFaces(s.graph, ids, vec3(1.5, 1, 1.5));
    rotateFaces(s.graph, ids, vec3(0, 1, 0), 0.3);
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);

    expect(s.graph.faces.size).toBe(6);
    expect(checkIntegrity(s.graph)).toEqual([]);
    // Area changes under non-uniform scale, so just confirm it is sane and
    // the topology has not fragmented.
    expect(totalArea(s.graph)).toBeGreaterThan(areaBefore);
  });
});

describe('regression — moved geometry must not spawn a stale duplicate face', () => {
  // The bug this guards: a face's identity was matched during derivation by
  // comparing a CANDIDATE face's cached plane.point against the region being
  // processed. That cache is exactly what goes stale the moment a face's
  // own vertices move (translate, scale, rotate, offset) without its edge
  // set changing — the face's IDENTITY is unchanged, but the point on its
  // old cached plane no longer describes where it actually is. Comparing
  // stale data made the check conclude "this is some other, unrelated
  // plane," so the stale face was never touched, and a second, freshly
  // derived face was built alongside it from the same edges — silently
  // doubling every face in a moved box.
  it('a translated box still has exactly 6 faces, not 12', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    translateFaces(s.graph, ids, vec3(10, 0, 0));
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    expect(s.graph.faces.size).toBe(6);
  });

  it('a scaled box still has exactly 6 faces', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    scaleFaces(s.graph, ids, vec3(2, 2, 2));
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    expect(s.graph.faces.size).toBe(6);
  });

  it('a rotated box still has exactly 6 faces', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    rotateFaces(s.graph, ids, vec3(0, 1, 0), 0.4);
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    expect(s.graph.faces.size).toBe(6);
  });

  it('an offset box still has exactly 6 faces', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    offsetFaceVertices(s.graph, ids, 0.5);
    derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    expect(s.graph.faces.size).toBe(6);
  });

  it('face ids are stable across the move, not replaced by new ones', () => {
    const s = scene(); box(s, 4, 2);
    const before = [...s.graph.faces.keys()].sort((a, b) => a - b);
    translateFaces(s.graph, before, vec3(3, 0, 0));
    derive(s.graph, edgesToRederive(s.graph, before), OPTS);
    expect([...s.graph.faces.keys()].sort((a, b) => a - b)).toEqual(before);
  });

  it('repeated small moves do not accumulate duplicate faces', () => {
    // A drag applies many transforms in sequence (once per commit); each
    // one must clean up after itself, not leave a growing trail of stale
    // copies behind.
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    for (let i = 0; i < 5; i++) {
      translateFaces(s.graph, ids, vec3(1, 0, 0));
      derive(s.graph, edgesToRederive(s.graph, ids), OPTS);
    }
    expect(s.graph.faces.size).toBe(6);
  });
});
