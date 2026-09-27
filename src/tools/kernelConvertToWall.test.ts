import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createFaceOffsetBinding } from './kernelFaceOffset';
import { createPushPullBinding } from './kernelPushPull';
import { analyzeWallConversion, buildWallShapes, outerRing, planWithThickness, cleanPolygon, heightWarnings, captureFaces, graphSignature, undoWallConversion, redoWallConversion, type WallConversionPlan, type WallConversionRejection, type WallConversionUndoLink } from './kernelConvertToWall';
import { deleteGroupFacesAndEdges } from './kernelSelection';
import { snapshot } from '../lib/geometry/heal';
import { groupContaining } from './kernelSelection';
import { vec3 } from '../lib/geometry/math';
import { loopPoints } from '../lib/geometry/topology';
import type { FaceId, Vec3 } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });

const outline = (h: KernelArcHost, pts: Vec3[]) => {
  for (let i = 0; i < pts.length; i++) h.commitSegment(pts[i]!, pts[(i + 1) % pts.length]!);
};
const rect = (h: KernelArcHost, w: number, d: number) =>
  outline(h, [vec3(0, 0, 0), vec3(w, 0, 0), vec3(w, 0, d), vec3(0, 0, d)]);
const circle = (h: KernelArcHost, r: number, n: number) =>
  outline(h, Array.from({ length: n }, (_, i) => vec3(r * Math.cos((2 * Math.PI * i) / n), 0, r * Math.sin((2 * Math.PI * i) / n))));

const only = (h: KernelArcHost) => [...h.graph.faces.keys()][0]!;

