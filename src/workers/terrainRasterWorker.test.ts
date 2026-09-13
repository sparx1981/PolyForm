import { describe, it, expect } from 'vitest';
import { computeTerrainRaster } from './terrainRasterWorker';
import type { PadModifier, RoadModifier } from '../types';

// computeTerrainRaster is the pure cut/fill calculation engine behind the
// terrain raster Web Worker (src/workers/terrainRasterWorker.ts). As of this
// audit it has ZERO test coverage even though the module's own comment calls
// it out as "the actual point" of being extracted into a pure function —
// this file exercises it directly, without any worker/thread machinery.

const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };

function flatInput(overrides: Partial<Parameters<typeof computeTerrainRaster>[0]> = {}) {
  const gridWidth = 11;
  const gridDepth = 11;
  return {
    gridWidth,
    gridDepth,
    bounds,
    baseHeights: new Float32Array(gridWidth * gridDepth).fill(0),
    modifiers: [],
    ...overrides,
  };
}

function makePad(overrides: Partial<PadModifier> = {}): PadModifier {
  return {
    id: 'pad-1',
    name: 'Test Pad',
    type: 'pad',
    enabled: true,
    primitive: 'rectangle',
    center: [0, 0, 0],
    dimensions: [4, 4],
    rotationY: 0,
    targetElevation: 2,
    batterDistance: 0,
    batterProfile: 'linear',
    ...overrides,
  };
}

