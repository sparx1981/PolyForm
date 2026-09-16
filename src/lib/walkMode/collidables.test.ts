import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { isWalkCollidable, collectCollidableMeshes } from './collidables';
import type { Shape } from '../../types';

function shape(overrides: Partial<Shape>): Shape {
  return {
    id: 'id',
    type: 'box',
    position: [0, 0, 0],
    args: [],
    color: '#fff',
    ...overrides,
  } as Shape;
}

describe('isWalkCollidable', () => {
  it('collides with architecture and landscape geometry', () => {
    const solidTypes = ['wall', 'window', 'step', 'staircase', 'roof', 'terrain', 'fence', 'railing', 'lamp', 'bench', 'rock', 'tree'] as const;
    for (const type of solidTypes) {
      expect(isWalkCollidable(shape({ type }))).toBe(true);
    }
  });

  it('collides with basic shapes and drawn/poly geometry, so anything drawn can be walked into, on, or jumped onto', () => {
    const solidTypes = ['box', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'cylinder', 'prism', 'rect', 'circle', 'triangle', 'line', 'poly', 'bezier', 'arc', 'custom'] as const;
    for (const type of solidTypes) {
      expect(isWalkCollidable(shape({ type }))).toBe(true);
    }
  });

  it('excludes doors so doorways are always walkable', () => {
    expect(isWalkCollidable(shape({ type: 'door' }))).toBe(false);
  });

  it('excludes small plants (bushes) but not trees', () => {
    expect(isWalkCollidable(shape({ type: 'bush' }))).toBe(false);
    expect(isWalkCollidable(shape({ type: 'tree' }))).toBe(true);
  });

  it('excludes scale-reference figures and dimension annotations', () => {
    expect(isWalkCollidable(shape({ type: 'scale_figure' }))).toBe(false);
    expect(isWalkCollidable(shape({ type: 'measurement' }))).toBe(false);
  });

  it('excludes hidden shapes even if their type is normally solid', () => {
    expect(isWalkCollidable(shape({ type: 'wall', hidden: true }))).toBe(false);
  });

  it('treats timber frame member data as collidable too (already covered by the default)', () => {
    expect(isWalkCollidable(shape({ type: 'box', timberMemberData: {} as any }))).toBe(true);
    expect(isWalkCollidable(shape({ type: 'box', timberFrame: {} as any }))).toBe(true);
  });
});

function boxMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
}

describe('collectCollidableMeshes', () => {
  it('collects kernel-drawn geometry (userData.isKernelGeometry) even though it is never a Shape', () => {
    // Kernel-drawn geometry (KernelGeometry.tsx) lives in a completely
    // separate system from Shape[] and is never tagged userData.isShape,
    // so it can't be found via the shapesById lookup the way ordinary
    // shapes are - it needs its own path, which this test guards.
    const scene = new THREE.Scene();
    const kernelFace = boxMesh();
    kernelFace.userData = { isKernelGeometry: true };
    scene.add(kernelFace);

    const result = collectCollidableMeshes(scene, new Map());
    expect(result).toContain(kernelFace);
  });

  it('collects an ordinary Shape mesh via userData.isShape/id', () => {
    const scene = new THREE.Scene();
    const mesh = boxMesh();
    mesh.userData = { isShape: true, id: 'wall-1' };
    scene.add(mesh);
    const shapesById = new Map<string, Shape>([['wall-1', shape({ id: 'wall-1', type: 'wall' })]]);

    const result = collectCollidableMeshes(scene, shapesById);
    expect(result).toContain(mesh);
  });

  it('ignores meshes that are neither a tagged Shape nor kernel geometry', () => {
    const scene = new THREE.Scene();
    const mesh = boxMesh();
    scene.add(mesh);

    const result = collectCollidableMeshes(scene, new Map());
    expect(result).not.toContain(mesh);
  });

  it('ignores an invisible kernel-geometry mesh', () => {
    const scene = new THREE.Scene();
    const mesh = boxMesh();
    mesh.userData = { isKernelGeometry: true };
    mesh.visible = false;
    scene.add(mesh);

    const result = collectCollidableMeshes(scene, new Map());
    expect(result).not.toContain(mesh);
  });
});