/** Offsets the only face inward by `t` using the real Offset tool binding. */
const offsetInward = (h: KernelArcHost, face: FaceId, t: number) => {
  const b = createFaceOffsetBinding(h, () => {});
  expect(b.begin(face)).toBe(true);
  // The cursor's signed distance to the boundary IS the offset, so a point
  // `t` inside the first edge's midpoint gives exactly -t.
  const pts = loopPoints(h.graph, h.graph.faces.get(face)!.outerLoop);
  const a = pts[0]!, c = pts[1]!;
  const mid = vec3((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2);
  // Step from that edge's midpoint toward the polygon's centroid by t.
  const cen = vec3(
    pts.reduce((s, p) => s + p.x, 0) / pts.length,
    pts.reduce((s, p) => s + p.y, 0) / pts.length,
    pts.reduce((s, p) => s + p.z, 0) / pts.length,
  );
  const dx = cen.x - mid.x, dy = cen.y - mid.y, dz = cen.z - mid.z, l = Math.hypot(dx, dy, dz);
  b.update(b.projectToSessionPlane(vec3(mid.x + (dx / l) * t, mid.y + (dy / l) * t, mid.z + (dz / l) * t))!);
  expect(b.commit()).toBe(true);
};

const ringFace = (h: KernelArcHost) =>
  [...h.graph.faces.entries()].find(([, f]) => f.innerLoops.length === 1)![0];

const pullUp = (h: KernelArcHost, face: FaceId, height: number) => {
  const pp = createPushPullBinding(h, () => {});
  const p = loopPoints(h.graph, h.graph.faces.get(face)!.outerLoop)[0]!;
  pp.begin(face, p);
  pp.update({ origin: vec3(p.x + 20, height, p.z), direction: vec3(-1, 0, 0) });
  expect(pp.commit()).toBe(true);
};

const sideFace = (h: KernelArcHost) =>
  [...h.graph.faces.entries()].find(([, f]) => Math.abs(f.plane.normal.y) < 0.01)![0];

const analyse = (h: KernelArcHost, face: FaceId) =>
  analyzeWallConversion(h.graph, face, groupContaining(h.graph, face));

const expectPlan = (r: ReturnType<typeof analyse>): WallConversionPlan => {
  if (!r.ok) throw new Error(`expected a plan, got: ${(r as WallConversionRejection).reason}`);
  return r as WallConversionPlan;
};

let n = 0;
const build = (plan: WallConversionPlan, height = plan.height ?? 2.4) =>
  buildWallShapes(plan, { height, color: '#fff', story: 1, makeId: () => `id${n++}`, existingWallCount: 0 });

describe('extruded rectangle ring', () => {
  const make = () => {
    const h = host();
    rect(h, 6, 4);
    offsetInward(h, only(h), 0.2);
    pullUp(h, ringFace(h), 2.5);
    return h;
  };

  it('becomes four walls of the drawn thickness and pulled height', () => {
    const h = make();
    const plan = expectPlan(analyse(h, sideFace(h)));
    expect(plan.flat).toBe(false);
    expect(plan.pieces).toHaveLength(4);
    expect(plan.thickness).toBeCloseTo(0.2, 4);
    expect(plan.height).toBeCloseTo(2.5, 4);
    expect(plan.baseY).toBeCloseTo(0, 6);
  });

  it('keeps the floor inside the ring out of the faces to remove', () => {
    const h = make();
    const plan = expectPlan(analyse(h, sideFace(h)));
    const floor = [...h.graph.faces.entries()].find(([, f]) =>
      f.innerLoops.length === 0 && Math.abs(f.plane.normal.y) > 0.99 &&
      loopPoints(h.graph, f.outerLoop).every(p => Math.abs(p.y) < 1e-6))![0];
    expect(plan.sourceFaces).not.toContain(floor);
  });

  it('finds the whole solid from any face, inside or out', () => {
    const h = make();
    const counts = new Set<number>();
    for (const [id, f] of h.graph.faces) {
      if (Math.abs(f.plane.normal.y) > 0.01) continue;
      counts.add(expectPlan(analyse(h, id)).sourceFaces.length);
    }
    expect(counts.size).toBe(1);
  });

  it('builds walls centred on the centreline with local +Z facing out', () => {
    const h = make();
    const walls = build(expectPlan(analyse(h, sideFace(h))));
    const lengths = walls.map(w => (w.args as number[])[0]!).sort((a, b) => a - b);
    // Centreline of a 6 x 4 outline with 0.2 walls is 5.8 x 3.8.
    expect(lengths[0]).toBeCloseTo(3.8, 4);
    expect(lengths[3]).toBeCloseTo(5.8, 4);
    for (const w of walls) {
      expect(w.position[1]).toBeCloseTo(1.25, 6);
      const [, qy, , qw] = w.quaternion!;
      const theta = 2 * Math.atan2(qy, qw);
      // Local +Z in world = (sin θ, cos θ); it must point away from the centre (3, 2).
      const out = { x: Math.sin(theta), z: Math.cos(theta) };
      expect(out.x * (w.position[0] - 3) + out.z * (w.position[2] - 2)).toBeGreaterThan(0);
      // Every footprint corner sits within the wall's half-thickness band.
      for (const [, z] of w.wallMiterFootprint!) expect(Math.abs(z)).toBeCloseTo(0.1, 4);
    }
  });

  it('warns about nothing for an ordinary 200 mm wall', () => {
    const h = make();
    expect(expectPlan(analyse(h, sideFace(h))).warnings).toEqual([]);
  });
});

describe('outward offset', () => {
  it('a frame grown around the shape converts the same way', () => {
    const h = host();
    rect(h, 4, 4);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    // 0.25 outside the middle of the first edge (z = 0).
    b.update(b.projectToSessionPlane(vec3(2, 0, -0.25))!);
    expect(b.commit()).toBe(true);
    pullUp(h, ringFace(h), 2.4);
    const plan = expectPlan(analyse(h, sideFace(h)));
    expect(plan.pieces).toHaveLength(4);
    expect(plan.thickness).toBeCloseTo(0.25, 4);
  });
});

describe('flat offset ring', () => {
  it('is accepted and asks for a height', () => {
    const h = host();
    rect(h, 5, 5);
    offsetInward(h, only(h), 0.3);
    const plan = expectPlan(analyse(h, ringFace(h)));
    expect(plan.flat).toBe(true);
    expect(plan.height).toBeNull();
    expect(build(plan, 2.7).every(w => (w.args as number[])[1] === 2.7)).toBe(true);
  });

  it('is not offered from the floor inside it', () => {
    const h = host();
    rect(h, 5, 5);
    offsetInward(h, only(h), 0.3);
    const floor = [...h.graph.faces.entries()].find(([, f]) => f.innerLoops.length === 0)![0];
    expect(analyse(h, floor).ok).toBe(false);
  });
});

describe('rejections', () => {
  it('a plain rectangle with no offset', () => {
    const h = host();
    rect(h, 4, 4);
    const r = analyse(h, only(h));
    expect(r.ok).toBe(false);
    expect((r as WallConversionRejection).reason).toMatch(/Offset/);
    // Not a near miss: no greyed-out menu item on every plain shape.
    expect((r as WallConversionRejection).nearMiss).toBe(false);
  });

  it('a plain extruded box', () => {
    const h = host();
    rect(h, 4, 4);
    pullUp(h, only(h), 2);
    expect(analyse(h, sideFace(h)).ok).toBe(false);
  });

  it('a ring drawn upright (the wrong axis)', () => {
    const h = host();
    outline(h, [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 3, 0), vec3(0, 3, 0)]);
    offsetInward(h, only(h), 0.2);
    const r = analyse(h, ringFace(h));
    expect(r.ok).toBe(false);
    expect((r as WallConversionRejection).reason).toMatch(/flat/);
    expect((r as WallConversionRejection).nearMiss).toBe(true);
  });

  it('a ring whose middle was pulled up too', () => {
    const h = host();
    rect(h, 4, 4);
    offsetInward(h, only(h), 0.2);
    const inner = [...h.graph.faces.entries()].find(([, f]) => f.innerLoops.length === 0)![0];
    pullUp(h, ringFace(h), 2);
    pullUp(h, inner, 2);
    expect(analyse(h, sideFace(h)).ok).toBe(false);
  });
});

