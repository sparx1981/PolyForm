import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  activeSection, clippingPlaneOf, dragDistance, dropCutAway, flipSection, isSectionShape, moveSection,
  sectionOnFace, setSectionPickPlane, type SectionArgs,
} from './sectionPlanes';
import type { Shape } from '../types';

const section = (over: Partial<SectionArgs> = {}): SectionArgs =>
  ({ kind: 'section', point: [0, 0, 0], normal: [0, 0, 1], active: true, size: 4, ...over });

describe('section planes', () => {
  it('is a section, not a guide or a measurement', () => {
    expect(isSectionShape({ type: 'measurement', args: section() })).toBe(true);
    expect(isSectionShape({ type: 'measurement', args: { kind: 'guide' } })).toBe(false);
  });

  it('keeps the side away from the camera when placed on a face', () => {
    // A wall facing +z, looked at from z = 10.
    const s = sectionOnFace(new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 2, 10), 5);
    expect(s.normal).toEqual([0, 0, -1]);
    const plane = clippingPlaneOf(s);
    expect(plane.distanceToPoint(new THREE.Vector3(0, 0, -3))).toBeGreaterThan(0); // behind the wall: kept
    expect(plane.distanceToPoint(new THREE.Vector3(0, 0, 3))).toBeLessThan(0);    // in front: cut away
  });

  it('lines up with an axis when the face is nearly square to it', () => {
    const s = sectionOnFace(new THREE.Vector3(), new THREE.Vector3(0.02, 0.9998, 0).normalize(), new THREE.Vector3(0, 10, 0), 5);
    expect(s.normal).toEqual([0, -1, 0]);
  });

  it('flips and moves', () => {
    expect(flipSection(section()).normal).toEqual([0, 0, -1]);
    expect(moveSection(section(), 2).point).toEqual([0, 0, 2]);
  });

  it('only one active section counts, and a hidden one does not cut', () => {
    const shapes = [
      { id: 'a', type: 'measurement', args: section({ active: false }) },
      { id: 'b', type: 'measurement', args: section(), hidden: true },
      { id: 'c', type: 'measurement', args: section() },
    ] as unknown as Shape[];
    expect(activeSection(shapes)?.id).toBe('c');
  });

  it('measures a drag along the normal from the pointer ray', () => {
    const ray = new THREE.Ray(new THREE.Vector3(10, 3, 0), new THREE.Vector3(-1, 0, 0));
    expect(dragDistance(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), ray)).toBeCloseTo(3, 9);
  });
});

describe('picking through a cut', () => {
  afterEach(() => setSectionPickPlane(null));

  function wallsScene(plane: THREE.Plane) {
    const scene = new THREE.Scene();
    const near = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    near.position.z = 2;           // cut away (z > 0 with the kept side towards -z)
    const far = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    far.position.z = -2;           // kept
    for (const m of [near, far]) (m.material as THREE.Material).clippingPlanes = [plane];
    const helper = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    helper.position.z = 3;         // not clipped (a gizmo, say): still hit
    scene.add(near, far, helper);
    scene.updateMatrixWorld(true);
    return { scene, near, far, helper };
  }

  it('drops hits on the cut-away part of clipped objects only', () => {
    const plane = clippingPlaneOf(section({ normal: [0, 0, -1] }));
    const { scene, far, helper } = wallsScene(plane);
    const ray = new THREE.Raycaster(new THREE.Vector3(0.3, 0.7, 10), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObjects(scene.children, true);
    expect(dropCutAway(hits, plane).map(h => h.object)).toEqual([helper, far]);
  });

  it('filters every raycast while a section is active, and none after', () => {
    const plane = clippingPlaneOf(section({ normal: [0, 0, -1] }));
    const { scene, near, far, helper } = wallsScene(plane);
    const ray = new THREE.Raycaster(new THREE.Vector3(0.3, 0.7, 10), new THREE.Vector3(0, 0, -1));
    setSectionPickPlane(plane);
    expect(ray.intersectObjects(scene.children, true).map(h => h.object)).toEqual([helper, far]);
    expect(ray.intersectObject(near).length).toBe(0);
    setSectionPickPlane(null);
    expect(ray.intersectObjects(scene.children, true).map(h => h.object)).toEqual([helper, near, far]);
  });
});
