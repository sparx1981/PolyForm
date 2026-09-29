import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../types';
import { stairFootprintOnFloor, getArchFingerprint } from './timberFrameGenerator';

const stair = (yaw: number, style = 'straight'): Shape => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { id: 's', name: 'Staircase Flight', type: 'staircase', position: [5, 1.35, 3], quaternion: [q.x, q.y, q.z, q.w], args: [1.0, 2.7, 4.0, 15], stairStyle: style, tags: ['architecture', 'staircase'] } as unknown as Shape;
};
const extent = (poly: [number, number][]) => {
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) };
};

describe('stairFootprintOnFloor', () => {
  it('is long along Z for an unturned straight flight arriving at the floor', () => {
    const { w, d } = extent(stairFootprintOnFloor(stair(0), 2.7));
    expect(d).toBeGreaterThan(w * 3);
  });

  it('turns with the stair, so a quarter-turned flight is long along X', () => {
    const { w, d } = extent(stairFootprintOnFloor(stair(Math.PI / 2), 2.7));
    expect(w).toBeGreaterThan(d * 3);
  });

  it('turns a flight that starts on the floor too', () => {
    const { w, d } = extent(stairFootprintOnFloor(stair(Math.PI / 2), 0));
    expect(w).toBeGreaterThan(d * 3);
  });
});

describe('timber framing follows staircases', () => {
  const wall = { id: 'w', type: 'wall', position: [0, 1.2, 0], args: [6, 2.4, 0.2] } as unknown as Shape;

  it('is refreshed when a staircase is added, moved, turned, resized or removed', () => {
    const base = getArchFingerprint([wall]);
    const withStair = getArchFingerprint([wall, stair(0)]);
    expect(withStair).not.toBe(base);
    const moved = { ...stair(0), position: [5, 1.35, 3.5] } as Shape;
    expect(getArchFingerprint([wall, moved])).not.toBe(withStair);
    expect(getArchFingerprint([wall, stair(Math.PI / 2)])).not.toBe(withStair);
    const taller = { ...stair(0), args: [1.0, 3.0, 4.0, 15] } as Shape;
    expect(getArchFingerprint([wall, taller])).not.toBe(withStair);
    expect(getArchFingerprint([wall, stair(0)])).toBe(withStair); // unchanged stays unchanged
  });
});
