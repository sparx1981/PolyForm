import { describe, expect, it } from 'vitest';
import { createInteriorFurnitureShape } from './parametricFurniture';
import { bakeSemanticSimulation } from './bakeSimulation';
import type { FurniturePartRange } from './furnitureParts';

type Part = FurniturePartRange & { role?: string };
const bed = () => createInteriorFurnitureShape('bed');
const partsOf = (shape: ReturnType<typeof bed>) => shape.customData.furniturePartRanges as Part[];
const extent = (positions: number[], part: Part) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = part.start; i < part.start + part.count; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, positions[i * 3 + a]!); hi[a] = Math.max(hi[a]!, positions[i * 3 + a]!); }
  return { lo, hi };
};

describe('drape bake (cloth simulation of bedding)', () => {
  it('is deterministic: the same bed settles to exactly the same folds', () => {
    const a = bakeSemanticSimulation(bed(), 0.42).geometryData.positions;
    const b = bakeSemanticSimulation(bed(), 0.42).geometryData.positions;
    expect(a).toEqual(b);
    expect(a.every(Number.isFinite)).toBe(true);
  });

  it('hangs the duvet over the sides of the mattress', () => {
    const shape = bed();
    const settled = bakeSemanticSimulation(shape, 0.42).geometryData.positions;
    const parts = partsOf(shape);
    const mattress = parts.find(p => p.role === 'mattress')!;
    const duvet = parts.filter(p => p.role === 'duvet').reduce((a, b) => (b.count > a.count ? b : a));
    const mattressTop = extent(shape.geometryData.positions, mattress).hi[1]!;
    const mattressHalf = mattress.size![0] / 2;
    let lowestOutside = Infinity;
    for (let i = duvet.start; i < duvet.start + duvet.count; i++) {
      if (Math.abs(settled[i * 3]!) > mattressHalf + 0.04) lowestOutside = Math.min(lowestOutside, settled[i * 3 + 1]!);
    }
    // Before settling the duvet's overhang is level with the mattress top; settled, it hangs clearly below it.
    expect(lowestOutside).toBeLessThan(mattressTop - 0.07);
  });

  it('rests on top of the mattress and does not pass through it', () => {
    const shape = bed();
    const settled = bakeSemanticSimulation(shape, 0.42).geometryData.positions;
    const parts = partsOf(shape);
    const mattress = parts.find(p => p.role === 'mattress')!;
    const duvet = parts.filter(p => p.role === 'duvet').reduce((a, b) => (b.count > a.count ? b : a));
    const mattressTop = extent(shape.geometryData.positions, mattress).hi[1]!;
    const half = mattress.size![0] / 2 - 0.12;
    let checked = 0;
    for (let i = duvet.start; i < duvet.start + duvet.count; i++) {
      // Underside of the duvet over the middle of the mattress: never below the mattress surface.
      if (Math.abs(settled[i * 3]!) < half && settled[i * 3 + 2]! > 0 && settled[i * 3 + 2]! < 0.9) {
        expect(settled[i * 3 + 1]!).toBeGreaterThan(mattressTop - 0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('keeps the throw the width it was, lying across the bed', () => {
    const shape = bed();
    const settled = bakeSemanticSimulation(shape, 0.42).geometryData.positions;
    const throwPart = partsOf(shape).find(p => p.role === 'throw')!;
    const before = extent(shape.geometryData.positions, throwPart), after = extent(settled, throwPart);
    expect(after.hi[0]! - after.lo[0]!).toBeGreaterThan((before.hi[0]! - before.lo[0]!) * 0.9);
    expect(after.hi[1]!).toBeGreaterThan(before.lo[1]! - 0.02);
  });

  it('does nothing at zero strength and drapes more as the strength rises', () => {
    const shape = bed();
    const move = (strength: number) => {
      const settled = bakeSemanticSimulation(shape, strength).geometryData.positions;
      const duvet = partsOf(shape).filter(p => p.role === 'duvet').reduce((a, b) => (b.count > a.count ? b : a));
      let total = 0;
      for (let i = duvet.start * 3; i < (duvet.start + duvet.count) * 3; i++) total += Math.abs(settled[i]! - shape.geometryData.positions[i]!);
      return total;
    };
    expect(move(0)).toBe(0);
    expect(move(0.15)).toBeLessThan(move(0.42));
  });

  it('falls back to the formula for older beds saved without sheet information', () => {
    const shape = bed();
    const legacy = { ...shape, customData: { ...shape.customData, furniturePartRanges: partsOf(shape).map(({ sheet, ...rest }) => { void sheet; return rest; }) } };
    const settled = bakeSemanticSimulation(legacy, 0.42).geometryData.positions;
    expect(settled.every(Number.isFinite)).toBe(true);
    expect(settled).not.toEqual(shape.geometryData.positions);
  });

  it('finishes in a reasonable time', () => {
    const start = performance.now();
    bakeSemanticSimulation(bed(), 0.42);
    expect(performance.now() - start).toBeLessThan(8000);
  });
});
