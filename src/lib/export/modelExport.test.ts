import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { buildExportScene, collectModelItems, exportFileName } from './modelExport';

const box = () => new THREE.BoxGeometry(1, 1, 1);
const standard = () => new THREE.MeshStandardMaterial({ color: '#888888' });

/** A viewport-like scene: the model plus everything that isn't the model. */
function viewportScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.GridHelper(10, 10));
  scene.add(new THREE.AmbientLight());

  // A plain shape, placed by its own position (how Viewport mounts shapes).
  const wall = new THREE.Mesh(box(), standard());
  wall.position.set(5, 0, 0);
  wall.userData = { isShape: true, id: 'wall-1' };
  scene.add(wall);

  // A shape built as a group with a part inside it, the group moved and turned.
  const tree = new THREE.Group();
  tree.userData = { isShape: true, id: 'tree-1' };
  tree.position.set(0, 0, 3);
  tree.rotation.y = Math.PI / 2;
  const trunk = new THREE.Mesh(box(), standard());
  trunk.position.set(1, 0, 0);
  tree.add(trunk);
  // A wireframe highlight inside a shape isn't part of it.
  tree.add(new THREE.Mesh(box(), new THREE.MeshBasicMaterial({ wireframe: true })));
  scene.add(tree);

  // Drawn geometry sits at the origin, tagged by KernelGeometry.
  const kernelGroup = new THREE.Group();
  const drawn = new THREE.Mesh(box(), standard());
  drawn.userData = { isKernelGeometry: true, faceOfTriangle: [] };
  kernelGroup.add(drawn);
  scene.add(kernelGroup);

  // A light's gizmo carries an id too.
  const gizmo = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial());
  gizmo.userData = { id: 'light-1', type: 'light' };
  scene.add(gizmo);

  // A hidden shape.
  const hidden = new THREE.Mesh(box(), standard());
  hidden.userData = { isShape: true, id: 'hidden-1' };
  hidden.visible = false;
  scene.add(hidden);

  // An untagged tool preview.
  scene.add(new THREE.Mesh(box(), standard()));

  // Batched trees: two copies, one collapsed (hidden by the batch).
  const trees = new THREE.InstancedMesh(box(), standard(), 3);
  trees.count = 3;
  trees.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 0, 0));
  trees.setMatrixAt(1, new THREE.Matrix4().makeTranslation(12, 0, 0));
  trees.setMatrixAt(2, new THREE.Matrix4().makeScale(0, 0, 0));
  trees.userData = { plantIds: ['a', 'b', 'c'] };
  scene.add(trees);

  // Its shadow-only stand-in, and grass.
  const proxyMaterial = standard();
  proxyMaterial.colorWrite = false;
  const proxy = new THREE.InstancedMesh(box(), proxyMaterial, 1);
  proxy.userData = { plantIds: ['a'] };
  scene.add(proxy);
  const grass = new THREE.InstancedMesh(box(), standard(), 1);
  grass.userData = { isGrass: true };
  scene.add(grass);

  return scene;
}

describe('collectModelItems', () => {
  it('takes the model and leaves the grid, lights, previews, grass and hidden things', () => {
    const items = collectModelItems(viewportScene(), id => (id === 'wall-1' ? 'North wall' : undefined));
    expect(items.map(i => i.name).sort()).toEqual(['Drawn geometry', 'North wall', 'Plant', 'tree-1']);
    expect(items.find(i => i.name === 'North wall')?.ownerId).toBe('wall-1');
    expect(items.some(i => i.ownerId === 'light-1' || i.ownerId === 'hidden-1')).toBe(false);
  });

  it('places each piece at its world position once, not its local position on top', () => {
    const items = collectModelItems(viewportScene());
    const wall = items.find(i => i.ownerId === 'wall-1')!;
    expect(new THREE.Vector3().setFromMatrixPosition(wall.matrices[0]).toArray()).toEqual([5, 0, 0]);

    // The trunk: 1 m along the group's x, which the group turned to point along -z, at z = 3.
    const trunk = items.find(i => i.ownerId === 'tree-1')!;
    const p = new THREE.Vector3().setFromMatrixPosition(trunk.matrices[0]);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(2);
  });

  it('expands batched trees into their visible copies', () => {
    const trees = collectModelItems(viewportScene()).filter(i => i.instanced);
    expect(trees).toHaveLength(1);
    expect(trees[0].matrices.map(m => new THREE.Vector3().setFromMatrixPosition(m).x)).toEqual([10, 12]);
  });
});

describe('buildExportScene', () => {
  it('exports geometry where it sits in the viewport (the old export doubled it)', () => {
    const exportScene = buildExportScene(collectModelItems(viewportScene()));
    const wall = exportScene.children.find(c => c.name === 'wall-1')!;
    const bounds = new THREE.Box3().setFromObject(wall);
    expect(bounds.min.x).toBeCloseTo(4.5);
    expect(bounds.max.x).toBeCloseTo(5.5);
  });

  it('includes drawn geometry in STL output', () => {
    const scene = new THREE.Scene();
    const drawn = new THREE.Mesh(box(), standard());
    drawn.userData = { isKernelGeometry: true, faceOfTriangle: [] };
    scene.add(drawn);
    const stl = new STLExporter().parse(buildExportScene(collectModelItems(scene)), { binary: true }) as DataView;
    expect(stl.getUint32(80, true)).toBe(12); // a box: 12 triangles
  });
});

describe('exportFileName', () => {
  it('names the file after the model', () => {
    expect(exportFileName('My House', 'skp')).toBe('My House.skp');
    expect(exportFileName('a/b:c', 'stl')).toBe('a-b-c.stl');
    expect(exportFileName(null, 'gltf')).toBe('Model.gltf');
  });
});
