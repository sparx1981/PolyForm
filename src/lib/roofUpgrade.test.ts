import { describe, expect, it } from 'vitest';
import type { Shape } from '../types';
import { buildRoofAssemblyForRoom } from './archRoofGenerator';
import { withRoofExtras } from './roofExtras';
import { roofsToUpgrade, upgradeRoofs } from './roofUpgrade';

const wall = (id: string, x: number, z: number, len: number, rotY: number): Shape => ({
  id, type: 'wall', name: 'Room Wall', position: [x, 1.4, z], rotation: [0, rotY, 0], args: [len, 2.8, 0.25], color: '#eee',
});

describe('rebuilding older roofs when a model opens', () => {
  it('rebuilds a roof made before skeleton roofs, keeping its settings and extras, once', () => {
    const w = [wall('n', 0, -4, 10.25, 0), wall('s', 0, 4, 10.25, 0), wall('e', 5, 0, 8.25, Math.PI / 2), wall('w', -5, 0, 8.25, Math.PI / 2)];
    const a = buildRoofAssemblyForRoom(w, { roofType: 'hip', pitchAngleDeg: 35, usePitchAngle: true, eaveOverhang: 0.4, tileShape: 'roman' } as any, w)!;
    let shapes = withRoofExtras([...w, ...a.allShapes], a.roofShape.id, { gutters: true });
    // As an older model would have saved it.
    shapes = shapes.map(s => s.id === a.roofShape.id
      ? { ...s, geometryData: { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], normals: [] }, roofData: { ...s.roofData, skeleton: undefined, buildVersion: undefined } }
      : s);
    expect(roofsToUpgrade(shapes)).toHaveLength(1);

    const up = upgradeRoofs(shapes);
    const roof = up.find(s => s.id === a.roofShape.id)!;
    expect(roof.roofData.buildVersion).toBe(2);
    expect(roof.roofData.skeleton.faces).toHaveLength(4);
    expect(roof.geometryData.positions.length).toBeGreaterThan(9);
    expect(roof.roofData.eaveOverhang).toBeCloseTo(0.4);
    expect(roof.roofData.extras.gutters).toBe(true);
    expect(up.some(s => s.tags?.includes('roof-extra-gutters'))).toBe(true);
    expect(up.find(s => s.tags?.includes('roof-tiles'))!.geometryData.positions.length).toBeGreaterThan(0);

    // Nothing left to do the second time.
    expect(roofsToUpgrade(up)).toHaveLength(0);
    expect(upgradeRoofs(up)).toBe(up);
  });
});
