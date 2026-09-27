import { describe, expect, it } from 'vitest';
import type { Shape } from '../types';
import { buildRoofAssemblyForRoom } from './archRoofGenerator';
import { withRoofExtras, refreshRoofExtras, isRoofExtra } from './roofExtras';

const wall = (id: string, x: number, z: number, len: number, rotY: number): Shape => ({
  id, type: 'wall', name: 'Room Wall', position: [x, 1.4, z], rotation: [0, rotY, 0], args: [len, 2.8, 0.25], color: '#eee',
});
/** A 10 × 8 m box of walls. */
const walls = () => [
  wall('n', 0, -4, 10.25, 0), wall('s', 0, 4, 10.25, 0), wall('e', 5, 0, 8.25, Math.PI / 2), wall('w', -5, 0, 8.25, Math.PI / 2),
];

function roofed(roofType: 'hip' | 'gable') {
  const w = walls();
  const assembly = buildRoofAssemblyForRoom(w, { roofType, pitchAngleDeg: 35, usePitchAngle: true, eaveOverhang: 0.4, color: '#7c2d12', tileShape: 'none' } as any, w)!;
  return { shapes: [...w, ...assembly.allShapes], roofId: assembly.roofShape.id, roof: assembly.roofShape };
}

const extra = (shapes: Shape[], kind: string) => shapes.find(s => s.tags?.includes(`roof-extra-${kind}`));
const heights = (s: Shape) => {
  const p = s.geometryData.positions as number[];
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
  return { lo, hi };
};

describe('roof extras', () => {
  it('fits gutters, a chimney, solar panels and dormers to a hip roof', () => {
    const { shapes, roofId, roof } = roofed('hip');
    const out = withRoofExtras(shapes, roofId, { gutters: true, chimney: true, chimneyX: 0.3, chimneyZ: 0, solar: true, solarFacing: 'south', dormers: 1, dormerFacing: 'north' });
    const gutters = extra(out, 'gutters')!;
    // All four eaves of a hip roof get a gutter: about the eave perimeter (10.25+0.8)*2 + (8.25+0.8)*2.
    expect(gutters.customData.length).toBeGreaterThan(38);
    expect(gutters.customData.downpipes).toBe(4);
    // Downpipes reach the ground (the roof sits on 2.8 m walls).
    expect(heights(gutters).lo).toBeLessThan(-2.7);

    const ridge = roof.roofData.ridgeHeight as number;
    expect(heights(extra(out, 'chimney')!).hi).toBeGreaterThan(ridge * 0.5);

    const solar = extra(out, 'solar')!;
    expect(solar.customData.count).toBeGreaterThan(4);
    // Panels on the south (+z) slope.
    const p = solar.geometryData.positions as number[];
    let zSum = 0;
    for (let i = 2; i < p.length; i += 3) zSum += p[i];
    expect(zSum / (p.length / 3)).toBeGreaterThan(0.5);

    expect(extra(out, 'dormer-walls')!.customData.count).toBe(1);
    expect(extra(out, 'dormer-lining')).toBeTruthy();
    expect(extra(out, 'dormer-roofs')).toBeTruthy();
    expect(extra(out, 'dormer-glass')!.opacity).toBeLessThan(1);

    // The settings are saved on the roof, and the extras are its children.
    expect(out.find(s => s.id === roofId)!.roofData.extras.solar).toBe(true);
    expect(out.filter(isRoofExtra).every(s => s.parentShapeId === roofId)).toBe(true);
  });

  it('skips gable ends and rebuilds without duplicates', () => {
    const { shapes, roofId } = roofed('gable');
    const once = withRoofExtras(shapes, roofId, { gutters: true, solar: true });
    const gutters = extra(once, 'gutters')!;
    // Only the two long eaves (about 11 m each), not the gable ends.
    expect(gutters.customData.length).toBeGreaterThan(20);
    expect(gutters.customData.length).toBeLessThan(24);
    const again = refreshRoofExtras(once, roofId);
    expect(again.filter(isRoofExtra)).toHaveLength(once.filter(isRoofExtra).length);
    const off = withRoofExtras(once, roofId, {});
    expect(off.filter(isRoofExtra)).toHaveLength(0);
  });
});
