import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { applyBoolean, planBoolean, type BooleanPlan, type BooleanRejection } from './kernelBoolean';
import { groupContaining, faceArea } from './kernelSelection';
import { createPushPullBinding } from './kernelPushPull';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, loopPoints } from '../lib/geometry/topology';
import type { FaceId, Vec3 } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });
/** A flat shape drawn the way the shape tools draw them (isolated). */
const draw = (h: KernelArcHost, pts: Vec3[]): FaceId[] => h.commitIsolatedRing(pts).faces as FaceId[];
const rect = (h: KernelArcHost, x0: number, z0: number, x1: number, z1: number) =>
  draw(h, [vec3(x0, 0, z0), vec3(x1, 0, z0), vec3(x1, 0, z1), vec3(x0, 0, z1)]);
const ctx = (h: KernelArcHost) => ({ graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex });

/** The current face of a shape, found by a point inside it (drawing can re-derive faces). */
const at = (h: KernelArcHost, x: number, z: number): FaceId[] => {
  let best: FaceId | null = null, bestArea = Infinity;
  for (const [id, f] of h.graph.faces) {
    const pts = loopPoints(h.graph, f.outerLoop);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]!, b = pts[j]!;
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    const area = faceArea(h.graph, id);
    if (inside && area < bestArea) { best = id; bestArea = area; }
  }
  return best === null ? [] : [best];
};

const run = (h: KernelArcHost, shapes: FaceId[][], op: 'merge' | 'subtract' | 'intersect') => {
  const plan = planBoolean(h.graph, shapes.map(s => groupContaining(h.graph, s[0]!)), op);
  if (!plan.ok) return { plan, faces: [] as FaceId[] };
  let faces: FaceId[] = [];
  h.transact(() => { faces = applyBoolean(ctx(h), plan as BooleanPlan, h.deriveOptions); return true; });
  return { plan, faces };
};

const totalArea = (h: KernelArcHost, faces: FaceId[]) => faces.reduce((s, f) => s + faceArea(h.graph, f), 0);

describe('merge, subtract, intersect', () => {
  it('merges two overlapping rectangles into one shape', () => {
    const h = host();
    const a = rect(h, 0, 0, 4, 2), b = rect(h, 2, 0, 6, 2);
    expect(h.graph.faces.size).toBe(2); // drawn isolated: they do not split each other
    const { faces } = run(h, [a, b], 'merge');
    expect(faces).toHaveLength(1);
    expect(h.graph.faces.size).toBe(1);
    expect(totalArea(h, faces)).toBeCloseTo(12, 6);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('merges shapes that only touch along an edge', () => {
    const h = host();
    const a = rect(h, 0, 0, 2, 2), b = rect(h, 2, 0, 4, 2);
    const { faces } = run(h, [a, b], 'merge');
    expect(totalArea(h, faces)).toBeCloseTo(8, 6);
    expect(faces).toHaveLength(1);
  });

  it('refuses to merge shapes that are apart', () => {
    const h = host();
    const a = rect(h, 0, 0, 2, 2), b = rect(h, 5, 0, 7, 2);
    const { plan } = run(h, [a, b], 'merge');
    expect(plan.ok).toBe(false);
    expect((plan as BooleanRejection).reason).toMatch(/do not overlap or touch/);
    expect(h.graph.faces.size).toBe(2);
  });

  it('subtracts later shapes from the first, which keeps its material', () => {
    const h = host();
    const a = rect(h, 0, 0, 4, 4), b = rect(h, 3, 3, 6, 6);
    h.graph.faces.get(a[0]!)!.attributes.materialFront = '#ff0000';
    const { faces } = run(h, [a, b], 'subtract');
    expect(totalArea(h, faces)).toBeCloseTo(16 - 1, 6);
    expect(h.graph.faces.get(faces[0]!)!.attributes.materialFront).toBe('#ff0000');
  });

  it('cuts a hole when the cutter is fully inside, without filling the hole', () => {
    const h = host();
    rect(h, 0, 0, 6, 6); rect(h, 2, 2, 4, 4);
    const { faces } = run(h, [at(h, 1, 1), at(h, 3, 3)], 'subtract');
    expect(faces).toHaveLength(1);
    expect(h.graph.faces.size).toBe(1);
    expect(h.graph.faces.get(faces[0]!)!.innerLoops).toHaveLength(1);
    expect(totalArea(h, faces)).toBeCloseTo(32, 6);
  });

  it('keeps only the overlap when intersecting', () => {
    const h = host();
    const a = rect(h, 0, 0, 4, 4), b = rect(h, 2, 2, 6, 6);
    const { faces } = run(h, [a, b], 'intersect');
    expect(totalArea(h, faces)).toBeCloseTo(4, 6);
  });

  it('merges a circle and a rectangle', () => {
    const h = host();
    const circle = draw(h, Array.from({ length: 32 }, (_, i) => vec3(4 + Math.cos(2 * Math.PI * i / 32), 0, 1 + Math.sin(2 * Math.PI * i / 32))));
    rect(h, 0, 0, 4, 2);
    void circle;
    const { faces } = run(h, [at(h, 1, 1), at(h, 4.8, 1)], 'merge');
    expect(faces).toHaveLength(1);
    // Rectangle plus the half of the circle outside it.
    const halfCircle = 0.5 * 32 * 0.5 * Math.sin(2 * Math.PI / 32);
    expect(totalArea(h, faces)).toBeCloseTo(8 + halfCircle, 3);
  });

  it('refuses a pulled-up shape', () => {
    const h = host();
    const a = rect(h, 0, 0, 2, 2), b = rect(h, 1, 0, 3, 2);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(a[0]!, vec3(1, 0, 1));
    pp.update({ origin: vec3(10, 1, 1), direction: vec3(-1, 0, 0) });
    pp.commit();
    const top = [...h.graph.faces.entries()].find(([, f]) => loopPoints(h.graph, f.outerLoop).every(p => Math.abs(p.y - 1) < 1e-6))![0];
    const { plan } = run(h, [[top], b], 'merge');
    expect(plan.ok).toBe(false);
  });

  it('is one undo step', () => {
    const h = host();
    const a = rect(h, 0, 0, 4, 2), b = rect(h, 2, 0, 6, 2);
    run(h, [a, b], 'merge');
    expect(h.graph.faces.size).toBe(1);
    h.undo();
    expect(h.graph.faces.size).toBe(2);
  });
});
