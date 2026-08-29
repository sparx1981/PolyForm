import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopPoints } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { pushPull, isFaceFree, pushPullDistanceFromRay, coplanarNeighbours } from './pushpull';
import { insertFaceOffset } from './faceOffset';
import { vec3, planeBasis, projectToBasis, distance } from './math';
import { signedArea } from './polygon';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId, FaceId } from './types';

const up = vec3(0, 1, 0);
const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1), upAxis: up };
const PP = { tolerances: T };

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

/** Ground square in a Y-up world: y = 0, spanning X and Z. */
function groundSquare(s: ReturnType<typeof scene>, n = 4) {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) s.draw(p[i]!, p[(i+1)%4]!);
  s.run();
}

const areaOf = (g: ReturnType<typeof createGraph>, id: FaceId) => {
  const f = g.faces.get(id)!;
  const b = planeBasis(f.plane);
  return Math.abs(signedArea(loopPoints(g, f.outerLoop).map(p => projectToBasis(p, b))));
};

const totalArea = (g: ReturnType<typeof createGraph>) =>
  [...g.faces.keys()].reduce((a, id) => a + areaOf(g, id), 0);

describe('free vs shared', () => {
  it('a lone square is free to move', () => {
    const s = scene(); groundSquare(s);
    expect(isFaceFree(s.graph, [...s.graph.faces.keys()][0]!)).toBe(true);
  });

  it('a face sharing an edge with its neighbour is not', () => {
    // Moving it would drag a boundary the neighbour also owns, tearing it.
    const s = scene(); groundSquare(s, 4);
    s.draw(vec3(0,0,0), vec3(4,0,4));
    s.run();
    expect(s.graph.faces.size).toBe(2);
    for (const id of s.graph.faces.keys()) expect(isFaceFree(s.graph, id)).toBe(false);
  });
});

