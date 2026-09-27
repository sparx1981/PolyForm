import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { singleSidedGeometry } from './edgeLines';

describe('singleSidedGeometry', () => {
  it('stops a double-sided flat quad drawing its diagonal', () => {
    const a = [0, 0, 0], b = [1, 0, 0], c = [1, 0, 1], d = [0, 0, 1];
    // Two triangles, each also stored reversed (as the roof builder does).
    const tris = [a, b, c, a, c, b, a, c, d, a, d, c].flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
    const lines = (geo: THREE.BufferGeometry) => new THREE.EdgesGeometry(geo, 15).getAttribute('position').count / 2;
    expect(lines(g)).toBeGreaterThan(4);
    expect(lines(singleSidedGeometry(g))).toBe(4);
  });
});
