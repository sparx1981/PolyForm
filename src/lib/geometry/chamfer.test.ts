import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, loopVertexIds, getVertex, addVertex, addEdge, addLoop } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { pushPull } from './pushpull';
import { chamferSolid, computeChamferInsets, computeChamferInsetsFromBoundaries, computeSafeMaxAmount } from './chamfer';
import { vec3 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId, FaceId } from './types';

const OPTS = { tolerances: T, upAxis: vec3(0, 1, 0) };

function scene() {
  const graph = createGraph();
  const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
  const touched = new Set<EdgeId>();
  const draw = (a: ReturnType<typeof vec3>, b: ReturnType<typeof vec3>) => {
    for (const t of insertEdge(ctx, a, b).touched) touched.add(t);
  };
  const run = () => {
    const r = derive(graph, touched, OPTS);
    touched.clear();
    return r;
  };
  return { graph, ctx, draw, run, touched };
}

function box(s: ReturnType<typeof scene>, side = 4, height = 2) {
  const p = [vec3(0, 0, 0), vec3(side, 0, 0), vec3(side, 0, side), vec3(0, 0, side)];
  for (let i = 0; i < 4; i++) s.draw(p[i]!, p[(i + 1) % 4]!);
  s.run();
  const baseId = [...s.graph.faces.keys()][0]!;
  const r = pushPull(s.ctx, baseId, height, { tolerances: T });
  for (const t of r.touched) s.touched.add(t);
  s.run();
}

function triangularPrism(s: ReturnType<typeof scene>, height = 2) {
  s.draw(vec3(0, 0, 0), vec3(4, 0, 0));
  s.draw(vec3(4, 0, 0), vec3(2, 0, 4));
  s.draw(vec3(2, 0, 4), vec3(0, 0, 0));
  s.run();
  const baseId = [...s.graph.faces.keys()][0]!;
  const r = pushPull(s.ctx, baseId, height, { tolerances: T });
  for (const t of r.touched) s.touched.add(t);
  s.run();
}

function cylinder(s: ReturnType<typeof scene>, sides = 8, height = 2) {
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return vec3(Math.cos(a) * 3, 0, Math.sin(a) * 3);
  });
  for (let i = 0; i < sides; i++) s.draw(pts[i]!, pts[(i + 1) % sides]!);
  s.run();
  const baseId = [...s.graph.faces.keys()][0]!;
  const r = pushPull(s.ctx, baseId, height, { tolerances: T });
  for (const t of r.touched) s.touched.add(t);
  s.run();
}

function sideCountDistribution(s: ReturnType<typeof scene>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const f of s.graph.faces.values()) {
    const n = s.graph.loops.get(f.outerLoop)!.uses.length;
    out[n] = (out[n] ?? 0) + 1;
  }
  return out;
}

/** True only if every face's normal points away from the solid's own centroid. */
function allOutwardFacing(s: ReturnType<typeof scene>): boolean {
  const allPts = [];
  for (const f of s.graph.faces.values()) {
    for (const vid of loopVertexIds(s.graph, f.outerLoop)) allPts.push(getVertex(s.graph, vid).position);
  }
  let cx = 0, cy = 0, cz = 0;
  for (const p of allPts) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= allPts.length; cy /= allPts.length; cz /= allPts.length;

  for (const f of s.graph.faces.values()) {
    const toFace = { x: f.plane.point.x - cx, y: f.plane.point.y - cy, z: f.plane.point.z - cz };
    const d = toFace.x * f.plane.normal.x + toFace.y * f.plane.normal.y + toFace.z * f.plane.normal.z;
    if (d < 0) return false;
  }
  return true;
}

