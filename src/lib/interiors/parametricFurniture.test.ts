import { describe, expect, it } from 'vitest';
import { createInteriorFurnitureGeometry, createInteriorFurnitureShape, interiorFurnitureCatalog } from './parametricFurniture';
import { bakeSemanticSimulation } from './bakeSimulation';
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

describe('soft furnishings', () => {
  const maxMove = (a: number[], b: number[]) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };

  it('records each soft part so settling can shape it by role', () => {
    const sofa = createInteriorFurnitureShape('sofa');
    const roles = new Set((sofa.customData.furniturePartRanges as Array<{ role?: string }>).map(p => p.role));
    for (const role of ['seat', 'back', 'arm', 'scatter', 'throw']) expect(roles, role).toContain(role);
    const bed = createInteriorFurnitureShape('bed');
    const bedRoles = new Set((bed.customData.furniturePartRanges as Array<{ role?: string }>).map(p => p.role));
    for (const role of ['mattress', 'duvet', 'pillow', 'scatter', 'throw']) expect(bedRoles, role).toContain(role);
  });

  it('leaves cushions, throws and pillows off when dressing is 0', () => {
    for (const type of ['sofa', 'bed'] as const) {
      const bare = createInteriorFurnitureShape(type, { params: { dressing: 0 } });
      const roles = (bare.customData.furniturePartRanges as Array<{ role?: string }>).map(p => p.role);
      expect(roles).not.toContain('scatter');
      expect(roles).not.toContain('throw');
    }
  });

  it('visibly settles a sofa and a bed at the Interior Studio strengths', () => {
    for (const [type, strength, minimum] of [['sofa', 0.42, 0.03], ['armchair', 0.42, 0.03], ['bed', 0.42, 0.08]] as const) {
      const shape = createInteriorFurnitureShape(type);
      const settled = bakeSemanticSimulation(shape, strength);
      // Centimetres, not millimetres: this is what makes Relax upholstery visible.
      expect(maxMove(shape.geometryData.positions, settled.geometryData.positions), type).toBeGreaterThan(minimum);
      expect(settled.geometryData.positions.every(Number.isFinite)).toBe(true);
    }
  });

  it('settles harder at a higher strength and does nothing at zero', () => {
    const shape = createInteriorFurnitureShape('sofa');
    const soft = maxMove(shape.geometryData.positions, bakeSemanticSimulation(shape, 0.2).geometryData.positions);
    const firm = maxMove(shape.geometryData.positions, bakeSemanticSimulation(shape, 0.8).geometryData.positions);
    expect(firm).toBeGreaterThan(soft);
    expect(maxMove(shape.geometryData.positions, bakeSemanticSimulation(shape, 0).geometryData.positions)).toBeLessThan(1e-6);
  });

  it('keeps the hard frame exactly where it was', () => {
    const shape = createInteriorFurnitureShape('bed');
    const settled = bakeSemanticSimulation(shape, 0.42);
    for (const part of shape.customData.furniturePartRanges as Array<{ start: number; count: number; material: number }>) {
      if (part.material !== 0) continue;
      const a = shape.geometryData.positions.slice(part.start * 3, (part.start + part.count) * 3);
      expect(maxMove(a, settled.geometryData.positions.slice(part.start * 3, (part.start + part.count) * 3))).toBe(0);
    }
  });

  it('keeps saved size in check: no piece is heavier than a couple of megabytes', () => {
    for (const type of ['bed', 'sofa', 'armchair'] as const) {
      const shape = createInteriorFurnitureShape(type);
      expect(JSON.stringify(shape).length, type).toBeLessThan(2 * 1024 * 1024);
      expect(() => bakeSemanticSimulation(shape, 0.42)).not.toThrow();
    }
  });

});
