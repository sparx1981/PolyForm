import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { configureLoupeCamera } from './loupe';
import { freezeQualityScene } from './qualitySnapshot';
describe('Presentation detail views', () => {
    it('crops a magnified perspective view around the same world point without changing the source', () => {
        const source = new THREE.PerspectiveCamera(50, 2, .1, 200);
        source.position.set(0, 0, 10);
        source.updateMatrixWorld();
        const before = source.projectionMatrix.clone(), copy = source.clone();
        configureLoupeCamera(source, copy, 800, 400, [.75, .5], 100, 2);
        expect(copy.view).toMatchObject({ offsetX: 550, offsetY: 150, width: 100, height: 100, fullWidth: 800, fullHeight: 400 });
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(.5, 0), source);
        const original = ray.ray.direction.clone();
        ray.setFromCamera(new THREE.Vector2(0, 0), copy);
        expect(ray.ray.direction.distanceTo(original)).toBeLessThan(1e-6);
        expect(source.projectionMatrix.equals(before)).toBe(true);
        expect(source.view).toBeNull();
    });
    it('preserves an existing split-view crop and supports orthographic magnification', () => {
        const source = new THREE.OrthographicCamera(-10, 10, 5, -5);
        source.setViewOffset(800, 400, 400, 0, 400, 400);
        const copy = source.clone();
        configureLoupeCamera(source, copy, 400, 400, [.5, .5], 80, 4);
        expect(copy.view).toMatchObject({ offsetX: 580, offsetY: 180, width: 40, height: 40, fullWidth: 800, fullHeight: 400 });
        expect(source.view?.width).toBe(400);
    });
    it('freezes transformed, tinted instances without sharing owned materials or altering the model', () => {
        const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ color: 'white' });
        const mesh = new THREE.InstancedMesh(geometry, material, 2);
        mesh.position.x = 5;
        mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, 0));
        mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
        mesh.setColorAt(0, new THREE.Color('red'));
        mesh.setColorAt(1, new THREE.Color('blue'));
        scene.add(mesh);
        const snapshot = freezeQualityScene(scene, new THREE.PerspectiveCamera());
        const copies = snapshot.scene.children as THREE.Mesh[];
        expect(copies).toHaveLength(2);
        expect(copies[0].matrix.elements[12]).toBe(6);
        expect(copies[1].matrix.elements[12]).toBe(7);
        expect((copies[0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
        expect((copies[1].material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x0000ff);
        expect(copies[0].geometry).not.toBe(geometry);
        expect(copies[0].material).not.toBe(material);
        snapshot.dispose();
        expect(material.color.getHex()).toBe(0xffffff);
    });
    it('rejects excessive instance geometry before allocating frozen meshes', () => {
        const scene = new THREE.Scene(), mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 200000);
        scene.add(mesh);
        expect(() => freezeQualityScene(scene, new THREE.PerspectiveCamera())).toThrow('geometry budget');
    });
    it('does not snapshot hidden geometry and rejects unconverted clipping planes', () => {
        const scene = new THREE.Scene(), hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
        hidden.visible = false;
        scene.add(hidden);
        const snapshot = freezeQualityScene(scene, new THREE.PerspectiveCamera());
        expect(snapshot.scene.children).toHaveLength(0);
        snapshot.dispose();
        hidden.visible = true;
        (hidden.material as THREE.MeshStandardMaterial).clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];
        expect(() => freezeQualityScene(scene, new THREE.PerspectiveCamera())).toThrow('uncut');
    });
});
