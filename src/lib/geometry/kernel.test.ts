/**
 * PHASE 9 — KERNEL INTEGRATION GATE. §10.2
 *
 * No new implementation. A scripted session exercising every kernel operation
 * together, asserting counts, area, face identity and determinism at each
 * step.
 *
 * Nothing past this point should be built while this is red. Interaction bugs
 * and kernel bugs are indistinguishable from the UI, and debugging them
 * together costs several times what verifying the kernel alone does. §10.4
 */

import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopPoints, removeFace } from './topology';
import { insertEdge, createEdgeIndex, type InsertContext } from './insert';
import { derive } from './derive';
import { snapshot, restore, deleteEdge } from './heal';
import { vec3, planeBasis } from './math';
import { signedArea } from './polygon';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId, FaceId, Graph } from './types';

/** Fixed camera so orientation is reproducible. §6.4 */
const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1) };

interface Session {
  graph: Graph;
  ctx: InsertContext;
  touched: Set<EdgeId>;
}

function newSession(): Session {
  const graph = createGraph();
  return {
    graph,
    ctx: { graph, tolerances: T, index: createEdgeIndex(graph, 1) },
    touched: new Set<EdgeId>(),
  };
}

const draw = (s: Session, x0: number, y0: number, x1: number, y1: number) => {
  const r = insertEdge(s.ctx, vec3(x0, y0, 0), vec3(x1, y1, 0));
  for (const t of r.touched) s.touched.add(t);
  return r;
};

const run = (s: Session) => {
  const r = derive(s.graph, s.touched, OPTS);
  s.touched.clear();
  return r;
};

const netArea = (g: Graph): number => {
  let sum = 0;
  for (const f of g.faces.values()) {
    const b = planeBasis(f.plane);
    const to2 = (p: { x: number; y: number; z: number }) => ({
      x: (p.x - b.origin.x) * b.u.x + (p.y - b.origin.y) * b.u.y + (p.z - b.origin.z) * b.u.z,
      y: (p.x - b.origin.x) * b.v.x + (p.y - b.origin.y) * b.v.y + (p.z - b.origin.z) * b.v.z,
    });
    sum += Math.abs(signedArea(loopPoints(g, f.outerLoop).map(to2)));
    for (const l of f.innerLoops) sum -= Math.abs(signedArea(loopPoints(g, l).map(to2)));
  }
  return sum;
};

/** Every invariant the kernel must never violate, checked after each step. */
function assertInvariants(g: Graph, step: string): void {
  expect(checkIntegrity(g), `integrity after ${step}`).toEqual([]);

  for (const f of g.faces.values()) {
    const b = planeBasis(f.plane);
    const to2 = (p: { x: number; y: number; z: number }) => ({
      x: (p.x - b.origin.x) * b.u.x + (p.y - b.origin.y) * b.u.y + (p.z - b.origin.z) * b.u.z,
      y: (p.x - b.origin.x) * b.v.x + (p.y - b.origin.y) * b.v.y + (p.z - b.origin.z) * b.v.z,
    });
    // Outer counter-clockwise, every hole counter to it. §6.4
    const outer = signedArea(loopPoints(g, f.outerLoop).map(to2));
    expect(outer, `outer winding after ${step}`).toBeGreaterThan(0);
    for (const l of f.innerLoops) {
      const inner = signedArea(loopPoints(g, l).map(to2));
      expect(inner, `inner winding after ${step}`).toBeLessThan(0);
    }
  }

  // No two edges may share both endpoints.
  const seen = new Set<string>();
  for (const e of g.edges.values()) {
    const k = [e.v0, e.v1].sort((a, b) => a - b).join(':');
    expect(seen.has(k), `duplicate edge after ${step}`).toBe(false);
    seen.add(k);
  }
}

/**
 * The full session. Returns a fingerprint used for the determinism and
 * round-trip assertions.
 */
