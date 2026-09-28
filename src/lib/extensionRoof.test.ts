import { describe, expect, it } from 'vitest';
import { extensionRoofModel } from './extensionRoof';
import { facePlan, roofHeightAt, type RoofModel } from './roofSkeleton';
import { frameSkeletonRoof } from './roofFraming';
import type { V2 } from './roofSurface';

/** A house wall along z = 8 (centre line), 0.25 m thick; extensions stick out to +z. */
const abut = { a: [-20, 8] as V2, b: [20, 8] as V2 };
const opts = { overhang: 0.4, wallThickness: 0.25 };
const kinds = (m: RoofModel) => m.edges.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {});
const area = (p: V2[]) => Math.abs(p.reduce((s, q, i) => s + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2;

describe('extension roofs', () => {
  it('lean-to over a wide rear extension: one slope up to the house wall, verges at the sides', () => {
    const wall: V2[] = [[0, 8], [10, 8], [10, 12], [0, 12]];
    const m = extensionRoofModel(wall, abut, { ...opts, kind: 'lean-to', ridgeHeight: 1.2 })!;
    expect(m).toBeTruthy();
    expect(m.faces.filter(f => !f.gable)).toHaveLength(1);
    expect(m.faces.filter(f => f.gable)).toHaveLength(2);
    expect(kinds(m).wall).toBe(1);
    expect(m.ridgeHeight).toBeCloseTo(1.2);
    // It stops at the house wall's outer face, overhangs 0.4 m elsewhere, and rises towards the house.
    expect(Math.min(...m.eave.map(p => p[1]))).toBeCloseTo(8.125);
    expect(Math.max(...m.eave.map(p => p[1]))).toBeCloseTo(12.4);
    expect(Math.min(...m.eave.map(p => p[0]))).toBeCloseTo(-0.4);
    expect(roofHeightAt(m, 5, 8.2)!).toBeGreaterThan(roofHeightAt(m, 5, 12)!);
    expect(roofHeightAt(m, 5, 12.4)).toBeCloseTo(0, 5);
    // Covers the roof outline exactly once.
    const covered = m.faces.filter(f => !f.gable).reduce((s, f) => s + area(facePlan(m, f)), 0);
    expect(covered).toBeCloseTo(area(m.eave), 4);
  });

  it('lean-to stays a lean-to on a narrow deep extension (no ridge turning to run away from the house)', () => {
    const wall: V2[] = [[2, 8], [5, 8], [5, 14], [2, 14]];
    const m = extensionRoofModel(wall, abut, { ...opts, kind: 'lean-to', pitchDeg: 20 })!;
    expect(m.faces.filter(f => !f.gable)).toHaveLength(1);
    expect(kinds(m).ridge ?? 0).toBe(0);
    expect(Math.tan(m.pitch)).toBeCloseTo(Math.tan((20 * Math.PI) / 180));
  });

  it('lean-to round a canted bay: three slopes meeting at hips, all rising to the house', () => {
    const wall: V2[] = [[0, 8], [8, 8], [8, 10], [6, 12], [2, 12], [0, 10]];
    const m = extensionRoofModel(wall, abut, { ...opts, kind: 'lean-to', ridgeHeight: 1.5 })!;
    expect(m.faces.filter(f => !f.gable)).toHaveLength(3);
    expect(kinds(m).hip).toBe(2);
    const covered = m.faces.filter(f => !f.gable).reduce((s, f) => s + area(facePlan(m, f)), 0);
    expect(covered).toBeCloseTo(area(m.eave), 3);
  });

  it('pitched: a gable-fronted extension whose ridge runs back into the house wall', () => {
    const wall: V2[] = [[2, 8], [7, 8], [7, 14], [2, 14]];
    const m = extensionRoofModel(wall, abut, { ...opts, kind: 'pitched', pitchDeg: 40 })!;
    expect(m).toBeTruthy();
    expect(m.faces.filter(f => f.gable)).toHaveLength(1);
    const ridge = m.edges.find(e => e.kind === 'ridge')!;
    expect(ridge).toBeTruthy();
    // The ridge runs away from the house (along z) at the middle of the extension.
    expect(Math.abs(m.nodes[ridge.a][0] - 4.5)).toBeLessThan(1e-6);
    expect(Math.abs(m.nodes[ridge.a][2] - m.nodes[ridge.b][2])).toBeGreaterThan(5);
    expect(kinds(m).wall).toBe(2);
  });

  it('frames a lean-to: rafters from eave to a ledger on the house wall, no ties needed', () => {
    const wall: V2[] = [[0, 8], [10, 8], [10, 12], [0, 12]];
    const m = extensionRoofModel(wall, abut, { ...opts, kind: 'lean-to', ridgeHeight: 1.2 })!;
    const f = frameSkeletonRoof(m);
    expect(f.members.filter(x => x.subTag === 'timber-common-rafter').length).toBeGreaterThan(20);
    expect(f.members.filter(x => x.name.startsWith('Wall Plate (Ledger)'))).toHaveLength(1);
    expect(f.members.filter(x => x.subTag === 'timber-ceiling-joist')).toHaveLength(0);
    expect(f.warnings).toEqual([]);
  });

  it('turns down outlines it cannot roof this way', () => {
    // Not touching the house wall at all.
    expect(extensionRoofModel([[0, 10], [4, 10], [4, 14], [0, 14]], abut, { ...opts, kind: 'lean-to' })).toBeNull();
  });
});
