import { describe, it, expect } from 'vitest';
import { createTerrainShape, generateTerrainHeights } from './terrainFactory';

describe('terrainFactory', () => {
  it('creates valid default flat terrain shape with correct dimensions and resolution', () => {
    const shape = createTerrainShape({
      width: 50,
      depth: 50,
      resolution: 32,
      topography: 'flat',
    });

    expect(shape.type).toBe('terrain');
    expect(shape.name).toBe('Site Terrain');
    expect(shape.terrainData).toBeDefined();
    expect(shape.terrainData?.width).toBe(50);
    expect(shape.terrainData?.depth).toBe(50);
    expect(shape.terrainData?.gridX).toBe(32);
    expect(shape.terrainData?.gridY).toBe(32);
    expect(shape.terrainData?.heights.length).toBe(32 * 32);

    // All flat heights should be 0
    const nonZeroHeights = Array.from(shape.terrainData!.heights).filter(h => h !== 0);
    expect(nonZeroHeights.length).toBe(0);
  });

  it('generates non-zero terrain elevations for rolling, ridge, and terraced presets', () => {
    const rollingHeights = generateTerrainHeights({ resolution: 24, topography: 'rolling' });
    expect(rollingHeights.length).toBe(24 * 24);
    const hasRollingElevations = Array.from(rollingHeights).some(h => Math.abs(h) > 0.01);
    expect(hasRollingElevations).toBe(true);

    const ridgeHeights = generateTerrainHeights({ resolution: 24, topography: 'ridge' });
    expect(ridgeHeights.length).toBe(24 * 24);
    const hasRidgeSlope = Array.from(ridgeHeights).some(h => Math.abs(h) > 0.01);
    expect(hasRidgeSlope).toBe(true);

    const terracedHeights = generateTerrainHeights({ resolution: 24, topography: 'terraced' });
    expect(terracedHeights.length).toBe(24 * 24);
    const hasTerraces = Array.from(terracedHeights).some(h => Math.abs(h) > 0.01);
    expect(hasTerraces).toBe(true);
  });

  it('preserves existing shape ID and supports custom material texture', () => {
    const customId = 'existing-terrain-uuid-123';
    const shape = createTerrainShape({
      width: 80,
      depth: 60,
      resolution: 48,
      topography: 'rolling',
      textureId: 'alpine_rock',
    }, customId);

    expect(shape.id).toBe(customId);
    expect(shape.terrainData?.width).toBe(80);
    expect(shape.terrainData?.depth).toBe(60);
    expect(shape.terrainData?.gridX).toBe(48);
    expect(shape.roughness).toBeGreaterThan(0.5);
    expect(shape.color).toBeDefined();
  });
});
