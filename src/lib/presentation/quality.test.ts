import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { PresentationEngine } from './engine';
import { DoorOpener } from './doors';
import { INITIAL_PRESENTATION, playBuild, playStages, presentation } from './store';
import { lookAt } from './classify';

describe('instanced timber presentation', () => {
  it('builds members individually, separates them when exploded, and restores their exact matrices', () => {
    const shapes: Shape[] = [-2, 2].map((x, i) => ({ id: `tf-${i}`, type: 'box', position: [x, 1.2, 0], args: [0.1, 2.4, 0.1], color: '#a70', tags: ['timber-frame'] }));
    const scene = new THREE.Scene();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
    const originals = shapes.map(s => new THREE.Matrix4().compose(new THREE.Vector3(...s.position), new THREE.Quaternion(), new THREE.Vector3(0.1, 2.4, 0.1)));
    originals.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.userData.presentationTimber = shapes.map(s => s.id);
    scene.add(mesh);
    const engine = new PresentationEngine(scene);
    engine.sync(shapes);
    const state = { ...INITIAL_PRESENTATION, active: true };
    const matrix = (i: number) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; };
    engine.update({ ...state, build: 0 }, 0.05);
    expect(matrix(0).determinant()).toBe(0);
    expect(matrix(1).determinant()).toBe(0);
    engine.update({ ...state, build: 0.4 }, 0.05);
    expect([matrix(0).determinant(), matrix(1).determinant()].filter(n => n > 0)).toHaveLength(1);
    for (let i = 0; i < 200; i++) engine.update({ ...state, explode: 1 }, 0.05);
    expect(matrix(0).elements[12]).toBeLessThan(-2);
    expect(matrix(1).elements[12]).toBeGreaterThan(2);
    const settled = matrix(0).elements.slice();
    for (let i = 0; i < 200; i++) engine.update({ ...state, explode: 1 }, 0.05);
    expect(matrix(0).elements).toEqual(settled); // periodic collection must not accumulate lift
    // An editor update replaces the matrix while presentation still owns an exploded pose.
    originals[0].setPosition(-4, 1.2, 0);
    mesh.setMatrixAt(0, originals[0]);
    engine.sync(shapes.map((s, i) => i === 0 ? { ...s, position: [-4, 1.2, 0] } : s));
    engine.update(state, 0.05);
    engine.dispose();
    originals.forEach((m, i) => m.elements.forEach((v, j) => expect(matrix(i).elements[j]).toBeCloseTo(v)));
  });
});

describe('door overlays', () => {
  it('hides closed-leaf outlines and material overlays, including late arrivals, then restores them', () => {
    const geometry = new THREE.BoxGeometry(0.8, 2, 0.04);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial());
    const ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2 }));
    mesh.add(edges, ghost);
    const doors = new DoorOpener();
    doors.toggle(mesh, { width: 0.9, height: 2.1 }, 'standard', new THREE.Vector3(0, 0, 2));
    doors.update(0.5);
    expect(edges.visible).toBe(false);
    expect(ghost.visible).toBe(false);
    const late = edges.clone(); late.visible = true; mesh.add(late);
    doors.update(0.5);
    expect(late.visible).toBe(false);
    doors.dispose();
    expect(mesh.geometry).toBe(geometry);
    expect([edges.visible, ghost.visible, late.visible]).toEqual([true, true, true]);
  });
});

describe('stage intent', () => {
  it('starts with open linework and becomes solid massing', () => {
    expect(lookAt(0).surfaceOpacity).toBe(0);
    expect(lookAt(0.5).surfaceOpacity).toBeCloseTo(0.5);
    expect(lookAt(1).surfaceOpacity).toBe(1);
  });
  it('plays build and stages independently without leftover hidden/exploded geometry', () => {
    presentation.set({ stage: 0, explode: 1, stagePlaying: true });
    playBuild();
    expect(presentation.get()).toMatchObject({ stage: 3, explode: 0, stagePlaying: false, buildPlaying: true });
    playStages();
    expect(presentation.get()).toMatchObject({ build: 1, buildPlaying: false, stage: 0, stagePlaying: true });
    presentation.reset(false);
  });
});
