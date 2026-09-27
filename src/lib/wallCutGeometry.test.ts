import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { boxFootprint, buildWallWithCuts } from './wallCutGeometry';
import { createWallWithOpeningsGeometry } from './archGeometry';

/** Area of the triangles facing `normal`. */
function areaFacing(g: THREE.BufferGeometry, normal: THREE.Vector3): number {
  const pos = g.getAttribute('position');
  let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.clone().normalize().dot(normal) > 0.999) total += n.length() / 2;
  }
  return total;
}

const edgeCount = (g: THREE.BufferGeometry) => new THREE.EdgesGeometry(g, 15).getAttribute('position').count / 2;

describe('buildWallWithCuts', () => {
  const window = { xMin: -0.5, xMax: 0.5, yMin: -0.3, yMax: 0.6 };

  it('draws edge lines only where the wall has edges: the box and the hole', () => {
    const g = buildWallWithCuts(boxFootprint(4, 0.2), 2.8, [window])!;
    // 12 box edges, the hole's 4 edges on each face, and its 4 edges through the wall.
    expect(edgeCount(g)).toBe(24);
  });

  it('leaves no stray lines where the old stacked boxes met', () => {
    const g = createWallWithOpeningsGeometry(4, 2.8, 0.2, [{ localX: 0, localY: 0.15, width: 1, height: 0.9 }]);
    expect(edgeCount(g)).toBe(24);
  });

  it('has the right face areas, facing the right way', () => {
    const g = buildWallWithCuts(boxFootprint(4, 0.2), 2.8, [window])!;
    const face = 4 * 2.8 - 1 * 0.9;
    expect(areaFacing(g, new THREE.Vector3(0, 0, 1))).toBeCloseTo(face);
    expect(areaFacing(g, new THREE.Vector3(0, 0, -1))).toBeCloseTo(face);
    // Sill (faces up) and head (faces down) inside the opening, plus the wall's top and bottom.
    expect(areaFacing(g, new THREE.Vector3(0, 1, 0))).toBeCloseTo(4 * 0.2 + 1 * 0.2);
    expect(areaFacing(g, new THREE.Vector3(0, -1, 0))).toBeCloseTo(4 * 0.2 + 1 * 0.2);
    // Reveals at each side.
    expect(areaFacing(g, new THREE.Vector3(1, 0, 0))).toBeCloseTo(0.2 * 2.8 + 0.2 * 0.9);
  });

  it('notches the bottom for a door', () => {
    const g = buildWallWithCuts(boxFootprint(4, 0.2), 2.8, [{ xMin: -0.45, xMax: 0.45, yMin: -1.4, yMax: 0.7 }])!;
    expect(areaFacing(g, new THREE.Vector3(0, -1, 0))).toBeCloseTo((4 - 0.9) * 0.2 + 0.9 * 0.2); // bottom less door + head
    expect(areaFacing(g, new THREE.Vector3(0, 0, 1))).toBeCloseTo(4 * 2.8 - 0.9 * 2.1);
  });

  it('cuts through a mitred end when the opening runs on into the next piece', () => {
    // A piece whose outer face runs a little past its inner face at the end (a curve's mitre).
    const fp: [number, number][] = [[-0.5, 0.15], [-0.48, -0.15], [0.48, -0.15], [0.5, 0.15]];
    const g = buildWallWithCuts(fp, 2.8, [{ xMin: 0.1, xMax: 2, yMin: -0.3, yMax: 0.6 }])!;
    // The end face at +x loses the opening's band.
    const endN = new THREE.Vector3(0.3, 0, -0.02).normalize();
    const end = areaFacing(g, endN);
    const endLen = Math.hypot(0.02, 0.3);
    expect(end).toBeCloseTo(endLen * (2.8 - 0.9), 3);
    // Only one reveal: at x = 0.1 (the other side is past the end).
    expect(areaFacing(g, new THREE.Vector3(1, 0, 0))).toBeCloseTo(0.3 * 0.9, 3);
  });

  it('refuses footprints it cannot build', () => {
    expect(buildWallWithCuts([[0, 0], [1, 0], [1, 1]], 2.8, [window])).toBeNull();
  });
});
