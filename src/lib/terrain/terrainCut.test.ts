import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cutTerrainUnderFootprints } from './terrainCut';

function terrain(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(10, 10, 10, 10);
  g.rotateX(-Math.PI / 2);
  // A gentle slope, so heights must be interpolated.
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getX(i) * 0.1);
  g.computeVertexNormals();
  return g;
}

function upArea(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    expect(n.y).toBeGreaterThan(0); // still facing up
    total += Math.abs(n.y) / 2; // plan area
  }
  return total;
}

describe('cutTerrainUnderFootprints', () => {
  it('removes exactly the footprint, curved edge included', () => {
    const circle: [number, number][] = Array.from({ length: 48 }, (_, i) => [Math.cos(i / 48 * Math.PI * 2) * 2.3, Math.sin(i / 48 * Math.PI * 2) * 2.3]);
    const circleArea = 0.5 * 48 * 2.3 * 2.3 * Math.sin(Math.PI * 2 / 48);
    const cut = cutTerrainUnderFootprints(terrain(), [circle]);
    expect(upArea(cut)).toBeCloseTo(100 - circleArea, 3);
    // Nothing is left inside.
    const pos = cut.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      const mx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, mz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      expect(Math.hypot(mx, mz)).toBeGreaterThan(2.2);
    }
  });

  it('keeps the ground on its slope at new points', () => {
    const cut = cutTerrainUnderFootprints(terrain(), [[[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]]);
    const pos = cut.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(pos.getX(i) * 0.1, 5);
    expect(cut.getAttribute('uv')).toBeDefined();
  });

  it('leaves the terrain alone when there is nothing to cut', () => {
    const g = terrain();
    expect(cutTerrainUnderFootprints(g, [])).toBe(g);
    expect(cutTerrainUnderFootprints(g, [[[20, 20], [21, 20], [21, 21]]])).toBe(g);
  });
});