describe('extruding a free face', () => {
  it('a 4x4 square pulled 2 becomes a closed box', () => {
    const s = scene(); groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;

    const r = pushPull(s.ctx, id, 2, PP);
    expect(r.ok).toBe(true);
    for (const t of r.touched) s.touched.add(t);
    s.run();

    // 6 faces: the cap, the original opening re-derived, and four walls.
    expect(s.graph.faces.size).toBe(6);
    expect(s.graph.vertices.size).toBe(8);
    expect(s.graph.edges.size).toBe(12);
    // Surface area of a 4x4x2 box: 2*16 + 4*8 = 64
    expect(totalArea(s.graph)).toBeCloseTo(64, 6);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('pushing the other way works the same', () => {
    const s = scene(); groundSquare(s, 4);
    const r = pushPull(s.ctx, [...s.graph.faces.keys()][0]!, -2, PP);
    expect(r.ok).toBe(true);
    for (const t of r.touched) s.touched.add(t);
    s.run();
    expect(s.graph.faces.size).toBe(6);
    expect(totalArea(s.graph)).toBeCloseTo(64, 6);
  });

  it('the walls are real faces, so a line can split one', () => {
    // This is what building from EDGES buys: the result is ordinary geometry.
    const s = scene(); groundSquare(s, 4);
    const r = pushPull(s.ctx, [...s.graph.faces.keys()][0]!, 2, PP);
    for (const t of r.touched) s.touched.add(t);
    s.run();
    const before = s.graph.faces.size;

    // A diagonal across one wall (the x=0 wall spans y 0..2, z 0..4).
    s.draw(vec3(0,0,0), vec3(0,2,4));
    s.run();

    expect(s.graph.faces.size).toBe(before + 1);
    expect(totalArea(s.graph)).toBeCloseTo(64, 6);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('rejects a distance below MIN_EDGE_LENGTH', () => {
    const s = scene(); groundSquare(s);
    const r = pushPull(s.ctx, [...s.graph.faces.keys()][0]!, 1e-6, PP);
    expect(r.ok).toBe(false);
    expect(s.graph.faces.size).toBe(1);
  });

  it('rejects a missing face without throwing', () => {
    const s = scene();
    expect(pushPull(s.ctx, 999 as FaceId, 1, PP).ok).toBe(false);
  });
});

describe('extruding a shared face', () => {
  it('leaves the neighbour intact', () => {
    // The face cannot move, so its boundary stays and a twin appears above.
    const s = scene(); groundSquare(s, 4);
    s.draw(vec3(0,0,0), vec3(4,0,4));
    s.run();
    const [first] = [...s.graph.faces.keys()].sort((a,b)=>a-b);

    const r = pushPull(s.ctx, first!, 2, PP);
    expect(r.ok).toBe(true);
    expect(r.wasShared).toBe(true);
    for (const t of r.touched) s.touched.add(t);
    s.run();

    // The untouched triangle is still there, still 8 in area.
    const flat = [...s.graph.faces.values()].filter(f => Math.abs(f.plane.point.y) < 1e-9);
    expect(flat.length).toBeGreaterThanOrEqual(2);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });
});

describe('extruding a face with a hole', () => {
  it('carries the hole through, producing an inner wall', () => {
    const s = scene();
    groundSquare(s, 8);
    const inner = [vec3(3,0,3), vec3(5,0,3), vec3(5,0,5), vec3(3,0,5)];
    for (let i = 0; i < 4; i++) s.draw(inner[i]!, inner[(i+1)%4]!);
    s.run();

    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const r = pushPull(s.ctx, outer.id, 2, PP);
    expect(r.ok).toBe(true);
    for (const t of r.touched) s.touched.add(t);
    s.run();

    // Four outer walls plus four inner ones: the hole becomes a shaft.
    const walls = [...s.graph.faces.values()].filter(f => Math.abs(f.plane.normal.y) < 0.01);
    expect(walls.length).toBe(8);
    expect(checkIntegrity(s.graph)).toEqual([]);

    // The far cap must ALSO have a hole — and nothing may be sitting behind
    // it. A face at the far end with no hole of its own, positioned exactly
    // where the shaft's opening is, would be a phantom lid silently
    // plugging what should stay open.
    const holedFaces = [...s.graph.faces.values()].filter(f => f.innerLoops.length > 0);
    expect(holedFaces).toHaveLength(2); // the original base + the new far cap
    const phantomLid = [...s.graph.faces.values()].find(
      f => f.innerLoops.length === 0 &&
        Math.abs(f.plane.normal.y) > 0.99 &&
        Math.abs(f.plane.point.y - 2) < 1e-6,
    );
    expect(phantomLid).toBeUndefined();
  });

  it('regression: a phantom lid must not survive the CALLER\'s own follow-up derive', () => {
    // The bug this guards: the far cap's hole boundary is a closed ring of
    // edges, and by the kernel's own core rule a closed planar cycle IS a
    // face — so that ring was ALSO derived into a standalone "lid" plugging
    // the shaft. Deleting it inside pushPull alone was not enough: derive()
    // always re-examines every edge in the graph on every call, and
    // kernelPushPull.ts's binding ALWAYS derives again immediately after
    // pushPull returns. If the lid's edges were still marked "touched" for
    // THAT second call, it found no face there any more, concluded
    // "unmatched but touched, so build one", and silently recreated the
    // exact lid just removed.
    const s = scene();
    groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;

    const offset = insertFaceOffset(s.ctx, id, -1);
    expect(offset.ok).toBe(true);
    for (const t of offset.touched) s.touched.add(t);
    s.run();

    const frame = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const innerFace = [...s.graph.faces.values()].find(f => f.innerLoops.length === 0)!;

    const r = pushPull(s.ctx, frame.id, 2, PP);
    expect(r.ok).toBe(true);

    // Mimic the caller EXACTLY: kernelPushPull.ts derives again over
    // whatever pushPull() returns, immediately after.
    for (const t of r.touched) s.touched.add(t);
    s.run();

    const totalHoled = [...s.graph.faces.values()].filter(f => f.innerLoops.length > 0).length;
    expect(totalHoled).toBe(2); // original base + far cap, each with a hole

    const phantomLid = [...s.graph.faces.values()].find(
      f => f.innerLoops.length === 0 &&
        Math.abs(f.plane.normal.y) > 0.99 &&
        Math.abs(f.plane.point.y - 2) < 1e-6,
    );
    expect(phantomLid).toBeUndefined();

    // The pre-existing inner surface (from the offset) must survive
    // untouched — only the NEW phantom at the far end should ever be
    // removed.
    expect(s.graph.faces.has(innerFace.id)).toBe(true);
    expect(checkIntegrity(s.graph)).toEqual([]);

    // Stable under a THIRD, unrelated derive call too, not just lucky once.
    derive(s.graph, new Set(), OPTS);
    expect([...s.graph.faces.values()].filter(f => f.innerLoops.length === 0 &&
      Math.abs(f.plane.normal.y) > 0.99 && Math.abs(f.plane.point.y - 2) < 1e-6)).toHaveLength(0);
  });
});

describe('drag distance from a ray', () => {
  it('projects an angled cursor ray onto the face normal', () => {
    // The user drags while looking at the model from an angle, so the ray is
    // never along the extrusion axis. A horizontal ray aimed at a point 3
    // above the face resolves to a 3-unit pull.
    const s = scene(); groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    const d = pushPullDistanceFromRay(
      s.graph, id,
      { origin: vec3(10, 3, 2), direction: vec3(-1, 0, 0) },
      vec3(2, 0, 2),
    );
    expect(d).not.toBeNull();
    expect(d!).toBeCloseTo(3, 6);
  });

  it('tracks the cursor: further up the screen means a longer pull', () => {
    const s = scene(); groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    const at = (h: number) => pushPullDistanceFromRay(
      s.graph, id,
      { origin: vec3(10, h, 2), direction: vec3(-1, 0, 0) },
      vec3(2, 0, 2),
    )!;
    expect(at(5)).toBeGreaterThan(at(2));
  });

  it('refuses a ray parallel to the axis', () => {
    // Letting it through would send the face to infinity on the first pixel.
    const s = scene(); groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    expect(pushPullDistanceFromRay(
      s.graph, id,
      { origin: vec3(2, 3, 2), direction: vec3(0, 1, 0) },
      vec3(2, 0, 2),
    )).toBeNull();
  });
});

describe('coplanar neighbours', () => {
  it('finds the other half of a split surface', () => {
    const s = scene(); groundSquare(s, 4);
    s.draw(vec3(0,0,0), vec3(4,0,4));
    s.run();
    const [a, b] = [...s.graph.faces.keys()].sort((x,y)=>x-y);
    expect(coplanarNeighbours(s.graph, a!, T)).toContain(b!);
  });

  it('does not include a wall at right angles', () => {
    const s = scene(); groundSquare(s, 4);
    const id = [...s.graph.faces.keys()][0]!;
    const r = pushPull(s.ctx, id, 2, PP);
    for (const t of r.touched) s.touched.add(t);
    s.run();
    const cap = [...s.graph.faces.values()].find(f => Math.abs(f.plane.point.y - 2) < 0.5);
    if (cap) {
      for (const n of coplanarNeighbours(s.graph, cap.id, T)) {
        expect(Math.abs(s.graph.faces.get(n)!.plane.normal.y)).toBeGreaterThan(0.9);
      }
    }
  });
});

describe('determinism', () => {
  it('the same extrusion twice gives the same graph', () => {
    const build = () => {
      const s = scene(); groundSquare(s, 4);
      const r = pushPull(s.ctx, [...s.graph.faces.keys()][0]!, 2, PP);
      for (const t of r.touched) s.touched.add(t);
      s.run();
      return `${s.graph.vertices.size}/${s.graph.edges.size}/${s.graph.faces.size}/${totalArea(s.graph).toFixed(6)}`;
    };
    expect(build()).toBe(build());
  });
});
