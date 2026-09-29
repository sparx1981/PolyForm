import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SectionCut } from './sectionCut';
import { sectionLook } from '../tools/sectionPlanes';
import type { Shape } from '../types';

function sceneWithEdges() {
  const scene = new THREE.Scene();
  const owner = new THREE.Group();
  owner.userData = { isShape: true, id: 'wall-1' };
  const material = new THREE.LineBasicMaterial({ color: '#1a1a1a', opacity: 0.8, transparent: true });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), material);
  owner.add(lines);
  scene.add(owner);
  return { scene, owner, lines, material };
}
const plane = () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ghostsOf = (owner: THREE.Object3D) => owner.children.filter(c => c.userData.isSectionGhost) as THREE.LineSegments[];

describe('SectionCut edge lines', () => {
  it('clips the lines to the kept side and draws a ghost on the cut-away side in the x-ray style', () => {
    const { scene, owner, material } = sceneWithEdges();
    const cut = new SectionCut();
    const p = plane();
    cut.apply(scene, p, { color: '#ff0000', opacity: 0.3 });

    expect(material.clippingPlanes).toEqual([p]);
    const [ghost] = ghostsOf(owner);
    expect(ghost).toBeDefined();
    const gm = ghost.material as THREE.LineBasicMaterial;
    expect(gm).not.toBe(material);
    const inverse = gm.clippingPlanes![0];
    expect(inverse.normal.z).toBe(-1);
    expect(gm.color.getHexString()).toBe('ff0000');
    expect(gm.opacity).toBeCloseTo(0.3);
    expect(ghost.visible).toBe(true);
    // The kept side is untouched.
    expect(material.color.getHexString()).toBe('1a1a1a');
    expect(material.opacity).toBeCloseTo(0.8);
  });

  it('follows the edge-line style when no x-ray style is set, hides at opacity 0, and updates in place', () => {
    const { scene, owner, material } = sceneWithEdges();
    const cut = new SectionCut();
    const p = plane();
    cut.apply(scene, p);
    let ghost = ghostsOf(owner)[0];
    expect((ghost.material as THREE.LineBasicMaterial).color.getHexString()).toBe('1a1a1a');
    expect((ghost.material as THREE.LineBasicMaterial).opacity).toBeCloseTo(0.8);

    cut.apply(scene, p, { opacity: 0 });
    expect(ghostsOf(owner)).toHaveLength(1); // reused, not duplicated
    ghost = ghostsOf(owner)[0];
    expect(ghost.visible).toBe(false);
    void material;
  });

  it('puts everything back on clear, and never cuts or duplicates its own ghosts', () => {
    const { scene, owner, material } = sceneWithEdges();
    const cut = new SectionCut();
    const p = plane();
    cut.apply(scene, p);
    cut.apply(scene, p);
    expect(ghostsOf(owner)).toHaveLength(1);
    cut.clear();
    expect(ghostsOf(owner)).toHaveLength(0);
    expect(material.clippingPlanes).toBeNull();
  });

  it('drops the ghost of a line that has left the scene', () => {
    const { scene, owner, lines } = sceneWithEdges();
    const cut = new SectionCut();
    const p = plane();
    cut.apply(scene, p);
    owner.remove(lines);
    cut.apply(scene, p);
    expect(ghostsOf(owner)).toHaveLength(0);
  });
});

describe('sectionLook', () => {
  const section = (args: object) => ({ id: 's', type: 'measurement', args: { kind: 'section', ...args } }) as unknown as Shape;
  it('is what the first existing plane has, so a new plane looks like the others', () => {
    expect(sectionLook([])).toEqual({});
    expect(sectionLook([section({ showPlane: false, xrayColor: '#00ff00', xrayOpacity: 0 })])).toEqual({ showPlane: false, xrayColor: '#00ff00', xrayOpacity: 0 });
    expect(sectionLook([section({})])).toEqual({});
  });
});