describe('near misses', () => {
  it('a window outline drawn on an upright face is not offered at all', () => {
    const h = host();
    outline(h, [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 3, 0), vec3(0, 3, 0)]);
    outline(h, [vec3(1, 1, 0), vec3(2, 1, 0), vec3(2, 2.5, 0), vec3(1, 2.5, 0)]);
    const face = [...h.graph.faces.entries()].find(([, f]) => f.innerLoops.length === 1)![0];
    const r = analyse(h, face) as WallConversionRejection;
    expect(r.ok).toBe(false);
    expect(r.nearMiss).toBe(false);
  });

  it('a ring with its middle filled in is a near miss with a reason', () => {
    const h = host();
    rect(h, 6, 4);
    offsetInward(h, only(h), 0.2);
    pullUp(h, ringFace(h), 2.5);
    // A lid over the middle.
    const floor = [...h.graph.faces.entries()].find(([, f]) =>
      f.innerLoops.length === 0 && Math.abs(f.plane.normal.y) > 0.99 &&
      loopPoints(h.graph, f.outerLoop).every(p => Math.abs(p.y) < 1e-6))![0];
    pullUp(h, floor, 2.5);
    const r = analyse(h, sideFace(h)) as WallConversionRejection;
    expect(r.ok).toBe(false);
    expect(r.nearMiss).toBe(true);
    expect(r.reason.length).toBeGreaterThan(10);
  });
});

describe('curves', () => {
  it('a large circle becomes one wall per segment and reports door-sized pieces', () => {
    const h = host();
    circle(h, 6, 24);
    offsetInward(h, only(h), 0.25);
    pullUp(h, ringFace(h), 3);
    const plan = expectPlan(analyse(h, sideFace(h)));
    expect(plan.pieces).toHaveLength(24);
    expect(plan.pieces.every(p => p.curved)).toBe(true);
    const info = plan.warnings.find(w => w.message.startsWith('Curved section'));
    expect(info?.message).toMatch(/24 can take a door/);
  });

  it('a column-sized circle is flagged as too narrow for openings', () => {
    const h = host();
    circle(h, 0.4, 24);
    offsetInward(h, only(h), 0.1);
    pullUp(h, ringFace(h), 3);
    const plan = expectPlan(analyse(h, sideFace(h)));
    expect(plan.warnings.find(w => w.message.startsWith('Curved section'))?.message).toMatch(/round column/);
  });
});

