import { beforeAll, describe, expect, it } from 'vitest';
import { buildRoofModel, initRoofSkeleton, roofHeightAt, facePlan, type RoofModel } from './roofSkeleton';
import type { V2 } from './roofSurface';

const L: V2[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 8], [0, 8]];
const U: V2[] = [[0, 0], [12, 0], [12, 9], [8, 9], [8, 4], [4, 4], [4, 9], [0, 9]];
const T: V2[] = [[0, 0], [12, 0], [12, 4], [8, 4], [8, 10], [4, 10], [4, 4], [0, 4]];
const circle = (n = 48, r = 5): V2[] => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);
const model = (p: V2[], opts = {}) => buildRoofModel(p, p, { pitchDeg: 40, ...opts })!;
const kinds = (m: RoofModel) => m.edges.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {});

/** The roof is one surface: every face at the pitch, no two faces overlapping in plan, and together they cover the outline. */
function expectSound(m: RoofModel, outline: V2[]) {
  const tan = Math.tan(m.pitch);
  let area = 0;
  for (const f of m.faces) {
    const plan = facePlan(m, f);
    let a = 0;
    for (let i = 0; i < plan.length; i++) { const [x1, z1] = plan[i], [x2, z2] = plan[(i + 1) % plan.length]; a += x1 * z2 - x2 * z1; }
    if (f.gable) expect(Math.abs(a / 2)).toBeLessThan(1e-6);
    else expect(a / 2).toBeGreaterThan(-1e-9); // counter-clockwise, never folded over
    area += a / 2;
    // Each node of a sloped face sits on that face's plane.
    if (!f.gable) {
      for (const v of f.verts) {
        const [x, y, z] = m.nodes[v];
        const e0 = m.eave[f.edge], e1 = m.eave[(f.edge + 1) % m.eave.length];
        const len = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
        const d = ((x - e0[0]) * -(e1[1] - e0[1]) + (z - e0[1]) * (e1[0] - e0[0])) / len;
        expect(y).toBeCloseTo(d * tan, 4);
      }
    }
  }
  let outlineArea = 0;
  for (let i = 0; i < outline.length; i++) { const [x1, z1] = outline[i], [x2, z2] = outline[(i + 1) % outline.length]; outlineArea += x1 * z2 - x2 * z1; }
  expect(area).toBeCloseTo(Math.abs(outlineArea) / 2, 3);
}

beforeAll(() => initRoofSkeleton());

describe('roof skeleton', () => {
  it('hips an L: two hips per wing end, one valley, ridges meeting at the corner', () => {
    const m = model(L);
    expectSound(m, L);
    expect(kinds(m)).toEqual({ hip: 5, valley: 1, ridge: 2 });
    expect(m.ridgeHeight).toBeCloseTo(2 * Math.tan((40 * Math.PI) / 180), 5);
  });

  it('gables an L: both wing ends stand up, the valley stays', () => {
    const m = model(L, { gable: true });
    expectSound(m, L);
    expect(m.faces.filter(f => f.gable)).toHaveLength(2);
    expect(kinds(m)).toEqual({ rake: 4, hip: 1, valley: 1, ridge: 2 });
    // The gable top sits on the end wall's line, at ridge height.
    const end = m.faces.find(f => f.gable && f.edge === 1)!;
    const top = m.nodes[end.verts[1]];
    expect(top[0]).toBeCloseTo(10);
    expect(top[1]).toBeCloseTo(m.ridgeHeight);
  });

  it('handles T and U plans', () => {
    for (const p of [T, U]) {
      const hip = model(p);
      expectSound(hip, p);
      const gable = model(p, { gable: true });
      expectSound(gable, p);
      expect(gable.faces.filter(f => f.gable).length).toBe(p === T ? 3 : 2);
    }
  });

  it('works for clockwise outlines and straight-through corners', () => {
    const withMid: V2[] = [[0, 0], [5, 0], [10, 0], [10, 8], [0, 8]];
    const m = model([...withMid].reverse());
    expect(m.eave).toHaveLength(4);
    expectSound(m, withMid);
  });

  it('roofs a round building (a perfect circle needs the nudge)', () => {
    const p = circle();
    const m = model(p);
    expectSound(m, p);
    expect(m.ridgeHeight).toBeCloseTo(5 * Math.cos(Math.PI / 48) * Math.tan((40 * Math.PI) / 180), 2);
    expect(roofHeightAt(m, 0, 0)).toBeCloseTo(m.ridgeHeight, 2);
    expect(roofHeightAt(m, 20, 0)).toBeNull();
  });

  it('gables rectangles and squares with the ridge along the longer side (along x for a square)', () => {
    const rect: V2[] = [[0, 0], [6, 0], [6, 10], [0, 10]];
    const r = model(rect, { gable: true });
    expectSound(r, rect);
    expect(r.faces.filter(f => f.gable).map(f => f.edge)).toEqual([0, 2]);
    expect(kinds(r)).toEqual({ rake: 4, ridge: 1 });
    const sq: V2[] = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const s = model(sq, { gable: true });
    expectSound(s, sq);
    expect(s.faces.filter(f => f.gable).map(f => f.edge)).toEqual([1, 3]);
    expect(kinds(s)).toEqual({ rake: 4, ridge: 1 });
    const ridge = s.edges.find(e => e.kind === 'ridge')!;
    expect(Math.abs(s.nodes[ridge.a][2] - 4)).toBeLessThan(1e-9);
    expect(Math.abs(s.nodes[ridge.a][0] - s.nodes[ridge.b][0])).toBeCloseTo(8);
    expect(kinds(model(sq))).toEqual({ hip: 4 });
  });

  it('gables a slightly skewed hand-drawn box, keeping both side slopes flat', () => {
    const skew: V2[] = [[0, 0], [10, 0], [10.1, 8.2], [0, 8]];
    const m = model(skew, { gable: true });
    expectSound(m, skew);
    expect(m.faces.filter(f => f.gable)).toHaveLength(2);
    expect(kinds(m).ridge).toBe(1);
  });

  it('takes a ridge height instead of a pitch', () => {
    const m = buildRoofModel(L, L, { ridgeHeight: 3 })!;
    expect(m.ridgeHeight).toBeCloseTo(3);
    expect(Math.tan(m.pitch)).toBeCloseTo(1.5);
  });
});
