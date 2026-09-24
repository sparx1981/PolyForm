import { describe, it, expect } from 'vitest';
import { buildFence, splitPath, snapshotSampler } from './fenceBuild';
import { FENCE_STYLES, type FenceData, type TerrainSnapshot } from './fenceTypes';
import { pathLength } from './gardenFence';

/** A rolling slope well away from the origin, like a real site. */
function slope(x0: number, z0: number, size = 90, step = 0.5): TerrainSnapshot {
  const columns = Math.round(size / step) + 1, rows = columns;
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    heights[j * columns + i] = 0.06 * (x - x0) + 0.4 * Math.sin(z * 0.2);
  }
  return { x: x0, z: z0, step, columns, rows, heights };
}

const minY = (positions: Float32Array) => { let m = Infinity; for (let i = 1; i < positions.length; i += 3) m = Math.min(m, positions[i]); return m; };

describe('fence builder', () => {
  const terrain = slope(100, 100);
  const ground = snapshotSampler(terrain);
  const path: [number, number][] = [[110, 120], [122, 122], [134, 121]];

  for (const info of FENCE_STYLES) {
    it(`builds a ${info.label} fence on sloping ground away from the origin`, () => {
      const data: FenceData = { points: info.id === 'skigard' ? [[110, 120], [134, 121]] : path, style: info.id, height: info.defaultHeight, seed: 3 };
      const result = buildFence(data, terrain);
      if (!result.ok) throw new Error(result.error);
      expect(result.batches!.length).toBeGreaterThan(0);
      const wood = result.batches!.find(batch => batch.kind === 'wood')!;
      expect(wood.positions.length % 9).toBe(0);
      expect(wood.colors.length).toBe(wood.positions.length);
      expect(wood.uvs.length / 2).toBe(wood.positions.length / 3);
      // Built in world space around the path, not around the origin.
      expect(Math.abs(wood.positions[0] - 120)).toBeLessThan(20);
      expect(Number.isFinite(minY(wood.positions))).toBe(true);
    });
  }

  it('sets garden fence posts into the ground at their own height', () => {
    const result = buildFence({ points: [[110, 110], [130, 110]], style: 'close-board', height: 1.8, seed: 1 }, terrain);
    if (!result.ok) throw new Error(result.error);
    const wood = result.batches!.find(batch => batch.kind === 'wood')!;
    // The lowest point is a post foot, set into the ground.
    expect(minY(wood.positions)).toBeLessThan(ground(110, 110));
    let top = -Infinity; for (let i = 1; i < wood.positions.length; i += 3) top = Math.max(top, wood.positions[i]);
    expect(top).toBeGreaterThan(ground(130, 110) + 1.7);
  });

  it('splits long fences into buildable runs that meet end to end', () => {
    const points = [{ x: 0, z: 0 }, { x: 70, z: 0 }, { x: 70, z: 70 }];
    const runs = splitPath(points, 60);
    expect(runs.length).toBe(3);
    runs.forEach(run => expect(pathLength(run, false)).toBeLessThanOrEqual(60.01));
    for (let i = 1; i < runs.length; i++) expect(runs[i][0]).toEqual(runs[i - 1].at(-1));
    expect(runs.reduce((sum, run) => sum + pathLength(run, false), 0)).toBeCloseTo(140);
  });

  it('builds a split-rail fence longer than the generator limit', () => {
    const long = slope(0, 0, 100);
    const result = buildFence({ points: [[5, 50], [95, 52]], style: 'post-rail', height: 1.25, seed: 2 }, long);
    if (!result.ok) throw new Error(result.error);
    expect(result.length!).toBeGreaterThan(89);
  });

  it('reports unbuildable paths in English', () => {
    const result = buildFence({ points: [[110, 110], [111, 110]], style: 'worm', height: 1.25, seed: 1 }, terrain);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2\.3 m/);
  });
});

describe('garden fence geometry', () => {
  it('winds every face outward so it lights correctly', () => {
    const flat: TerrainSnapshot = { x: -10, z: -10, step: 1, columns: 21, rows: 21, heights: new Float32Array(441) };
    for (const style of ['close-board', 'picket', 'panel'] as const) {
      const result = buildFence({ points: [[-3, 0], [3, 0]], style, height: 1.5, seed: 1 }, flat);
      // Side grain and end grain together close every member; its signed volume is positive
      // only when the faces wind outward.
      let volume = 0;
      const p = Float32Array.from(result.batches!.filter(batch => batch.kind === 'wood' || batch.kind === 'woodEnd').flatMap(batch => Array.from(batch.positions)));
      for (let i = 0; i < p.length; i += 9) {
        volume += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
      }
      expect(volume).toBeGreaterThan(0);
    }
  });
});

describe('fence fallbacks', () => {
  it('builds the closed triangle from the bug report instead of failing', () => {
    // Same shape and lengths as the reported fence (29 m, three corners, closed).
    const terrain: TerrainSnapshot = { x: 20, z: 10, step: 0.5, columns: 81, rows: 61, heights: new Float32Array(81 * 61) };
    for (let i = 0; i < terrain.heights.length; i++) terrain.heights[i] = 2 + 0.05 * (i % 81);
    const result = buildFence({ points: [[37.47, 30.79], [45.63, 22.32], [48.2, 28.23]], closed: true, style: 'post-rail', height: 1.25, seed: 3 }, terrain);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.batches!.length).toBeGreaterThan(0);
  });
});