describe('cleaned offsets', () => {
  it('converts a sharp triangle grown outward, where the offset cut its sharp corner flat', () => {
    const h = host();
    outline(h, [vec3(0, 0, 0), vec3(8, 0, 0), vec3(0, 0, 1.4)]);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    // 0.3 outside the long edge's middle (z = 0 side).
    b.update(b.projectToSessionPlane(vec3(4, 0, -0.3))!);
    expect(b.commit()).toBe(true);
    pullUp(h, ringFace(h), 2.4);
    const plan = expectPlan(analyse(h, sideFace(h)));
    expect(plan.thickness).toBeCloseTo(0.3, 3);
    // Three walls plus a wedge at the cut corner.
    expect(plan.pieces).toHaveLength(4);
  });

  it('converts a ring whose tight notch collapsed when offset inward', () => {
    const h = host();
    // A 6 x 4 block with a 0.2-wide notch cut into its top edge; shrinking by 0.25 closes the notch.
    outline(h, [vec3(0, 0, 0), vec3(6, 0, 0), vec3(6, 0, 4), vec3(3.1, 0, 4), vec3(3.1, 0, 3.5), vec3(2.9, 0, 3.5), vec3(2.9, 0, 4), vec3(0, 0, 4)]);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    b.update(b.projectToSessionPlane(vec3(3, 0, 0.25))!);
    expect(b.commit()).toBe(true);
    pullUp(h, ringFace(h), 2.4);
    const plan = expectPlan(analyse(h, sideFace(h)));
    expect(plan.thickness).toBeCloseTo(0.25, 3);
    expect(plan.pieces).toHaveLength(8);
  });
});

describe('warnings', () => {
  it('flags walls thinner than any real wall', () => {
    const h = host();
    rect(h, 4, 4);
    offsetInward(h, only(h), 0.05);
    const plan = expectPlan(analyse(h, ringFace(h)));
    expect(plan.warnings.some(w => /thinner than any real wall/.test(w.message))).toBe(true);
  });

  it('converts an L-shaped outline to six walls', () => {
    const h = host();
    outline(h, [vec3(0, 0, 0), vec3(6, 0, 0), vec3(6, 0, 3), vec3(3, 0, 3), vec3(3, 0, 6), vec3(0, 0, 6)]);
    offsetInward(h, only(h), 0.2);
    const plan = expectPlan(analyse(h, ringFace(h)));
    expect(plan.pieces).toHaveLength(6);
    expect(plan.thickness).toBeCloseTo(0.2, 4);
  });

  it('height warnings', () => {
    expect(heightWarnings(1.5, 0)[0]?.message).toMatch(/lower than a typical room/);
    expect(heightWarnings(5, 0)[0]?.message).toMatch(/taller than a typical storey/);
    expect(heightWarnings(2.4, 0)).toEqual([]);
  });
});

describe('cleanPolygon', () => {
  it('merges a point sitting on a straight edge and winds counter-clockwise', () => {
    const cleaned = cleanPolygon([{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 2 }, { x: 4, z: 0 }]);
    expect(cleaned).toHaveLength(4);
    let area = 0;
    for (let i = 0; i < cleaned.length; i++) {
      const a = cleaned[i]!, b = cleaned[(i + 1) % cleaned.length]!;
      area += a.x * b.z - b.x * a.z;
    }
    expect(area).toBeGreaterThan(0);
  });
});