describe('computeTerrainRaster', () => {
  it('is a no-op on flat ground with no modifiers: zero volumes, zero diff', () => {
    const out = computeTerrainRaster(flatInput());
    expect(out.metrics.cutVolumeM3).toBe(0);
    expect(out.metrics.fillVolumeM3).toBe(0);
    expect(out.metrics.netVolumeM3).toBe(0);
    expect(out.metrics.cutAreaM2).toBe(0);
    expect(out.metrics.fillAreaM2).toBe(0);
    expect(Array.from(out.diffHeights).every(h => h === 0)).toBe(true);
    expect(Array.from(out.modifiedHeights)).toEqual(Array.from(out.diffHeights).map((_, i) => 0));
  });

  it('raises the surface under a rectangular pad to exactly targetElevation, generating pure fill', () => {
    const pad = makePad({ center: [0, 0, 0], dimensions: [4, 4], targetElevation: 2, batterDistance: 0 });
    const out = computeTerrainRaster(flatInput({ modifiers: [pad] }));

    // Cell at the origin sits inside the pad footprint (|x|<=2, |z|<=2).
    const idx = 5 * 11 + 5; // centre cell for an 11x11 grid over [-5,5]
    expect(out.modifiedHeights[idx]).toBeCloseTo(2, 6);
    expect(out.diffHeights[idx]).toBeCloseTo(2, 6);

    // Raising ground above base height everywhere inside the pad is FILL,
    // never cut, and nothing outside the pad should have moved.
    expect(out.metrics.fillVolumeM3).toBeGreaterThan(0);
    expect(out.metrics.cutVolumeM3).toBe(0);
    expect(out.metrics.netVolumeM3).toBeCloseTo(out.metrics.fillVolumeM3, 6);

    // A corner cell well outside the 4x4 pad and its (zero) batter is untouched.
    const cornerIdx = 0;
    expect(out.diffHeights[cornerIdx]).toBe(0);
  });

  it('a disabled modifier is completely ignored', () => {
    const pad = makePad({ enabled: false, targetElevation: 5 });
    const out = computeTerrainRaster(flatInput({ modifiers: [pad] }));
    expect(Array.from(out.diffHeights).every(h => h === 0)).toBe(true);
    expect(out.metrics.fillVolumeM3).toBe(0);
  });

  it('lowering the pad below base height produces pure cut, not fill', () => {
    const pad = makePad({ targetElevation: -3, batterDistance: 0 });
    const out = computeTerrainRaster(flatInput({ modifiers: [pad] }));
    expect(out.metrics.cutVolumeM3).toBeGreaterThan(0);
    expect(out.metrics.fillVolumeM3).toBe(0);
    expect(out.metrics.netVolumeM3).toBeLessThan(0);
  });

  it('a circular pad only affects cells within its radius, not the full bounding square', () => {
    const pad = makePad({ primitive: 'circle', dimensions: [4, 4], targetElevation: 3, batterDistance: 0, center: [0, 0, 0] });
    const out = computeTerrainRaster(flatInput({ modifiers: [pad] }));
    // (4,4) grid corner-ish cell world coords: with an 11x11 grid over
    // [-5,5], step = 1, so index (9,9) sits at world (4,4) — inside the
    // pad's rectangular bbox but outside its circular radius of 2.
    const idx = 9 * 11 + 9;
    expect(out.modifiedHeights[idx]).toBe(0);
  });

  it('curved batter falloff diverges from a linear ramp at a quarter of the transition, not just at its ends', () => {
    // Smoothstep (3t^2 - 2t^3) is a fixed point of the linear ramp at
    // t=0, 0.5 and 1, so a naive test at the batter midpoint cannot tell
    // a real smoothstep apart from a regression to a plain linear blend.
    // t=0.25 can: smoothstep(0.25)=0.15625 vs linear(0.25)=0.25.
    const target = 4;
    const batterDistance = 2;
    const gridWidth = 21, gridDepth = 21; // step = 0.5 over [-5,5]
    const padLinear = makePad({ dimensions: [2, 2], targetElevation: target, batterDistance, batterProfile: 'linear' });
    const padCurved = makePad({ dimensions: [2, 2], targetElevation: target, batterDistance, batterProfile: 'curved' });

    const base = { gridWidth, gridDepth, bounds, baseHeights: new Float32Array(gridWidth * gridDepth).fill(0) };
    const outLinear = computeTerrainRaster({ ...base, modifiers: [padLinear] });
    const outCurved = computeTerrainRaster({ ...base, modifiers: [padCurved] });

    // World x = 1.5 -> distance past the pad edge (half-width 1) = 0.5,
    // t = 0.5 / batterDistance(2) = 0.25. Grid index: (1.5 - (-5)) / 0.5 = 13.
    const idx = 10 * gridWidth + 13; // row 10 -> world z = 0
    const linearVal = outLinear.modifiedHeights[idx]!;
    const curvedVal = outCurved.modifiedHeights[idx]!;

    expect(linearVal).toBeCloseTo(target * 0.75, 6);
    expect(curvedVal).toBeCloseTo(target * (1 - (3 * 0.25 ** 2 - 2 * 0.25 ** 3)), 6);
    expect(curvedVal).not.toBeCloseTo(linearVal, 2);
  });

  it('treats a baseHeights entry as 0 when the array is shorter than the grid, instead of producing NaN', () => {
    const gridWidth = 4;
    const gridDepth = 4;
    const shortBase = new Float32Array(4); // only 4 of 16 cells provided
    const out = computeTerrainRaster({
      gridWidth,
      gridDepth,
      bounds,
      baseHeights: shortBase,
      modifiers: [],
    });
    expect(Array.from(out.modifiedHeights).every(h => Number.isFinite(h))).toBe(true);
    expect(Array.from(out.diffHeights).every(h => h === 0)).toBe(true);
  });

  it('a degenerate 1x1 grid does not divide by zero in the step calculation', () => {
    const out = computeTerrainRaster({
      gridWidth: 1,
      gridDepth: 1,
      bounds,
      baseHeights: [0],
      modifiers: [],
    });
    expect(Number.isFinite(out.modifiedHeights[0])).toBe(true);
    expect(out.metrics.cutVolumeM3).toBe(0);
  });

  it('a road with hasDitch raises no exception and keeps carriageway cells at the sampled spline elevation', () => {
    const road: RoadModifier = {
      id: 'road-1',
      name: 'Test Road',
      type: 'road',
      enabled: true,
      points: [
        [-4, 1, 0],
        [0, 1, 0],
        [4, 1, 0],
      ],
      width: 2,
      maxGradePercent: 10,
      bankingAngle: 0,
      profile: { width: 0.15, height: 0.15, ditchWidth: 1.2, ditchDepth: 0.35, hasCurb: false, hasDitch: true },
      markings: 'none',
    };
    const out = computeTerrainRaster(flatInput({ modifiers: [road] }));
    const idx = 5 * 11 + 5; // world (0,0) sits on the road centreline
    expect(out.modifiedHeights[idx]).toBeCloseTo(1, 6);
    expect(Array.from(out.modifiedHeights).every(h => Number.isFinite(h))).toBe(true);
  });
});
