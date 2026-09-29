import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../types';
import { buildCeilingSlabForRoom, insetPolygon2D } from './archRoofGenerator';
import { alignSlabsToWalls } from './slabWallAlign';

const T = 0.2;
const quat = (yaw: number): [number, number, number, number] => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return [q.x, q.y, q.z, q.w];
};
/** A 6 m x 4 m room whose walls are centred on x 0..6, z 0..4. */
const room = (): Shape[] => [
  { id: 'a', type: 'wall', position: [3, 1.2, 0], args: [6, 2.4, T], color: '#fff' },
  { id: 'b', type: 'wall', position: [6, 1.2, 2], quaternion: quat(Math.PI / 2), args: [4, 2.4, T], color: '#fff' },
  { id: 'c', type: 'wall', position: [3, 1.2, 4], args: [6, 2.4, T], color: '#fff' },
  { id: 'd', type: 'wall', position: [0, 1.2, 2], quaternion: quat(Math.PI / 2), args: [4, 2.4, T], color: '#fff' },
] as Shape[];

const worldPoly = (slab: Shape): [number, number][] =>
  (slab.args as { vertices: [number, number][] }).vertices.map(([u, v]) => [u + slab.position[0], v + slab.position[2]]);
const bounds = (poly: [number, number][]) => ({
  minX: Math.min(...poly.map(p => p[0])), maxX: Math.max(...poly.map(p => p[0])),
  minZ: Math.min(...poly.map(p => p[1])), maxZ: Math.max(...poly.map(p => p[1])),
});

// The internal face of these walls is half a wall in from each centre line.
const FACE = { minX: T / 2, maxX: 6 - T / 2, minZ: T / 2, maxZ: 4 - T / 2 };

describe('floor slabs rest against the internal face of the walls', () => {
  it('a new slab reaches the internal face, with no gap and no more than a few mm into the wall', () => {
    const slab = buildCeilingSlabForRoom(room(), 0.2)!;
    const b = bounds(worldPoly(slab));
    for (const k of ['minX', 'minZ'] as const) {
      expect(b[k]).toBeGreaterThanOrEqual(FACE[k] - 0.01);
      expect(b[k]).toBeLessThanOrEqual(FACE[k] + 0.001);
    }
    for (const k of ['maxX', 'maxZ'] as const) {
      expect(b[k]).toBeLessThanOrEqual(FACE[k] + 0.01);
      expect(b[k]).toBeGreaterThanOrEqual(FACE[k] - 0.001);
    }
  });

  it('a slab for the next storey is not pulled in a second time by the slab below it', () => {
    const walls = room();
    const first = buildCeilingSlabForRoom(walls, 0.2, '#ccc', walls)!;
    const second = buildCeilingSlabForRoom(walls, 0.2, '#ccc', [...walls, first])!;
    expect(bounds(worldPoly(second))).toEqual(bounds(worldPoly(first)));
  });

  it('moves a slab made the old way (a whole wall in from the centre lines) out to the internal face', () => {
    const walls = room();
    const centre: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
    const legacy = insetPolygon2D(centre, T); // what the old generator did
    const slab = {
      id: 's', type: 'poly', name: 'Floor Slab', position: [3, 2.5, 2], tags: ['architecture', 'floor-slab'],
      args: { vertices: legacy.map(([x, z]) => [x - 3, z - 2]), height: 0.2, holes: [] },
    } as unknown as Shape;
    const before = bounds(worldPoly(slab));
    expect(before.minX).toBeGreaterThan(FACE.minX + 0.05); // the gap

    const [fixed] = alignSlabsToWalls([...walls, slab]).filter(s => s.id === 's');
    const after = bounds(worldPoly(fixed));
    expect(after.minX).toBeCloseTo(FACE.minX, 1);
    expect(after.maxX).toBeCloseTo(FACE.maxX, 1);
    expect(after.minZ).toBeCloseTo(FACE.minZ, 1);
    expect(after.maxZ).toBeCloseTo(FACE.maxZ, 1);
    expect(after.minX).toBeLessThanOrEqual(FACE.minX + 0.001);
  });

  it('leaves a slab someone drew by hand alone, and is idempotent', () => {
    const walls = room();
    const hand = {
      id: 'h', type: 'poly', name: 'Floor Slab', position: [3, 2.5, 2], tags: ['architecture', 'floor-slab'],
      args: { vertices: [[-2, -1], [2, -1], [2, 1], [-2, 1]], height: 0.2, holes: [] },
    } as unknown as Shape;
    const shapes = [...walls, hand];
    expect(alignSlabsToWalls(shapes)).toBe(shapes);

    const built = buildCeilingSlabForRoom(walls, 0.2)!;
    const withBuilt = [...walls, built];
    expect(alignSlabsToWalls(withBuilt)).toBe(withBuilt);
  });
});