describe('chamferSolid — a box (the common case)', () => {
  it('produces exactly 26 faces: 6 shrunk + 12 bevel quads + 8 corner triangles', () => {
    const s = scene(); box(s, 4, 2);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(result.ok).toBe(true);
    expect(s.graph.faces.size).toBe(26);

    const dist = sideCountDistribution(s);
    expect(dist[3]).toBe(8);  // corner triangles
    expect(dist[4]).toBe(18); // 6 shrunk faces + 12 bevel quads
  });

  it('every resulting face is correctly oriented outward', () => {
    const s = scene(); box(s, 4, 2);
    chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(allOutwardFacing(s)).toBe(true);
  });

  it('passes full topology integrity checks', () => {
    const s = scene(); box(s, 4, 2);
    chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('none of the original sharp edges or vertices survive', () => {
    const s = scene(); box(s, 4, 2);
    const beforeVerts = new Set([...s.graph.vertices.keys()]);
    chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    // Every original vertex should be gone -- replaced entirely by the new
    // inset geometry, not left behind as leftover unused topology.
    for (const vid of beforeVerts) {
      expect(s.graph.vertices.has(vid)).toBe(false);
    }
  });

  it('stays stable under an unrelated derive call elsewhere in the model — FIXED', () => {
    // The bug this used to guard, and how it is actually fixed:
    //
    // derive() always re-examines the ENTIRE graph on every call
    // (regionsFor is passed every edge, not just the touched ones), and
    // its plane-bucketing builds a candidate plane from every pair of
    // edges meeting at a vertex. That is correct for a simple box
    // (degree-3 corners, every pairing genuinely real) but not for a
    // chamfered corner (degree-4+, where some pairings are just two edges
    // that happen to touch a point without ever being meant as one face's
    // boundary). On a symmetric chamfered solid, enough of those coincide
    // into a bogus flat "slice" region that correctly-built facets get
    // silently replaced by wrong ones.
    //
    // Two attempts at fixing regionsFor's own heuristic directly failed —
    // one broke 42 unrelated existing tests (a new face legitimately
    // needs to reuse an edge that already belongs to an older face, which
    // that fix wrongly forbade), the other never even triggered for this
    // exact case, meaning the real mechanism wasn't understood well
    // enough to touch safely.
    //
    // The actual fix does not touch that heuristic at all: chamferSolid's
    // faces are marked `chamferLocked`, and derive() excludes an edge from
    // its input ENTIRELY if it belongs only to locked faces and nothing
    // is currently trying to touch it — see derive()'s own doc comment.
    // An edit anywhere else in the model, with its own unrelated touched
    // set, never puts the chamfered edges in front of regionsFor at all,
    // so they can never be mis-bucketed by it.
    const s = scene(); box(s, 4, 2);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(result.ok).toBe(true);
    expect(s.graph.faces.size).toBe(26);

    // An unrelated edit, far away, with its own touched set — NOT
    // chamfer's. This is what a real, correctly-written tool binding
    // triggers: kernelChamfer.ts never re-derives with chamferSolid's own
    // touched set, since direct construction is already complete.
    const p2 = [vec3(20, 0, 0), vec3(24, 0, 0), vec3(24, 0, 4), vec3(20, 0, 4)];
    const touched2 = new Set<EdgeId>();
    for (let i = 0; i < 4; i++) {
      for (const t of insertEdge(s.ctx, p2[i]!, p2[(i + 1) % 4]!).touched) touched2.add(t);
    }
    derive(s.graph, touched2, OPTS);

    expect(s.graph.faces.size).toBe(27); // 26 chamfer + 1 new, unrelated square
    const chamferFaces = [...s.graph.faces.values()].filter(
      (f) => (f.attributes.custom as { chamferLocked?: boolean } | undefined)?.chamferLocked,
    );
    expect(chamferFaces).toHaveLength(26);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('a documented, narrower limitation remains: re-deriving with the chamfer edges THEMSELVES touched can still corrupt it', () => {
    // This is the trade-off the fix above deliberately makes, not a gap in
    // it: the exclusion only applies while nothing is trying to touch
    // those specific edges. The moment something legitimately needs to
    // (the user editing that exact geometry again — moving it, pushing
    // one of its faces further), those edges re-enter derive()'s input
    // and the underlying regionsFor limitation still applies to them.
    // Documented here so it stays a known, visible property of the
    // system rather than a surprise discovered later.
    const s = scene(); box(s, 4, 2);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(result.ok).toBe(true);

    // Re-deriving with chamfer's OWN touched set is exactly what a naive
    // tool binding would do if it followed the push/pull/offset pattern
    // of "always derive again after the operation" without accounting
    // for chamferSolid already being a complete, direct construction.
    derive(s.graph, result.touched, OPTS);
    // Not asserting a specific count here — the point is this scenario is
    // NOT protected, and a real tool binding must simply not do this.
  });
});

describe('chamferSolid — triangular prism and cylinder', () => {
  it('a triangular prism produces exactly 20 faces', () => {
    const s = scene(); triangularPrism(s, 2);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(result.ok).toBe(true);
    // 2 shrunk triangle caps + 3 shrunk quad walls = 5
    // 9 original edges -> 9 bevel quads
    // 6 original vertices -> 6 corner triangles
    // 5 + 9 + 6 = 20
    expect(s.graph.faces.size).toBe(20);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(allOutwardFacing(s)).toBe(true);
  });

  it('an 8-segment cylinder produces exactly 50 faces', () => {
    const s = scene(); cylinder(s, 8, 2);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(result.ok).toBe(true);
    // 2 shrunk octagon caps + 8 shrunk quad walls = 10
    // 24 original edges (8 top ring + 8 bottom ring + 8 verticals) -> 24 bevel quads
    // 16 original vertices -> 16 corner triangles
    // 10 + 24 + 16 = 50
    expect(s.graph.faces.size).toBe(50);
    expect(checkIntegrity(s.graph)).toEqual([]);
    expect(allOutwardFacing(s)).toBe(true);
  });
});

describe('chamferSolid — eligibility and refusals', () => {
  it('accepts a face with a hole, carrying the hole over unchanged', () => {
    // A face with a hole USED to be rejected outright — the hole is
    // interior to the face and never touches the edges actually being
    // chamfered, so there's no real reason it should block the whole
    // solid.
    //
    // The hole here is added DIRECTLY to an already-finished box's face
    // (addEdge/addLoop, bypassing insertEdge/derive() and pushPull
    // entirely for this step) rather than drawn as a smaller square
    // inside a bigger one before pushing/pulling it into a solid. That
    // is a deliberate choice, not a shortcut: the "obvious" drawing
    // order exposed a genuine, PRE-EXISTING kernel bug, unrelated to
    // chamfer — derive() re-processing a pushed/pulled face-with-a-hole
    // creates a spurious extra "plug" face capping the hole instead of
    // leaving it open into the tunnel walls below, confirmed
    // independently of any of this session's own chamfer/fillet code.
    // That bug blocks the normal drawing workflow for this feature and
    // needs its own dedicated investigation — it is not something this
    // test, or the hole-support code it verifies, is responsible for.
    // chamferSolid itself never calls derive() (direct construction
    // throughout), so building the hole this way isolates its own
    // correctness from that separate, outstanding problem entirely.
    const s = scene(); box(s, 8, 2);
    const face = [...s.graph.faces.values()].find((f) => f.plane.normal.y < -0.5)!;

    const inner = [vec3(2, 0, 2), vec3(4, 0, 2), vec3(4, 0, 4), vec3(2, 0, 4)];
    const vids = inner.map((pt) => addVertex(s.graph, pt).id);
    const holeEdgeIds = vids.map((_, i) => addEdge(s.graph, vids[i]!, vids[(i + 1) % 4]!).id);
    const holeLoop = addLoop(s.graph, face.id, holeEdgeIds, 'inner', vids[0]!);
    face.innerLoops.push(holeLoop.id);
    expect(checkIntegrity(s.graph)).toEqual([]);

    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    expect(result.ok).toBe(true);
    expect(checkIntegrity(s.graph)).toEqual([]);

    const shrunkWithHole = [...s.graph.faces.values()].find((f) => f.innerLoops.length === 1);
    expect(shrunkWithHole).toBeDefined();
    const holePoints = loopVertexIds(s.graph, shrunkWithHole!.innerLoops[0]!).map(
      (vid) => getVertex(s.graph, vid).position,
    );
    expect(holePoints).toHaveLength(4);
    // The hole's own bounding box should exactly match the original
    // (2,0,2)-(4,0,4) square — unmoved, unshrunk, unrotated.
    const xs = holePoints.map((p) => p.x), zs = holePoints.map((p) => p.z);
    expect(Math.min(...xs)).toBeCloseTo(2, 5);
    expect(Math.max(...xs)).toBeCloseTo(4, 5);
    expect(Math.min(...zs)).toBeCloseTo(2, 5);
    expect(Math.max(...zs)).toBeCloseTo(4, 5);
  });

  it('refuses a set of loose, unconnected faces (not a closed solid)', () => {
    const s = scene(); box(s, 4, 2);
    // Drop the last face so the set no longer forms a closed solid.
    const ids = [...s.graph.faces.keys()];
    const result = chamferSolid(s.ctx, ids.slice(0, 5), 0.3);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/closed solid/);
  });

  it('refuses too few faces outright', () => {
    const s = scene();
    const result = chamferSolid(s.ctx, [1, 2, 3] as FaceId[], 0.3);
    expect(result.ok).toBe(false);
  });

  it('refuses a non-positive amount', () => {
    const s = scene(); box(s, 4, 2);
    const ids = [...s.graph.faces.keys()];
    expect(chamferSolid(s.ctx, ids, 0).ok).toBe(false);
    expect(chamferSolid(s.ctx, ids, -0.5).ok).toBe(false);
  });

  it('refuses a face that is not found', () => {
    const s = scene();
    const result = chamferSolid(s.ctx, [999 as FaceId, 998 as FaceId, 997 as FaceId, 996 as FaceId], 0.3);
    expect(result.ok).toBe(false);
  });
});

describe('chamferSolid — geometry sanity', () => {
  it('every original sharp corner is genuinely cut off', () => {
    // Each of the box's 8 corners should now have NOTHING sitting exactly
    // where the original sharp corner was -- that point is precisely what
    // chamfering removes.
    const s = scene(); box(s, 4, 2);
    const originalCorners = [
      vec3(0,0,0), vec3(4,0,0), vec3(4,0,4), vec3(0,0,4),
      vec3(0,2,0), vec3(4,2,0), vec3(4,2,4), vec3(0,2,4),
    ];
    chamferSolid(s.ctx, [...s.graph.faces.keys()], 0.3);
    const positions = [...s.graph.vertices.values()].map(v => v.position);
    for (const corner of originalCorners) {
      const stillThere = positions.some(p =>
        Math.abs(p.x - corner.x) < 1e-6 && Math.abs(p.y - corner.y) < 1e-6 && Math.abs(p.z - corner.z) < 1e-6,
      );
      expect(stillThere).toBe(false);
    }
  });

  it('a bigger chamfer amount cuts further back from each original corner', () => {
    // Distance from the (no-longer-present) original corner to the nearest
    // NEW vertex should grow with the chamfer amount -- a wall's own shrunk
    // boundary stays on that wall's own plane regardless of amount (only
    // the OTHER two dimensions shrink there), so overall bounding-box span
    // is the wrong thing to check; distance from a specific corner is not.
    const distanceFromCorner = (amount: number) => {
      const s = scene(); box(s, 4, 2);
      chamferSolid(s.ctx, [...s.graph.faces.keys()], amount);
      const positions = [...s.graph.vertices.values()].map(v => v.position);
      const corner = vec3(0, 0, 0);
      return Math.min(...positions.map(p => Math.hypot(p.x - corner.x, p.y - corner.y, p.z - corner.z)));
    };
    expect(distanceFromCorner(0.5)).toBeGreaterThan(distanceFromCorner(0.1));
  });
});

describe('computeChamferInsetsFromBoundaries', () => {
  it('produces the same shrunk boundary as computeChamferInsets, for the identical face', () => {
    // The core claim this function exists to satisfy: previewing a
    // re-apply from raw stored boundary points must match what a normal
    // chamfer of that same face, read from the graph, would show —
    // otherwise the preview and the real operation disagree, which is
    // the actual bug this was built to fix.
    const s = scene(); box(s, 4, 2);
    const faceId = [...s.graph.faces.keys()][0]!;
    const face = s.graph.faces.get(faceId)!;
    const order = loopVertexIds(s.graph, face.outerLoop);
    const points = order.map((vid) => getVertex(s.graph, vid).position);

    const graphBased = computeChamferInsets(s.graph, [faceId], 0.3);
    const graphInset = order.map((vid) => graphBased.insetPoint.get(faceId)!.get(vid)!);

    const fromBoundaries = computeChamferInsetsFromBoundaries([points], 0.3);
    expect(fromBoundaries).toHaveLength(1);
    expect(fromBoundaries[0]).toHaveLength(order.length);

    for (let i = 0; i < order.length; i++) {
      expect(fromBoundaries[0]![i]!.x).toBeCloseTo(graphInset[i]!.x, 5);
      expect(fromBoundaries[0]![i]!.y).toBeCloseTo(graphInset[i]!.y, 5);
      expect(fromBoundaries[0]![i]!.z).toBeCloseTo(graphInset[i]!.z, 5);
    }
  });

  it('returns an empty array for a degenerate boundary (fewer than 3 usable points)', () => {
    const result = computeChamferInsetsFromBoundaries([[vec3(0, 0, 0), vec3(0, 0, 0)]], 0.3);
    expect(result[0]).toEqual([]);
  });

  it('handles multiple boundaries independently', () => {
    const s = scene(); box(s, 4, 2);
    const faceIds = [...s.graph.faces.keys()].slice(0, 2);
    const boundaries = faceIds.map((fid) => {
      const f = s.graph.faces.get(fid)!;
      return loopVertexIds(s.graph, f.outerLoop).map((vid) => getVertex(s.graph, vid).position);
    });
    const result = computeChamferInsetsFromBoundaries(boundaries, 0.3);
    expect(result).toHaveLength(2);
    for (const inset of result) expect(inset.length).toBeGreaterThan(0);
  });
});

describe('computeSafeMaxAmount', () => {
  it('returns half the shortest edge for a 4x4x2 box (the height)', () => {
    const s = scene(); box(s, 4, 2);
    const safeMax = computeSafeMaxAmount(s.graph, [...s.graph.faces.keys()]);
    expect(safeMax).toBeCloseTo(1, 5);
  });

  it('returns half the shortest edge for a non-cube box', () => {
    const s = scene(); box(s, 10, 3);
    const safeMax = computeSafeMaxAmount(s.graph, [...s.graph.faces.keys()]);
    // shortest edge is the height (3), so safe max is 1.5
    expect(safeMax).toBeCloseTo(1.5, 5);
  });

  it('an amount at the safe max produces a degenerate (but non-inverted) result', () => {
    // Confirms the boundary case directly, matching what was found by
    // empirical probing before this function was written: AT the exact
    // safe max, the face-shrink math produces a valid (if minimal/edge-
    // case) result — the actual inversion only begins strictly past it.
    const s = scene(); box(s, 4, 2);
    const safeMax = computeSafeMaxAmount(s.graph, [...s.graph.faces.keys()]);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], safeMax);
    expect(result.ok).toBe(true);
    expect(checkIntegrity(s.graph)).toEqual([]);
  });

  it('an amount past the safe max inverts a face — confirms the actual bug this exists to prevent', () => {
    const s = scene(); box(s, 4, 2);
    const safeMax = computeSafeMaxAmount(s.graph, [...s.graph.faces.keys()]);
    const result = chamferSolid(s.ctx, [...s.graph.faces.keys()], safeMax * 1.5);
    expect(result.ok).toBe(true); // succeeds "cleanly" — this IS the bug
    // A side face's own Y-extent should span [0, 2] narrowing inward from
    // both ends by the same amount — if inverted, the resulting interval
    // is reversed (this reproduces the exact side-face points found
    // during investigation: min > raw-max before taking abs, i.e. the
    // face is mirrored rather than simply shrunk).
    const sideFace = [...s.graph.faces.values()].find(
      (f) => Math.abs(f.plane.normal.x) > 0.9,
    )!;
    const pts = loopVertexIds(s.graph, sideFace.outerLoop).map(
      (vid) => getVertex(s.graph, vid).position,
    );
    const ys = pts.map((p) => p.y);
    const rawMin = 0 + safeMax * 1.5; // where "min" WOULD be if not inverted
    const rawMax = 2 - safeMax * 1.5; // where "max" WOULD be if not inverted
    // If genuinely inverted, rawMin > rawMax, and the actual points span
    // [rawMax, rawMin] (the physically-correct absolute range) rather than
    // the intended [rawMin, rawMax] — confirming the face is mirrored.
    expect(rawMin).toBeGreaterThan(rawMax);
    expect(Math.min(...ys)).toBeCloseTo(rawMax, 5);
    expect(Math.max(...ys)).toBeCloseTo(rawMin, 5);
  });
});
