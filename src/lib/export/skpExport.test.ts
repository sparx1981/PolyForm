import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildScene, SkpFile } from 'openskp';
import { KernelSession, vec3 } from '../geometry';
import { SkpService } from '../../services/skpService';
import { collectModelItems, type ExportItem } from './modelExport';
import { buildSkp, facesFromKernel, facesFromMesh, toSkpMatrix3, toSkpPoint } from './skpExport';

const standard = (color = '#cc3333') => new THREE.MeshStandardMaterial({ color });

function readBack(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return { scene: buildScene(buffer), model: new SkpFile(buffer).parse() };
}

function item(geometry: THREE.BufferGeometry, matrices: THREE.Matrix4[], extra: Partial<ExportItem> = {}): ExportItem {
  return { ownerId: 'shape', name: 'Shape', geometry, material: standard(), matrices, instanced: false, ...extra };
}

describe('axes and units', () => {
  it('turns metres, y up into inches, z up', () => {
    expect(toSkpPoint(1, 2, 3)).toEqual([39.370079, -118.110236, 78.740157]);
  });

  it('re-expresses a rotation in SketchUp axes', () => {
    // A quarter turn about PolyForm's up (y) is a quarter turn about SketchUp's up (z).
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const r = toSkpMatrix3(m);
    const p = new THREE.Vector3(1, 0, 0).applyMatrix4(m); // PolyForm: +x -> -z
    const skp = toSkpPoint(p.x, p.y, p.z).map(v => v / 39.37007874015748);
    // Row-major r times SketchUp's +x.
    expect([r[0], r[3], r[6]].map(v => Math.round(v))).toEqual(skp.map(v => Math.round(v)));
  });
});

describe('facesFromMesh', () => {
  it('stitches a box back into six faces', () => {
    const faces = facesFromMesh(new THREE.BoxGeometry(1, 2, 3), new THREE.Matrix4());
    expect(faces).toHaveLength(6);
    expect(faces.every(f => f.outer.length === 4 && !f.curved)).toBe(true);
  });

  it('merges a subdivided plane into one face', () => {
    const faces = facesFromMesh(new THREE.PlaneGeometry(2, 2, 4, 4), new THREE.Matrix4());
    expect(faces).toHaveLength(1);
    expect(faces[0].outer).toHaveLength(4);
  });

  it('keeps a hole in a flat shape', () => {
    const outline = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(4, 0), new THREE.Vector2(4, 4), new THREE.Vector2(0, 4)]);
    outline.holes.push(new THREE.Path([new THREE.Vector2(1, 1), new THREE.Vector2(1, 2), new THREE.Vector2(2, 2), new THREE.Vector2(2, 1)]));
    const faces = facesFromMesh(new THREE.ShapeGeometry(outline), new THREE.Matrix4());
    expect(faces).toHaveLength(1);
    expect(faces[0].holes).toHaveLength(1);
  });

  it('writes a double-sided surface once', () => {
    const g = new THREE.PlaneGeometry(1, 1);
    const index = Array.from(g.getIndex()!.array);
    const back = [];
    for (let i = 0; i < index.length; i += 3) back.push(index[i], index[i + 2], index[i + 1]);
    g.setIndex([...index, ...back]);
    expect(facesFromMesh(g, new THREE.Matrix4())).toHaveLength(1);
  });

  it('marks smooth-shaded surfaces as curved', () => {
    const faces = facesFromMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.Matrix4());
    expect(faces.length).toBeGreaterThan(50);
    expect(faces.every(f => f.curved)).toBe(true);
  });
});

