import { describe, expect, it } from 'vitest';
import { createInteriorFurnitureShape } from './parametricFurniture';
import { bakeSemanticSimulation } from './bakeSimulation';

describe('bakeable furniture simulation', () => {
  it('settles a sofa soft body into deterministic saved geometry', () => {
    const sofa = createInteriorFurnitureShape('sofa', { id: 'sofa' });
    const before = [...sofa.geometryData.positions];
    const baked = bakeSemanticSimulation(sofa, 0.5);
    expect(baked.geometryData.positions).not.toEqual(before);
    expect(baked.customData.simulationBake).toMatchObject({ type: 'softbody', strength: 0.5 });
    expect(baked.geometryData.normals.length).toBe(baked.geometryData.positions.length);
    expect(sofa.geometryData.positions).toEqual(before);
  });

  it('adds settled drape variation to curtains', () => {
    const curtain = createInteriorFurnitureShape('curtain');
    const baked = bakeSemanticSimulation(curtain, 0.4);
    expect(baked.customData.simulationBake.type).toBe('cloth');
    expect(baked.geometryData.positions).not.toEqual(curtain.geometryData.positions);
  });

  it('rejects rigid furniture without a bakeable simulation profile', () => {
    const cabinet = createInteriorFurnitureShape('cabinet');
    expect(() => bakeSemanticSimulation(cabinet)).toThrow(/bakeable/);
  });
  it('keeps bed frames rigid while relaxing upholstery patches', () => {
    const bed=createInteriorFurnitureShape('bed');
    const baked=bakeSemanticSimulation(bed,.8);
    for(const group of bed.customData.furnitureMaterialGroups) if(group.materialIndex===0) {
      const start=group.start*3, end=(group.start+group.count)*3;
      expect(baked.geometryData.positions.slice(start,end)).toEqual(bed.geometryData.positions.slice(start,end));
    }
    expect(baked.geometryData.positions).not.toEqual(bed.geometryData.positions);
  });

});