function scriptedSession(): {
  log: string[];
  finalFaces: FaceId[];
  finalArea: number;
} {
  const s = newSession();
  const log: string[] = [];
  const note = (label: string) => {
    assertInvariants(s.graph, label);
    log.push(
      `${label}: v=${s.graph.vertices.size} e=${s.graph.edges.size} ` +
        `f=${s.graph.faces.size} a=${netArea(s.graph).toFixed(6)}`,
    );
  };

  // 1-4: draw a 6x6 square
  draw(s, 0, 0, 6, 0); draw(s, 6, 0, 6, 6); draw(s, 6, 6, 0, 6); draw(s, 0, 6, 0, 0);
  run(s); note('01 square');
  expect(s.graph.faces.size).toBe(1);
  expect(netArea(s.graph)).toBeCloseTo(36, 9);

  const squareFaceId = [...s.graph.faces.keys()][0]!;

  // 5: split it with a diagonal
  draw(s, 0, 0, 6, 6);
  run(s); note('02 split');
  expect(s.graph.faces.size).toBe(2);
  expect(netArea(s.graph)).toBeCloseTo(36, 9);
  expect(s.graph.faces.has(squareFaceId)).toBe(false); // the square is gone, two triangles replace it

  // 6: erase the diagonal — the halves merge back
  const diagonal = [...s.graph.edges.values()].find((e) => {
    const a = s.graph.vertices.get(e.v0)!.position;
    const b = s.graph.vertices.get(e.v1)!.position;
    return Math.abs(a.x - a.y) < 1e-9 && Math.abs(b.x - b.y) < 1e-9;
  })!;
  const del = deleteEdge(s.graph, diagonal.id, T);
  for (const t of del.touched) s.touched.add(t);
  run(s); note('03 merge');
  expect(s.graph.faces.size).toBe(1);
  expect(netArea(s.graph)).toBeCloseTo(36, 9);

  // 7-10: draw an island inside it
  draw(s, 2, 2, 4, 2); draw(s, 4, 2, 4, 4); draw(s, 4, 4, 2, 4); draw(s, 2, 4, 2, 2);
  run(s); note('04 island');
  expect(s.graph.faces.size).toBe(2);
  expect(netArea(s.graph)).toBeCloseTo(36, 9); // 32 outer + 4 island

  // 11: delete the island face — the void is structural, no suppression state
  const island = [...s.graph.faces.values()].find((f) => f.innerLoops.length === 0)!;
  const outerId = [...s.graph.faces.values()].find((f) => f.innerLoops.length === 1)!.id;
  removeFace(s.graph, island.id);
  note('05 island deleted');
  expect(s.graph.faces.size).toBe(1);
  expect(s.graph.faces.get(outerId)!.innerLoops).toHaveLength(1);
  expect(netArea(s.graph)).toBeCloseTo(32, 9);

  // 12: an unrelated edit elsewhere must NOT refill the void
  draw(s, 10, 0, 12, 0); draw(s, 12, 0, 12, 2); draw(s, 12, 2, 10, 2); draw(s, 10, 2, 10, 0);
  run(s); note('06 unrelated square');
  expect(s.graph.faces.get(outerId)!.innerLoops).toHaveLength(1);
  expect(netArea(s.graph)).toBeCloseTo(32 + 4, 9);

  // 13: retrace an island edge — the island comes back
  const retrace = insertEdge(s.ctx, vec3(2, 2, 0), vec3(4, 2, 0));
  expect(retrace.wasOverdraw).toBe(true);
  for (const t of retrace.touched) s.touched.add(t);
  run(s); note('07 retrace heals');
  expect(netArea(s.graph)).toBeCloseTo(32 + 4 + 4, 9);

  // 14: delete the whole outer face, then draw across the void
  const outerNow = [...s.graph.faces.values()].find((f) => f.innerLoops.length === 1);
  if (outerNow) removeFace(s.graph, outerNow.id);
  note('08 outer deleted');

  draw(s, 0, 0, 6, 6);
  run(s); note('09 draw across void');

  const finalFaces = [...s.graph.faces.keys()].sort((a, b) => a - b);
  return { log, finalFaces, finalArea: netArea(s.graph) };
}

describe('PHASE 9 — kernel integration gate', () => {
  it('runs a full scripted session with every invariant holding', () => {
    const { log } = scriptedSession();
    expect(log.length).toBeGreaterThanOrEqual(9);
  });

  it('is deterministic across repeated runs', () => {
    // No Math.random, no Date, no reliance on object key ordering. §10.3
    const a = scriptedSession();
    const b = scriptedSession();
    expect(a.log).toEqual(b.log);
    expect(a.finalFaces).toEqual(b.finalFaces);
    expect(a.finalArea).toBeCloseTo(b.finalArea, 12);
  });

  it('survives a serialise/deserialise round-trip', () => {
    const s = newSession();
    draw(s, 0, 0, 4, 0); draw(s, 4, 0, 4, 4); draw(s, 4, 4, 0, 4); draw(s, 0, 4, 0, 0);
    draw(s, 0, 0, 4, 4);
    run(s);

    const before = {
      faces: [...s.graph.faces.keys()].sort((a, b) => a - b),
      area: netArea(s.graph),
      edges: s.graph.edges.size,
    };

    const snap = snapshot(s.graph);
    const revived = createGraph();
    restore(revived, snap);

    expect([...revived.faces.keys()].sort((a, b) => a - b)).toEqual(before.faces);
    expect(netArea(revived)).toBeCloseTo(before.area, 12);
    expect(revived.edges.size).toBe(before.edges);
    expect(checkIntegrity(revived)).toEqual([]);
  });

  it('undoes to empty and redoes forward with identical IDs', () => {
    const s = newSession();
    const snaps = [snapshot(s.graph)];

    const steps: [number, number, number, number][] = [
      [0, 0, 3, 0], [3, 0, 3, 3], [3, 3, 0, 3], [0, 3, 0, 0], [0, 0, 3, 3],
    ];
    const forward: string[] = [];
    for (const [a, b, c, d] of steps) {
      draw(s, a, b, c, d);
      run(s);
      forward.push(`${s.graph.edges.size}/${s.graph.faces.size}/${[...s.graph.faces.keys()].join('-')}`);
      snaps.push(snapshot(s.graph));
    }
    expect(s.graph.faces.size).toBe(2);

    // Undo all the way to empty.
    restore(s.graph, snaps[0]!);
    expect(s.graph.edges.size).toBe(0);
    expect(s.graph.faces.size).toBe(0);

    // Redo forward: identical IDs at every step, because restore does not
    // re-derive. §7.0
    for (let i = 0; i < steps.length; i++) {
      restore(s.graph, snaps[i + 1]!);
      const fingerprint =
        `${s.graph.edges.size}/${s.graph.faces.size}/${[...s.graph.faces.keys()].join('-')}`;
      expect(fingerprint).toBe(forward[i]);
    }
  });

  it('holds up on a larger model without degrading', () => {
    const s = newSession();
    // A 6x6 grid of cells: 84 edges, 36 faces.
    for (let i = 0; i <= 6; i++) {
      draw(s, i, 0, i, 6);
      draw(s, 0, i, 6, i);
    }
    run(s);
    assertInvariants(s.graph, 'grid');
    expect(s.graph.faces.size).toBe(36);
    expect(netArea(s.graph)).toBeCloseTo(36, 9);

    // One more edit must not disturb the rest.
    const before = [...s.graph.faces.keys()];
    draw(s, 10, 10, 11, 10);
    run(s);
    const after = [...s.graph.faces.keys()];
    expect(after).toEqual(before);
  });
});
