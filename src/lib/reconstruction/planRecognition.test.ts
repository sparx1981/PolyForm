// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { analyseFloorPlan } from './localPlanRecognizer';
import { parseDimension } from './dimensionScale';
import { imageObservationToDraft } from './imageAdapter';
import { commitReconstructionDraft } from './draft';

describe('parseDimension', () => {
  it('reads feet and inches, metres and millimetres', () => {
    expect(parseDimension(`7'2"`)).toBeCloseTo(2.1844, 3);
    expect(parseDimension(`10'5"`)).toBeCloseTo(3.1750, 3);
    expect(parseDimension(`8'`)).toBeCloseTo(2.4384, 3);
    expect(parseDimension('4.2 m')).toBeCloseTo(4.2, 5);
    expect(parseDimension('3600')).toBeCloseTo(3.6, 5);
    expect(parseDimension('3,600 mm')).toBeCloseTo(3.6, 5);
    expect(parseDimension(`7'' 2''`)).toBeNull();
    expect(parseDimension(`7'14"`)).toBeNull();
    expect(parseDimension('hello')).toBeNull();
  });
});

describe('a real floor plan', async () => {
  const path = fileURLToPath(new URL('./__fixtures__/sample-plan.png', import.meta.url));
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const analysis = analyseFloorPlan({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) });
  const { geometry, scale } = analysis;

  it('finds the outer walls, not just the inner ones', () => {
    const b = geometry.bounds!;
    const long = geometry.walls.filter(w => w.a1 - w.a0 > (b.x1 - b.x0) * 0.25);
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const hit = long.some(w => side === 'top' ? w.o === 'h' && w.c0 < b.y0 + 20 : side === 'bottom' ? w.o === 'h' && w.c1 > b.y1 - 20
        : side === 'left' ? w.o === 'v' && w.c0 < b.x0 + 20 : w.o === 'v' && w.c1 > b.x1 - 20);
      expect(hit, side).toBe(true);
    }
  });

  it('finds the doors by their swing and the windows by their glazing', () => {
    const doors = geometry.openings.filter(o => o.kind === 'door').length;
    const windows = geometry.openings.filter(o => o.kind === 'window').length;
    expect(doors).toBeGreaterThanOrEqual(10);
    expect(doors).toBeLessThanOrEqual(12);
    expect(windows).toBeGreaterThanOrEqual(12);
    expect(windows).toBeLessThanOrEqual(15);
  });

  it('reads the scale from the printed dimensions', () => {
    expect(scale.source).toBe('dimension-text');
    expect(scale.confidence).toBeGreaterThan(0.9);
    // The printed chain along the bottom is 15'1" + 17'1" + 17'1" = 49'3" = 15.0 m.
    const widthM = (geometry.bounds!.x1 - geometry.bounds!.x0) * scale.metresPerPixel;
    expect(widthM).toBeGreaterThan(14.6);
    expect(widthM).toBeLessThan(15.4);
  });

  it('builds real walls, doors and windows from it', () => {
    const draft = imageObservationToDraft(analysis.observation);
    const result = commitReconstructionDraft(draft, { includeFurniture: false });
    expect(result.validation.errors).toBe(0);
    expect(result.shapes.filter(s => s.type === 'wall').length).toBeGreaterThan(30);
    expect(result.shapes.filter(s => s.type === 'door').length).toBeGreaterThanOrEqual(10);
    expect(result.shapes.filter(s => s.type === 'window').length).toBeGreaterThanOrEqual(12);
  });

  it('gives the same answer when the picture is larger or smaller', async () => {
    for (const factor of [1.5, 2]) {
      const resized = await sharp(path).resize(Math.round(info.width * factor), Math.round(info.height * factor), { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const other = analyseFloorPlan({ width: resized.info.width, height: resized.info.height, data: new Uint8ClampedArray(resized.data) });
      const widthM = (other.geometry.bounds!.x1 - other.geometry.bounds!.x0) * other.scale.metresPerPixel;
      expect(widthM, `x${factor}`).toBeGreaterThan(14.6);
      expect(widthM, `x${factor}`).toBeLessThan(15.4);
      expect(other.geometry.openings.filter(o => o.kind === 'door').length).toBeGreaterThanOrEqual(10);
    }
  });
});
