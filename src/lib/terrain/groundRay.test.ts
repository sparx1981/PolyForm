import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundUnderRay } from './groundRay';

describe('groundUnderRay', () => {
  it('lands exactly under the cursor on a slope', () => {
    const slope = (x: number) => x * 0.3;
    const ray = new THREE.Ray(new THREE.Vector3(-20, 15, 0), new THREE.Vector3(1, -0.6, 0.2).normalize());
    const hit = groundUnderRay(ray, slope)!;
    expect(Math.abs(hit.y - slope(hit.x))).toBeLessThan(1e-6);
    // The hit is on the ray itself (what the user pointed at).
    expect(ray.distanceToPoint(hit)).toBeLessThan(1e-3);
  });

  it('falls back to the ground plane when the ray misses the height field', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 1, 0));
    expect(groundUnderRay(ray, () => 0)).toBeNull();
    const down = new THREE.Ray(new THREE.Vector3(3, 10, 4), new THREE.Vector3(0, -1, 0));
    expect(groundUnderRay(down, () => 2)!.toArray()).toEqual([3, 2, 4]);
  });
});
