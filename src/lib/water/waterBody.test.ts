import { describe, it, expect } from 'vitest';
import type { Shape } from '../../types';
import { bedDepth, defaultWaterLevel, digWaterBasins, signedEdgeDistance } from './waterBody';
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
    expect(sampleTerrainElevation(5.5, 0, dug)).toBeGreaterThan(-0.05);
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
