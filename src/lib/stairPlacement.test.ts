import { describe, expect, it } from 'vitest';
import type { Shape } from '../types';
import { checkStairPlacement } from './stairPlacement';

const stair = { position: [0, 1.08, 0] as [number, number, number], quaternion: [0, 0, 0, 1] as [number, number, number, number], width: 1, height: 2.16 };
const centre = (poly: [number, number][]) => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length] as const;
/** A wall lying along x through (x, z), 0.2 m thick, as tall as a storey from the ground. */
const wall = (x: number, z: number, length = 6, id = 'w'): Shape => ({ id, type: 'wall', position: [x, 1.4, z], quaternion: [0, 0, 0, 1], args: [length, 2.8, 0.2], color: '#fff' } as unknown as Shape);
const wallZ = (x: number, z: number, length = 6): Shape => ({ id: 'wz', type: 'wall', position: [x, 1.4, z], quaternion: [0, 0.7071068, 0, 0.7071068], args: [length, 2.8, 0.2], color: '#fff' } as unknown as Shape);

describe('stair placement', () => {
  const free = checkStairPlacement(stair, [])!;
  it('is fine in open space and reports where a person steps off', () => {
    expect(free.ok).toBe(true);
    expect(free.exit).toHaveLength(4);
    expect(free.topY).toBeCloseTo(2.16);
  });
  it('refuses a wall through the flight', () => {
    const [cx, cz] = centre(free.footprint);
    const r = checkStairPlacement(stair, [wall(cx, cz)])!;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/through a wall/);
  });
  it('lets the flight touch a wall beside it', () => {
    const xs = free.footprint.map(p => p[0]);
    // A wall along z standing just outside the flight's side, its face touching the flight.
    const right = Math.max(...xs);
    expect(checkStairPlacement(stair, [wallZ(right + 0.1, 0, 20)])!.ok).toBe(true);
  });
  it('refuses a wall across the exit', () => {
    const [ex, ez] = centre(free.exit!);
    const r = checkStairPlacement(stair, [wall(ex, ez, 8), wallZ(ex, ez, 8)])!;
    expect(r.ok).toBe(false);
  });
  it('ignores a wall on a floor far above or below', () => {
    const [cx, cz] = centre(free.footprint);
    const high = { ...wall(cx, cz), position: [cx, 9, cz] } as Shape;
    expect(checkStairPlacement(stair, [high])!.ok).toBe(true);
  });
});
