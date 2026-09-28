import { beforeAll, describe, expect, it } from 'vitest';
import { buildRoofModel, initRoofSkeleton, roofHeightAt, type RoofModel } from './roofSkeleton';
import { frameSkeletonRoof, type RoofMember } from './roofFraming';
import { offsetPolygon2D } from './archRoofGenerator';
import type { V2 } from './roofSurface';

/** A roof over walls (their centre lines), with a 0.4 m eave overhang. */
const roof = (wall: V2[], gable: boolean, pitchDeg = 40): RoofModel =>
  buildRoofModel(offsetPolygon2D(wall, 0.4), wall, { gable, pitchDeg })!;
const box = (w: number, d: number): V2[] => [[0, 0], [w, 0], [w, d], [0, d]];
const L: V2[] = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];
const T: V2[] = [[0, 0], [12, 0], [12, 5], [8.5, 5], [8.5, 11], [3.5, 11], [3.5, 5], [0, 5]];
const round = (n = 48, r = 5): V2[] => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);

const of = (f: { members: RoofMember[] }, tag: string) => f.members.filter(m => m.subTag === tag);
const rafters = (f: { members: RoofMember[] }) => f.members.filter(m => /common-rafter|jack-rafter/.test(m.subTag));

/** Plan segments cross (not just touching at an end). */
function crosses(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
}

/** Sound framing: every rafter lies on the roof, inside it, and never cuts across a hip or valley. */
function expectSound(m: RoofModel, f: ReturnType<typeof frameSkeletonRoof>) {
  const lines = m.edges.filter(e => e.kind === 'hip' || e.kind === 'valley').map(e => [m.nodes[e.a], m.nodes[e.b]]);
  for (const r of rafters(f)) {
    for (const p of [r.a.clone().lerp(r.b, 0.02), r.b.clone().lerp(r.a, 0.02), r.a.clone().lerp(r.b, 0.5)]) {
      // (A point exactly on a hip or crease is on two faces' edges: nudge until one claims it.)
      const h = [[0, 0], [1e-4, 0], [-1e-4, 0], [0, 1e-4], [0, -1e-4]].map(([dx, dz]) => roofHeightAt(m, p.x + dx, p.z + dz)).find(v => v !== null) ?? null;
      expect(h).not.toBeNull();
      expect(Math.abs(p.y - h!)).toBeLessThan(0.02);
    }
    for (const [A, B] of lines) {
      expect(crosses([r.a.x, r.a.z], [r.b.x, r.b.z], [A[0], A[2]], [B[0], B[2]])).toBe(false);
    }
  }
}

beforeAll(() => initRoofSkeleton());

describe('framing skeleton roofs', () => {
  it('frames a gable box: commons eave to ridge in pairs, tied at the plate and collared', () => {
    const m = roof(box(8, 5), true);
    const f = frameSkeletonRoof(m);
    expectSound(m, f);
    expect(of(f, 'timber-ridge-beam')).toHaveLength(1);
    expect(of(f, 'timber-rake-rafter')).toHaveLength(4);
    expect(of(f, 'timber-hip-rafter')).toHaveLength(0);
    const commons = of(f, 'timber-common-rafter');
    // Every 400 mm along 8.8 m of eave, on both slopes.
    expect(commons.length).toBeGreaterThanOrEqual(40);
    // Each pair across the ridge has a ceiling joist wall to wall and a collar.
    const joists = of(f, 'timber-ceiling-joist');
    expect(joists.length).toBe(commons.length / 2);
    for (const j of joists) expect(j.a.distanceTo(j.b)).toBeCloseTo(5, 1);
    expect(of(f, 'timber-collar-tie').length).toBe(joists.length);
    expect(of(f, 'timber-roof-noggin').length).toBeGreaterThan(30);
    // 2.5 m at 40° is 3.3 m along the slope: 150 mm rafters, no purlins, 5 m joists fine, no warnings.
    expect(f.purlinRows).toBe(0);
    expect(f.sizes.rafter[1]).toBeCloseTo(0.15);
    expect(f.warnings).toEqual([]);
  });

  it('frames a hip box with hips and jacks, and no rafter crossing a hip', () => {
    const m = roof(box(10, 7), false);
    const f = frameSkeletonRoof(m);
    expectSound(m, f);
    expect(of(f, 'timber-hip-rafter')).toHaveLength(4);
    expect(of(f, 'timber-ridge-beam')).toHaveLength(1);
    expect(of(f, 'timber-hip-jack-rafter').length).toBeGreaterThan(20);
    expect(of(f, 'timber-hip-rafter')[0].depth).toBeGreaterThan(f.sizes.rafter[1]);
  });

  it('frames L and T plans with valleys and valley jacks', () => {
    for (const [plan, gable] of [[L, true], [L, false], [T, true], [T, false]] as const) {
      const m = roof(plan, gable);
      const f = frameSkeletonRoof(m);
      expectSound(m, f);
      expect(of(f, 'timber-valley-rafter').length).toBe(plan === L ? 1 : 2);
      expect(of(f, 'timber-valley-jack-rafter').length).toBeGreaterThan(4);
      expect(of(f, 'timber-valley-rafter')[0].width).toBeCloseTo(0.075);
    }
  });

  it('adds purlins and struts when the slopes are too long, and says so', () => {
    const m = roof(box(14, 11), true);
    const f = frameSkeletonRoof(m);
    expectSound(m, f);
    // 5.5 m at 40° is about 7.2 m along the slope: one purlin row halves it.
    expect(f.purlinRows).toBe(1);
    expect(f.rafterSpan).toBeLessThan(4.7);
    expect(of(f, 'timber-roof-purlin')).toHaveLength(2);
    expect(of(f, 'timber-roof-strut').length).toBeGreaterThanOrEqual(10);
    expect(f.warnings.join(' ')).toMatch(/purlin/i);
    // 11 m of ceiling joist between the walls needs a wall or binder part way.
    expect(f.warnings.join(' ')).toMatch(/binder/i);
  });

  it('frames a round roof with a radial rafter on every facet line', () => {
    const m = roof(round(), false);
    const f = frameSkeletonRoof(m);
    expectSound(m, f);
    expect(f.members.filter(x => x.name === 'Radial Rafter').length).toBeGreaterThanOrEqual(46);
    expect(of(f, 'timber-hip-rafter')).toHaveLength(0);
    // A ring beam round the wall head, a boss where the radials meet, and the rafters between
    // radials stopping on a ring of trimmers well short of the centre.
    expect(of(f, 'timber-wall-plate')).toHaveLength(48);
    expect(of(f, 'timber-roof-boss')).toHaveLength(1);
    expect(of(f, 'timber-trimmer-rafter').length).toBeGreaterThan(20);
    for (const r of of(f, 'timber-common-rafter').filter(x => x.name === 'Common Rafter')) {
      expect(Math.min(Math.hypot(r.a.x, r.a.z), Math.hypot(r.b.x, r.b.z))).toBeGreaterThan(1.5);
    }
    expect(f.warnings.join(' ')).toMatch(/ring beam/);
  });

  it('sizes rafters closer together for wider spacing', () => {
    const m = roof(box(6, 5), true);
    expect(frameSkeletonRoof(m, { spacing: 0.6 }).sizes.rafter[1]).toBeGreaterThan(frameSkeletonRoof(m, { spacing: 0.4 }).sizes.rafter[1]);
  });
});