describe('undo', () => {
  const convert = () => {
    const h = host();
    rect(h, 6, 4);
    offsetInward(h, only(h), 0.2);
    pullUp(h, ringFace(h), 2.5);
    const plan = expectPlan(analyse(h, sideFace(h)));
    const before = snapshot(h.graph);
    const removed = captureFaces(h.graph, plan.sourceFaces);
    deleteGroupFacesAndEdges(h.graph, plan.sourceFaces);
    h.refreshIndex();
    const link: WallConversionUndoLink = {
      wallIds: ['w'], before, after: snapshot(h.graph),
      beforeSig: graphSignature(before.graph), afterSig: graphSignature(h.graph), removed,
    };
    return { h, plan, link, faceCount: before.graph.faces.size };
  };

  it('restores the exact source when nothing else changed, and redo removes it', () => {
    const { h, link, faceCount } = convert();
    expect(h.graph.faces.size).toBe(1); // just the floor
    undoWallConversion(h, link);
    expect(h.graph.faces.size).toBe(faceCount);
    redoWallConversion(h, link);
    expect(h.graph.faces.size).toBe(1);
  });

  it('redraws the source without wiping geometry drawn since', () => {
    const { h, link, plan } = convert();
    outline(h, [vec3(20, 0, 0), vec3(22, 0, 0), vec3(22, 0, 2), vec3(20, 0, 2)]);
    const withNew = h.graph.faces.size;
    undoWallConversion(h, link);
    expect(h.graph.faces.size).toBe(withNew + plan.sourceFaces.length);
    // The redrawn solid converts again, the same as the original.
    const again = expectPlan(analyse(h, sideFace(h)));
    expect(again.pieces).toHaveLength(4);
    redoWallConversion(h, link);
    expect(h.graph.faces.size).toBe(withNew);
  });
});

describe('changing the thickness', () => {
  /** A 4 m square of 200 mm walls, outside face on x/z = ±2, as the analysis would plan it. */
  const square = (): WallConversionPlan => {
    const o = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }];
    const t = 0.2;
    const inner = [{ x: -1.8, z: -1.8 }, { x: 1.8, z: -1.8 }, { x: 1.8, z: 1.8 }, { x: -1.8, z: 1.8 }];
    const outs = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];
    return {
      ok: true, sourceFaces: [], flat: true, baseY: 0, height: null, thickness: t, color: null, warnings: [],
      pieces: o.map((a, i) => {
        const b = o[(i + 1) % 4]!, ia = inner[i]!, ib = inner[(i + 1) % 4]!;
        const start = { x: (a.x + ia.x) / 2, z: (a.z + ia.z) / 2 }, end = { x: (b.x + ib.x) / 2, z: (b.z + ib.z) / 2 };
        return { start, end, outward: outs[i]!, corners: [a, ia, ib, b], length: Math.hypot(end.x - start.x, end.z - start.z), curved: false };
      }),
    };
  };

  it('keeps the outside face and moves the inside face in', () => {
    const r = planWithThickness(square(), 0.35);
    expect(r.ok).toBe(true);
    const plan = r as WallConversionPlan;
    expect(plan.thickness).toBe(0.35);
    expect(outerRing(plan)).toEqual(outerRing(square()));
    const inner = plan.pieces.map(p => p.corners[1]);
    for (const p of inner) {
      expect(Math.abs(p.x)).toBeCloseTo(1.65);
      expect(Math.abs(p.z)).toBeCloseTo(1.65);
    }
    // The centreline is midway through the new thickness.
    expect(Math.abs(plan.pieces[0]!.start.z)).toBeCloseTo(2 - 0.175);
    const walls = buildWallShapes(plan, { height: 2.4, color: '#fff', story: 1, makeId: () => 'x', existingWallCount: 0 });
    expect((walls[0]!.args as number[])[2]).toBe(0.35);
  });

  it('refuses a thickness that would make the inside faces cross', () => {
    const r = planWithThickness(square(), 2.5);
    expect(r.ok).toBe(false);
    expect((r as WallConversionRejection).reason).toMatch(/too thick/);
  });

  it('swaps the thickness warnings', () => {
    const r = planWithThickness(square(), 0.06) as WallConversionPlan;
    expect(r.warnings.some(w => /thinner than any real wall/.test(w.message))).toBe(true);
  });
});
