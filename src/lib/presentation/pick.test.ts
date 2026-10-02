import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isSeenSurface } from './camera';

/** A ray hit on a mesh with the given material (or materials); `index` is the material the ray struck. */
function hit(material: THREE.Material | THREE.Material[], index = 0, setup?: (mesh: THREE.Mesh) => void): THREE.Intersection {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  setup?.(mesh);
  return { distance: 1, point: new THREE.Vector3(), object: mesh, face: { a: 0, b: 1, c: 2, normal: new THREE.Vector3(), materialIndex: index } };
}

describe('focus picking only lands on surfaces the viewer can see', () => {
  it('accepts solid surfaces, including a lightly transparent one that still writes depth', () => {
    expect(isSeenSurface(hit(new THREE.MeshStandardMaterial()))).toBe(true);
    expect(isSeenSurface(hit(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.6 })))).toBe(true);
  });
  it('skips what never reaches the depth buffer: glow, haze, glass, invisible occluders and section planes', () => {
    const glow = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
    const occluder = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const hidden = new THREE.MeshBasicMaterial(); hidden.visible = false;
    for (const m of [glow, occluder, hidden, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })]) expect(isSeenSurface(hit(m))).toBe(false);
  });
  it('skips the inside of the sky dome', () => {
    expect(isSeenSurface(hit(new THREE.MeshBasicMaterial({ side: THREE.BackSide })))).toBe(false);
  });
  it('judges a door or window by the material struck: its frame is solid, its glass is not', () => {
    const frame = new THREE.MeshStandardMaterial();
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2, depthWrite: false });
    expect(isSeenSurface(hit([frame, glass], 0))).toBe(true);
    expect(isSeenSurface(hit([frame, glass], 1))).toBe(false);
  });
  it('skips hidden objects, presentation helpers, grass and previews, even when their material is solid', () => {
    const solid = new THREE.MeshStandardMaterial();
    expect(isSeenSurface(hit(solid, 0, m => { m.visible = false; }))).toBe(false);
    expect(isSeenSurface(hit(solid, 0, m => { m.userData.presentationAux = true; }))).toBe(false);
    expect(isSeenSurface(hit(solid, 0, m => { m.userData.isGrass = true; }))).toBe(false);
    expect(isSeenSurface(hit(solid, 0, m => { m.userData.isPreview = true; }))).toBe(false);
    const parent = new THREE.Group(); parent.userData.presentationAux = true;
    expect(isSeenSurface(hit(solid, 0, m => parent.add(m)))).toBe(false);
  });
  it('skips things that are not meshes', () => {
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    expect(isSeenSurface({ distance: 1, point: new THREE.Vector3(), object: line })).toBe(false);
  });
});
