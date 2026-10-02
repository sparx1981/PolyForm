import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SkpService, importedGroupToShapes, splitImportedGroup } from './skpService';
import { buildSkp, definition, gridGeometry, instance, rec, translation } from '../lib/skp/testing/synthSkp';

const asFile = (buf: Buffer) => new File([new Uint8Array(buf)], 'site.skp');

/** A model of two sizeable named parts, three tiny ones and a loose floor. */
function siteModel() {
  const model = [
    rec('F901', [
      definition(1, 'Big slab', gridGeometry(40, 40)),
      definition(2, 'Garden wall', gridGeometry(40, 40)),
      definition(3, 'Pebble', gridGeometry(1, 1)),
      definition(4, 'Floor', gridGeometry(2, 2)),
    ]),
    rec('F601', [
      instance(1, translation(0, 0, 0), { name: 'Main slab' }),
      instance(2, translation(2000, 0, 0)),
      instance(3, translation(10, 10, 0), { name: 'Pebble A' }),
      instance(3, translation(30, 10, 0), { name: 'Pebble B' }),
      instance(3, translation(50, 10, 0), { name: 'Pebble C' }),
    ]),
  ];
  return buildSkp({ model });
}

describe('splitting an imported model into its groups and components', () => {
  it('gives each sizeable placed component its own part, with its SketchUp name, and batches the tiny ones', async () => {
    const scene = await SkpService.importSKP(asFile(siteModel()));
    const parts = splitImportedGroup(scene);
    const names = parts.map((p) => p.name);
    expect(names).toContain('Main slab');
    expect(names).toContain('Garden wall');
    expect(names.filter((n) => n.startsWith('Small parts'))).toHaveLength(1);
    // The three pebbles are one batch; the two slabs stay separate.
    const batch = parts.find((p) => p.name.startsWith('Small parts'))!;
    expect(batch.meshes.length).toBeGreaterThanOrEqual(3);
    expect(parts.find((p) => p.name === 'Main slab')!.triangles).toBeGreaterThan(3000);
  });

  it('turns the parts into custom shapes centred on themselves, together covering the whole model', async () => {
    const scene = await SkpService.importSKP(asFile(siteModel()));
    const { shapes, triangles } = await importedGroupToShapes(scene);
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    expect(shapes.every((s) => s.type === 'custom')).toBe(true);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(shapes.length);
    const total = shapes.reduce((n, s) => {
      const g = new THREE.BufferGeometryLoader().parse(s.geometryData);
      g.computeBoundingBox();
      // Each part's geometry is centred on its own origin, and the shape sits where the part is.
      const c = g.boundingBox!.getCenter(new THREE.Vector3());
      expect(Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z)).toBeLessThan(1e-3);
      return n + (g.index ? g.index.count : g.attributes.position.count) / 3;
    }, 0);
    expect(total).toBeCloseTo(triangles, 0);
    expect(shapes.every((s) => s.customData.skpImport.triangles === Math.round(triangles))).toBe(true);
    const wall = shapes.find((s) => s.name === 'Garden wall')!;
    const slab = shapes.find((s) => s.name === 'Main slab')!;
    // The wall was placed 2000 SketchUp inches (50.8 m) from the slab.
    expect(Math.abs(wall.position[0] - slab.position[0])).toBeGreaterThan(40);
  });

  it('reports progress part by part', async () => {
    const scene = await SkpService.importSKP(asFile(siteModel()));
    const seen: Array<[number, number]> = [];
    await importedGroupToShapes(scene, (done, total) => seen.push([done, total]));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0][0]).toBe(0);
  });

  it('refuses a model with nothing to draw', async () => {
    await expect(importedGroupToShapes(new THREE.Group())).rejects.toThrow(/No mesh geometry/);
  });
});
