import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HEAVY_TRIANGLES, customTriangleCount, isHeavyCustomShape, prepareHeavyGeometry } from './heavyMesh';

describe('customTriangleCount', () => {
  it('reads a stored BufferGeometry without building it', () => {
    const g = new THREE.BufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
    expect(customTriangleCount(g.toJSON())).toBe(12);
  });
  it('reads the plain array form', () => {
    expect(customTriangleCount({ positions: new Array(27).fill(0) })).toBe(3);
    expect(customTriangleCount({ positions: new Array(12).fill(0), indices: [0, 1, 2, 0, 2, 3] })).toBe(2);
  });
  it('is zero for nothing', () => {
    expect(customTriangleCount(undefined)).toBe(0);
    expect(customTriangleCount({})).toBe(0);
  });
});

describe('isHeavyCustomShape', () => {
  it('flags only custom shapes with a very large mesh', () => {
    const big = { positions: [], indices: new Array((HEAVY_TRIANGLES + 1) * 3).fill(0) };
    expect(isHeavyCustomShape({ type: 'custom', geometryData: big })).toBe(true);
    expect(isHeavyCustomShape({ type: 'box', geometryData: big })).toBe(false);
    expect(isHeavyCustomShape({ type: 'custom', geometryData: new THREE.BufferGeometry().copy(new THREE.BoxGeometry()).toJSON() })).toBe(false);
  });
});

describe('prepareHeavyGeometry', () => {
  it('leaves a heavy mesh unpickable until its tree exists, then picks it', async () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    const cancel = prepareHeavyGeometry(mesh.geometry);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(mesh)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mesh.geometry.boundsTree).toBeDefined();
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
    cancel();
    expect(mesh.geometry.boundsTree).toBeUndefined();
    // An ordinary mesh is untouched.
    const plain = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    expect(ray.intersectObject(plain).length).toBeGreaterThan(0);
  });
});
