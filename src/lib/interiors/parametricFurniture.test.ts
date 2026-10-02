import { describe, expect, it } from 'vitest';
import { createInteriorFurnitureGeometry, createInteriorFurnitureShape, interiorFurnitureCatalog } from './parametricFurniture';
import { billOfMaterials } from '../presentation/bom';

describe('parametric interior furniture', () => {
  it('ships primary furniture and supporting room pieces', () => {
    expect(interiorFurnitureCatalog().map(x => x.type)).toEqual([
      'bed', 'sofa', 'cabinet', 'curtain', 'nightstand', 'coffee-table', 'armchair', 'console',
      'desk', 'office-chair', 'bookcase', 'filing-cabinet', 'kitchen-run', 'fridge', 'dining-table', 'dining-chair',
      'bath', 'shower', 'toilet', 'basin',
      'side-table', 'tv-unit', 'workbench', 'tool-cabinet', 'shelving-rack', 'machine',
    ]);
  });

  it('generates furniture at requested dimensions', () => {
    const g = createInteriorFurnitureGeometry('bed', { width: 1.8, depth: 2.1 });
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(1.8, 1);
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeGreaterThan(1.9);
    g.dispose();
  });

  it('marks sofas and beds as bakeable soft bodies, and curtains as bakeable cloth', () => {
    const sofa = createInteriorFurnitureShape('sofa');
    const bed = createInteriorFurnitureShape('bed');
    const curtain = createInteriorFurnitureShape('curtain');
    expect(sofa.customData.semanticComponent.simulation).toMatchObject({ type: 'softbody', bakeable: true });
    expect(bed.customData.semanticComponent.simulation).toMatchObject({ type: 'softbody', bakeable: true });
    expect(curtain.customData.semanticComponent.simulation).toMatchObject({ type: 'cloth', bakeable: true });
  });

  it('includes semantic furniture in quantities', () => {
    const lines = billOfMaterials([
      createInteriorFurnitureShape('bed'),
      createInteriorFurnitureShape('curtain'),
    ]);
    expect(lines.some(line => line.group === 'Fixtures & furniture' && line.item === 'Bed')).toBe(true);
    expect(lines.some(line => line.group === 'Fixtures & furniture' && line.item === 'Curtain')).toBe(true);
  });

  it('creates serialisable native custom shapes with placement metadata', () => {
    const cabinet = createInteriorFurnitureShape('cabinet', {
      position: [2, 0, 3],
      rotationY: Math.PI / 2,
      params: { width: 1.5, doorCount: 3 },
    });
    expect(cabinet.type).toBe('custom');
    expect(cabinet.position).toEqual([2, 0, 3]);
    expect(cabinet.geometryData.positions.length).toBeGreaterThan(100);
    expect(cabinet.customData.semanticComponent.params.width).toBe(1.5);
    expect(cabinet.customData.semanticComponent.placement.preferredHost).toBe('wall');
  });
  it('builds every catalog piece with finite geometry and normals', () => {
    for (const entry of interiorFurnitureCatalog()) {
      const g = createInteriorFurnitureGeometry(entry.type);
      expect(g.getAttribute('position').count).toBeGreaterThan(30);
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(g.getAttribute('normal').count).toBe(g.getAttribute('position').count);
      g.dispose();
    }
  });

});