describe('buildSkp', () => {
  it('writes a file SketchUp-format readers open, with everything where it was', () => {
    const geometry = new THREE.BoxGeometry(2, 1, 1);
    const at = new THREE.Matrix4().makeTranslation(5, 0.5, -3);
    const result = buildSkp([item(geometry, [at], { name: 'North wall' })]);
    expect(result.faces).toBe(6);
    expect(result.skipped).toBe(0);

    const { scene, model } = readBack(result.bytes);
    // The reader hands back metres, y up - so the round trip should land exactly where we started.
    expect(scene.bounds!.min.map(v => +v.toFixed(3))).toEqual([4, 0, -3.5]);
    expect(scene.bounds!.max.map(v => +v.toFixed(3))).toEqual([6, 1, -2.5]);
    expect(JSON.stringify(model)).toContain('North wall');
    expect(model.materials.some(m => m.name === '#cc3333')).toBe(true);
  });

  it('writes drawn faces straight from the geometry engine, holes included', () => {
    const s = new KernelSession();
    s.drawChain([vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 4), vec3(0, 0, 4), vec3(0, 0, 0)]);
    s.drawChain([vec3(1, 0, 1), vec3(2, 0, 1), vec3(2, 0, 2), vec3(1, 0, 2), vec3(1, 0, 1)]);
    const faceIds = [...s.graph.faces.keys()];
    expect(faceIds).toHaveLength(2); // the ring and the square inside it
    expect(facesFromKernel(s.graph, faceIds, new THREE.Matrix4()).map(f => f.holes.length).sort()).toEqual([0, 1]);

    const drawn = item(new THREE.BufferGeometry(), [new THREE.Matrix4()], { ownerId: null, kernelFaceOfTriangle: faceIds });
    const result = buildSkp([drawn], s.graph);
    expect(result.faces).toBe(2);

    const { scene } = readBack(result.bytes);
    expect(scene.bounds!.min.map(v => +v.toFixed(3))).toEqual([0, 0, 0]);
    expect(scene.bounds!.max.map(v => +v.toFixed(3))).toEqual([4, 0, 4]);
  });

  it('writes a batch as one component placed once per copy', () => {
    const turn = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const matrices = [
      new THREE.Matrix4().makeTranslation(10, 0, 0),
      new THREE.Matrix4().makeTranslation(0, 0, 10).multiply(turn),
      new THREE.Matrix4().makeTranslation(-10, 0, 0).multiply(new THREE.Matrix4().makeScale(2, 2, 2)),
    ];
    const geometry = new THREE.BoxGeometry(2, 1, 1).translate(1, 0.5, 0);
    const result = buildSkp([item(geometry, matrices, { instanced: true, name: 'Plant', ownerId: null })]);
    expect(result.faces).toBe(6); // stored once

    // Same bounds as three.js gives for the same copies.
    const expected = new THREE.Box3();
    geometry.computeBoundingBox();
    matrices.forEach(m => expected.union(geometry.boundingBox!.clone().applyMatrix4(m)));
    const { scene } = readBack(result.bytes);
    expect(scene.bounds!.min.map(v => +v.toFixed(3))).toEqual(expected.min.toArray().map(v => +v.toFixed(3)));
    expect(scene.bounds!.max.map(v => +v.toFixed(3))).toEqual(expected.max.toArray().map(v => +v.toFixed(3)));
  });

  it('exports a whole viewport-style scene end to end', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.GridHelper(10, 10));
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standard());
    wall.position.set(3, 0.5, 0);
    wall.userData = { isShape: true, id: 'w' };
    scene.add(wall);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), standard('#3366cc'));
    dome.userData = { isShape: true, id: 'd' };
    scene.add(dome);

    const result = buildSkp(collectModelItems(scene));
    expect(result.skipped).toBe(0);
    const { scene: back } = readBack(result.bytes);
    expect(back.bounds!.min.map(v => +v.toFixed(2))).toEqual([-1, -1, -1]);
    expect(back.bounds!.max.map(v => +v.toFixed(2))).toEqual([3.5, 1, 1]);
  });

  it("opens again with PolyForm's own SketchUp import", async () => {
    const at = new THREE.Matrix4().makeTranslation(3, 0.5, 0);
    const { bytes } = buildSkp([item(new THREE.BoxGeometry(2, 1, 1), [at])]);
    const file = {
      name: 'model.skp',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as File;
    const bounds = new THREE.Box3().setFromObject(await SkpService.importSKP(file));
    expect(bounds.min.toArray().map(v => +v.toFixed(3))).toEqual([2, 0, -0.5]);
    expect(bounds.max.toArray().map(v => +v.toFixed(3))).toEqual([4, 1, 0.5]);
  });
});
