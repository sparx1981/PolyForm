import { describe, expect, it } from 'vitest';
import { calibrateReferencePlan, createReferencePlanShape, referencePixelToWorld } from './referencePlan';

describe('calibrated floor-plan underlays', () => {
  it('calibrates a page from two known points', () => {
    const result = calibrateReferencePlan(
      { pixelWidth: 1000, pixelHeight: 800 },
      { pixelA: [100, 100], pixelB: [500, 100], knownDistanceM: 4 },
    );
    expect(result.metresPerPixel).toBeCloseTo(0.01);
    expect(result.widthM).toBeCloseTo(10);
    expect(result.heightM).toBeCloseTo(8);
  });

  it('creates a locked textured native reference shape', () => {
    const shape = createReferencePlanShape(
      { kind: 'pdf-page', name: 'Ground floor.pdf', imageUrl: 'data:image/png;base64,x', page: 1, pixelWidth: 1000, pixelHeight: 800 },
      { pixelA: [100, 100], pixelB: [500, 100], knownDistanceM: 4 },
    );
    expect(shape.type).toBe('box');
    expect(shape.args).toEqual([10, 0.004, 8]);
    expect(shape.customData.referencePlan.locked).toBe(true);
    expect(shape.textureUrl).toContain('data:image');
  });

  it('maps recognised source pixels into the underlay world transform', () => {
    const shape = createReferencePlanShape(
      { kind: 'image', imageUrl: 'x', pixelWidth: 1000, pixelHeight: 800 },
      { pixelA: [0, 0], pixelB: [100, 0], knownDistanceM: 1 },
      { position: [5, 0, 8], rotationY: Math.PI / 2 },
    );
    const center = referencePixelToWorld(shape, [500, 400]);
    expect(center[0]).toBeCloseTo(5);
    expect(center[1]).toBeCloseTo(8);
    const right = referencePixelToWorld(shape, [600, 400]);
    expect(right[0]).toBeCloseTo(5);
    expect(right[1]).toBeCloseTo(7);
  });
});
