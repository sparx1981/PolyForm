import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { describeSkpError, mergeImportedGroup } from './skpService';

describe('describeSkpError', () => {
  it('explains memory failures and what to do about them', () => {
    expect(describeSkpError(new RangeError('Array buffer allocation failed'))).toMatch(/ran out of memory/);
    expect(describeSkpError(new Error('Invalid array length'))).toMatch(/Purge Unused/);
  });
  it('keeps the real reason for other failures', () => {
    expect(describeSkpError(new Error('bad header'))).toMatch(/bad header/);
  });
});

describe('mergeImportedGroup', () => {
  it('joins meshes into one world-space geometry, expanding indexed meshes', () => {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const group = new THREE.Group();
    const a = new THREE.Mesh(quad);
    const b = new THREE.Mesh(quad);
    b.position.set(10, 0, 0);
    group.add(a, b);
    const merged = mergeImportedGroup(group);
    expect(merged.attributes.position.count).toBe(12);
    expect(merged.attributes.normal.count).toBe(12);
    expect(merged.attributes.position.getX(6)).toBeCloseTo(10);
    expect(merged.attributes.normal.getZ(0)).toBeCloseTo(1);
  });

  it('keeps a mirrored copy facing outwards', () => {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const mesh = new THREE.Mesh(tri);
    mesh.scale.set(-1, 1, 1);
    const group = new THREE.Group();
    group.add(mesh);
    const merged = mergeImportedGroup(group);
    const p = (i: number) => new THREE.Vector3().fromBufferAttribute(merged.attributes.position, i);
    const faceNormal = new THREE.Triangle(p(0), p(1), p(2)).getNormal(new THREE.Vector3());
    expect(faceNormal.z).toBeGreaterThan(0.99);
  });

  it('refuses a file with no meshes', () => {
    expect(() => mergeImportedGroup(new THREE.Group())).toThrow(/No mesh geometry/);
  });
});
