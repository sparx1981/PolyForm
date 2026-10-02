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
  const quadGeometry = () => {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    return quad;
  };

  it('joins meshes into one world-space geometry, keeping vertices shared', () => {
    const group = new THREE.Group();
    const a = new THREE.Mesh(quadGeometry());
    const b = new THREE.Mesh(quadGeometry());
    b.position.set(10, 0, 0);
    group.add(a, b);
    const merged = mergeImportedGroup(group);
    expect(merged.attributes.position.count).toBe(8);
    expect(merged.attributes.normal.count).toBe(8);
    expect(merged.index!.count).toBe(12);
    expect(merged.attributes.position.getX(4)).toBeCloseTo(10);
    expect(merged.attributes.normal.getZ(0)).toBeCloseTo(1);
    // The second quad's triangles point at the second quad's vertices.
    expect(Math.min(...Array.from(merged.index!.array).slice(6))).toBe(4);
  });

  it('keeps each material colour as a vertex colour', () => {
    const group = new THREE.Group();
    const red = new THREE.Mesh(quadGeometry(), new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 0, 0) }));
    const green = new THREE.Mesh(quadGeometry(), new THREE.MeshStandardMaterial({ color: new THREE.Color(0, 1, 0) }));
    group.add(red, green);
    const merged = mergeImportedGroup(group);
    const colors = merged.attributes.color;
    expect([colors.getX(0), colors.getY(0), colors.getZ(0)]).toEqual([1, 0, 0]);
    expect([colors.getX(4), colors.getY(4), colors.getZ(4)]).toEqual([0, 1, 0]);
  });

  it('keeps a mirrored copy facing outwards', () => {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const mesh = new THREE.Mesh(tri);
    mesh.scale.set(-1, 1, 1);
    const group = new THREE.Group();
    group.add(mesh);
    const merged = mergeImportedGroup(group);
    const p = (i: number) => new THREE.Vector3().fromBufferAttribute(merged.attributes.position, merged.index!.getX(i));
    const faceNormal = new THREE.Triangle(p(0), p(1), p(2)).getNormal(new THREE.Vector3());
    expect(faceNormal.z).toBeGreaterThan(0.99);
  });

  it('refuses a file with no meshes', () => {
    expect(() => mergeImportedGroup(new THREE.Group())).toThrow(/No mesh geometry/);
  });
});
