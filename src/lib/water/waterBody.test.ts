import { describe, it, expect } from 'vitest';
import type { Shape } from '../../types';
import { bedDepth, deepestPoint, defaultWaterLevel, pointInPolygon, digWaterBasins, offsetOutline, signedEdgeDistance, waterMargin } from './waterBody';
import { sampleTerrainElevation } from '../archRoomAssembly';

const flat = (): Shape => ({
  id: 't', name: 'Terrain', type: 'terrain', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#fff',
  args: [40, 0, 40], terrainData: { gridX: 81, gridY: 81, width: 40, depth: 40, heights: new Array(81 * 81).fill(0) },
});
const pond = (overrides: Partial<Shape> = {}): Shape => ({
  id: 'w', name: 'Pond', type: 'water', position: [0, -0.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#fff', args: [],
  waterData: { points: [[-5, -4], [5, -4], [5, 4], [-5, 4]], depth: 1.5, clarity: 'pond', dig: true }, ...overrides,
});

describe('water basins', () => {
  it('measures distance to the outline, positive inside', () => {
    const square = [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }];
    expect(signedEdgeDistance(0, 0, square)).toBeCloseTo(1);
    expect(signedEdgeDistance(3, 0, square)).toBeCloseTo(-2);
  });

  it('deepens from a shallow shelf at the shore to full depth in the middle', () => {
    expect(bedDepth(0, 1.5, 4)).toBeCloseTo(0.15);
    expect(bedDepth(10, 1.5, 4)).toBeCloseTo(1.5);
    expect(bedDepth(1, 1.5, 4)).toBeLessThan(bedDepth(2, 1.5, 4));
  });

  it('digs a bowl under the pond and leaves the rest of the terrain alone', () => {
    const terrain = flat();
    const dug = { ...terrain, terrainData: digWaterBasins(terrain, [pond()]) };
    const centre = sampleTerrainElevation(0, 0, dug);
    expect(centre).toBeCloseTo(-0.05 - 1.5, 1);
    expect(sampleTerrainElevation(4.7, 0, dug)).toBeGreaterThan(centre);
    expect(sampleTerrainElevation(15, 15, dug)).toBe(0);
    // The saved terrain is never modified.
    expect(terrain.terrainData!.heights.every(h => h === 0)).toBe(true);
  });

  it('raises low ground just outside the outline into a bank', () => {
    const terrain = flat();
    terrain.terrainData!.heights = terrain.terrainData!.heights.map(() => -0.3);
    const dug = { ...terrain, terrainData: digWaterBasins(terrain, [pond()]) };
    // Just past the dug margin (one 0.5 m grid cell).
    expect(sampleTerrainElevation(6, 0, dug)).toBeGreaterThan(-0.05);
    expect(sampleTerrainElevation(12, 0, dug)).toBeCloseTo(-0.3);
  });

  it('skips water bodies that do not dig', () => {
    const terrain = flat();
    expect(digWaterBasins(terrain, [pond({ waterData: { ...pond().waterData!, dig: false } })])).toBe(terrain.terrainData);
  });

  it('sets the default level just below the lowest ground on the outline', () => {
    const level = defaultWaterLevel([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], (x) => x * 0.1);
    expect(level).toBeCloseTo(-0.05);
  });
});

describe('small ponds on a coarse terrain grid', () => {
  it('pushes an outline outward whichever way it was drawn', () => {
    const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const outline of [square, [...square].reverse()]) {
      const grown = offsetOutline(outline, 0.5);
      const xs = grown.map(p => p[0]), zs = grown.map(p => p[1]);
      expect(Math.min(...xs)).toBeCloseTo(-0.5); expect(Math.max(...xs)).toBeCloseTo(1.5);
      expect(Math.min(...zs)).toBeCloseTo(-0.5); expect(Math.max(...zs)).toBeCloseTo(1.5);
    }
  });

  it('digs every grid point near a pond smaller than a grid cell, so the water is not hidden', () => {
    // 50 m site at 32 x 32: 1.6 m cells. A 1.2 m pond contains no grid point at all.
    const terrain: Shape = {
      id: 't', name: 'Terrain', type: 'terrain', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#fff',
      args: [50, 0, 50], terrainData: { gridX: 32, gridY: 32, width: 50, depth: 50, heights: new Array(32 * 32).fill(0) },
    };
    const small = pond({ position: [0.3, -0.05, 0.3], waterData: { points: [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]], depth: 1, clarity: 'pond', dig: true } });
    const dug = { ...terrain, terrainData: digWaterBasins(terrain, [small]) };
    // Every corner of the pond is below the water level, so the surface is visible there.
    for (const [x, z] of [[-0.3, -0.3], [0.9, -0.3], [0.9, 0.9], [-0.3, 0.9], [0.3, 0.3]]) {
      expect(sampleTerrainElevation(x, z, dug)).toBeLessThan(-0.05);
    }
    expect(waterMargin(terrain)).toBeGreaterThan(50 / 31);
  });
});

describe('deepestPoint', () => {
  it('stays inside a C-shaped pond whose average point is dry land', () => {
    const c = [[16.41, 11.28], [16.86, 6.24], [18.68, 2.8], [22.59, 1.29], [24.22, 3.43], [24.86, 8.31], [24.32, 11.31], [22.7, 14.63],
      [20.18, 17.19], [18.48, 17.71], [16.89, 17.71], [16.43, 16.79], [17.68, 15], [19.09, 14.46], [21.27, 12.06], [22.15, 9.19],
      [21, 7.31], [19.49, 7.74], [18.7, 9.78], [18.13, 11.16], [16.89, 12.19]].map(([x, z]) => ({ x, z }));
    const inner = deepestPoint(c);
    expect(pointInPolygon(inner.x, inner.z, c)).toBe(true);
    expect(inner.distance).toBeGreaterThan(0.5);
  });
});
