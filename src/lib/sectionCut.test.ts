import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SectionCut } from './sectionCut';
import { collectModelItems } from './export/modelExport';

function scene() {
  const s = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  wall.userData = { isShape: true, id: 'wall' };
  const drawn = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  drawn.userData = { isKernelGeometry: true, faceOfTriangle: [] };
  const trees = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
  trees.userData = { plantIds: ['a', 'b'] };
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
  s.add(wall, drawn, trees, grid);
  return { s, wall, drawn, trees, grid };
}

describe('SectionCut', () => {
  it('clips the model, fills what it cuts, and leaves helpers alone', () => {
    const { s, wall, drawn, trees, grid } = scene();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const cut = new SectionCut();
    cut.apply(s, plane);
    for (const m of [wall, drawn, trees]) expect((m.material as THREE.Material).clippingPlanes).toEqual([plane]);
    expect((grid.material as THREE.Material).clippingPlanes).toBeFalsy();
    // A dark fill inside each cut object - not the batched trees.
    expect(wall.children.filter(c => c.userData.isSectionCap)).toHaveLength(1);
    expect(drawn.children.filter(c => c.userData.isSectionCap)).toHaveLength(1);
    expect(trees.children).toHaveLength(0);
    // Applying again doesn't add more.
    cut.apply(s, plane);
    expect(wall.children).toHaveLength(1);
    // The fill is never exported as part of the model.
    expect(collectModelItems(s).filter(i => i.material === cut.capMaterial)).toHaveLength(0);
  });

  it('puts everything back', () => {
    const { s, wall } = scene();
    const cut = new SectionCut();
    cut.apply(s, new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));
    cut.clear();
    expect((wall.material as THREE.Material).clippingPlanes).toBeNull();
    expect(wall.children).toHaveLength(0);
  });

  it('drops the fill of an object that has gone', () => {
    const { s, wall } = scene();
    const cut = new SectionCut();
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    cut.apply(s, plane);
    s.remove(wall);
    cut.apply(s, plane);
    expect(wall.children).toHaveLength(0);
  });

  it('leaves exempt layers whole, and cuts them again when they are no longer exempt', () => {
    const { s, wall, drawn } = scene();
    const ground = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 5), new THREE.MeshStandardMaterial());
    ground.userData = { isShape: true, id: 'ground' };
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial());
    overlay.userData = { sectionLayer: 'overlay' };
    s.add(ground, overlay);
    const layerOf = (m: THREE.Mesh) => (m === ground ? 'ground' : 'design');
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const cut = new SectionCut();

    cut.apply(s, plane, layerOf, new Set(['ground', 'overlay']));
    expect((ground.material as THREE.Material).clippingPlanes).toBeFalsy();
    expect(ground.children.filter(c => c.userData.isSectionCap)).toHaveLength(0);
    expect((overlay.material as THREE.Material).clippingPlanes).toBeFalsy();
    expect((wall.material as THREE.Material).clippingPlanes).toEqual([plane]);
    expect((drawn.material as THREE.Material).clippingPlanes).toEqual([plane]);

    // The overlay is cut too when it is not exempt, but never gets a fill.
    cut.apply(s, plane, layerOf, new Set(['ground']));
    expect((overlay.material as THREE.Material).clippingPlanes).toEqual([plane]);
    expect(overlay.children).toHaveLength(0);

    // Un-exempting the ground cuts it; exempting it again puts it back.
    cut.apply(s, plane, layerOf, new Set());
    expect((ground.material as THREE.Material).clippingPlanes).toEqual([plane]);
    cut.apply(s, plane, layerOf, new Set(['ground']));
    expect((ground.material as THREE.Material).clippingPlanes).toBeFalsy();
    expect(ground.children.filter(c => c.userData.isSectionCap)).toHaveLength(0); // its fill goes too
  });
});
