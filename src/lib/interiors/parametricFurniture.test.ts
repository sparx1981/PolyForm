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
    for (const role of ['seat', 'back', 'arm', 'scatter']) expect(roles, role).toContain(role);
    // The sofa's throw is already shaped to its furniture, so it deliberately has no settling role.
    expect((sofa.customData.furniturePartRanges as Array<{ role?: string; material: number }>).some(p => !p.role && p.material === 2)).toBe(true);
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


  describe('scatter cushion and pillow placement', () => {
    type Part = { role?: string; start: number; count: number };
    const bounds = (shape: ReturnType<typeof createInteriorFurnitureShape>, part: Part) => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = part.start; i < part.start + part.count; i++) for (let a = 0; a < 3; a++) {
        const v = shape.geometryData.positions[i * 3 + a]!; lo[a] = Math.min(lo[a]!, v); hi[a] = Math.max(hi[a]!, v);
      }
      return { lo, hi };
    };
    const parts = (shape: ReturnType<typeof createInteriorFurnitureShape>) => shape.customData.furniturePartRanges as Part[];

    it('stands sofa cushions on the seat, against the back, leaning back', () => {
      const sofa = createInteriorFurnitureShape('sofa');
      const seat = bounds(sofa, parts(sofa).find(p => p.role === 'seat')!);
      const back = bounds(sofa, parts(sofa).find(p => p.role === 'back')!);
      const cushions = parts(sofa).filter(p => p.role === 'scatter');
      expect(cushions).toHaveLength(2);
      for (const part of cushions) {
        const b = bounds(sofa, part);
        // Resting on the seat, not hovering above it or sunk into it.
        expect(b.lo[1]! - seat.hi[1]!).toBeGreaterThan(-0.03);
        expect(b.lo[1]! - seat.hi[1]!).toBeLessThan(0.04);
        // Upright enough to read as sitting up, and its rear edge touching the back cushions.
        expect(b.hi[1]! - b.lo[1]!).toBeGreaterThan(0.3);
        expect(Math.abs(b.lo[2]! - back.hi[2]!)).toBeLessThan(0.08);
        // Leaning back: the top of the cushion is behind its bottom.
        const mid = (b.lo[2]! + b.hi[2]!) / 2;
        let topZ = 0, topN = 0, bottomZ = 0, bottomN = 0;
        for (let i = part.start; i < part.start + part.count; i++) {
          const y = sofa.geometryData.positions[i * 3 + 1]!, z = sofa.geometryData.positions[i * 3 + 2]!;
          if (y > b.hi[1]! - 0.05) { topZ += z; topN++; } else if (y < b.lo[1]! + 0.05) { bottomZ += z; bottomN++; }
        }
        expect(topZ / topN).toBeLessThan(bottomZ / bottomN);
        expect(mid).toBeGreaterThan(back.lo[2]!);
      }
    });

    it('lays the sofa throw above the seat cushion, clear of the cushions, and settling leaves it alone', () => {
      const sofa = createInteriorFurnitureShape('sofa');
      const settled = bakeSemanticSimulation(sofa, 0.42);
      const all = parts(sofa);
      const throwPart = (all as Array<Part & { material: number }>).find(p => !p.role && p.material === 2)!;
      expect(throwPart).toBeDefined();
      const before = bounds(sofa, throwPart);
      // Settling must not move it: it is already shaped to the sofa, and once sank 16 cm into the cushion.
      expect(settled.geometryData.positions.slice(throwPart.start * 3, (throwPart.start + throwPart.count) * 3))
        .toEqual(sofa.geometryData.positions.slice(throwPart.start * 3, (throwPart.start + throwPart.count) * 3));
      // Where it lies on the seat it is above the cushion beneath, even before that cushion sinks.
      const seatTop = Math.max(...all.filter(p => p.role === 'seat').map(p => bounds(sofa, p).hi[1]!));
      let lying = 0;
      for (let i = throwPart.start; i < throwPart.start + throwPart.count; i++) {
        const x = sofa.geometryData.positions[i * 3]!, y = sofa.geometryData.positions[i * 3 + 1]!;
        if (x < 0.8 && y < seatTop + 0.12) { expect(y).toBeGreaterThan(seatTop + 0.005); lying++; }
      }
      expect(lying).toBeGreaterThan(50);
      // And it does not sit under a scatter cushion: they share no part of the sofa's width.
      for (const cushion of all.filter(p => p.role === 'scatter')) expect(bounds(sofa, cushion).hi[0]!).toBeLessThan(before.lo[0]! + 0.02);
    });

    it('props the bed pillows against the headboard and leans cushions on them', () => {
      const bed = createInteriorFurnitureShape('bed');
      const mattress = bounds(bed, parts(bed).find(p => p.role === 'mattress')!);
      const headboard = bounds(bed, parts(bed).find(p => p.role === 'headboard')!);
      const pillows = parts(bed).filter(p => p.role === 'pillow');
      expect(pillows).toHaveLength(2);
      for (const part of pillows) {
        const b = bounds(bed, part);
        expect(Math.abs(b.lo[1]! - mattress.hi[1]!)).toBeLessThan(0.04);                 // resting on the mattress
        expect(b.lo[2]! - (headboard.lo[2]! + 0.12)).toBeLessThan(0.05);                  // back against the headboard face
        expect(b.hi[1]! - b.lo[1]!).toBeGreaterThan(0.3);                                 // propped up, not lying flat
      }
      const frontOfPillows = Math.max(...pillows.map(p => bounds(bed, p).hi[2]!));
      for (const part of parts(bed).filter(p => p.role === 'scatter')) {
        const b = bounds(bed, part);
        expect(b.lo[2]!).toBeLessThan(frontOfPillows + 0.06);                             // right in front of the pillows, leaning on them
        expect(b.lo[1]!).toBeGreaterThan(mattress.hi[1]! + 0.05);                         // standing on the duvet, not the bare mattress
        expect(b.lo[1]!).toBeLessThan(mattress.hi[1]! + 0.3);
      }
    });
  });
});
