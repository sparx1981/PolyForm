import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KernelArcHost } from './kernelArcHost';
import { commitKernelPushPull } from './kernelPushPull';
import {
  applyGroupEdit, componentDefinitions, explodeGroup, extractFaces, isGroupShape, makeGroup, makeUnique,
  shapeMatrix, transformSerializedGraph,
} from './kernelGroups';
import { paintFace } from './kernelSelection';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, loopPoints } from '../lib/geometry/topology';
import { deserializeGraph, type SerializedGraph } from '../lib/geometry/serialize';
import type { FaceId, Graph } from '../lib/geometry/types';
import type { Shape } from '../types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });

/** A 2 x 1 x 1 box standing on the ground at x 3..5, z 0..1. */
function box(h: KernelArcHost) {
  const p = [vec3(3, 0, 0), vec3(5, 0, 0), vec3(5, 0, 1), vec3(3, 0, 1)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i + 1) % 4]!);
  const base = [...h.graph.faces.keys()][0]!;
  commitKernelPushPull(h, base, 1);
  return [...h.graph.faces.keys()];
}

const bounds = (g: Graph) => {
  const b = new THREE.Box3();
  for (const v of g.vertices.values()) b.expandByPoint(new THREE.Vector3(v.position.x, v.position.y, v.position.z));
  return b;
};

describe('makeGroup', () => {
  it('takes the faces out of the drawing into an object placed where they were', () => {
    const h = host();
    const faces = box(h);
    expect(faces).toHaveLength(6);
    paintFace(h.graph, faces[0]! as FaceId, '#ff0000');
    const made = makeGroup(h, faces as FaceId[], { component: false, name: 'Box' })!;
    expect(h.graph.faces.size).toBe(0);
    expect(isGroupShape(made.shape)).toBe(true);
    expect(made.shape.position).toEqual([4, 0, 0.5]); // middle of the footprint, at the bottom

    const local = deserializeGraph(made.shape.kernelGraph as SerializedGraph);
    expect(checkIntegrity(local)).toEqual([]);
    expect(local.faces.size).toBe(6);
    expect([...local.faces.values()].some(f => f.attributes.materialFront === '#ff0000')).toBe(true);
    const lb = bounds(local);
    expect(lb.min.toArray()).toEqual([-1, 0, -0.5]);
    expect(lb.max.toArray()).toEqual([1, 1, 0.5]);
    // The link records what to put back on undo.
    expect(made.link.wallIds).toEqual([made.shape.id]);
    expect(made.link.removed).toHaveLength(6);
  });

  it('keeps only the chosen faces', () => {
    const h = host();
    const faces = box(h);
    const data = extractFaces(h.graph, [faces[0]! as FaceId]);
    expect(data.faces).toHaveLength(1);
    expect(data.edges).toHaveLength(4);
  });
});

describe('transformSerializedGraph', () => {
  it('moves and turns points, face planes and arcs together', () => {
    const h = host();
    box(h);
    const data = extractFaces(h.graph, h.graph.faces.keys());
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 0);
    const moved = deserializeGraph(transformSerializedGraph(data, m));
    expect(checkIntegrity(moved)).toEqual([]);
    for (const f of moved.faces.values()) {
      // Every face's plane still passes through its own corners.
      for (const p of loopPoints(moved, f.outerLoop)) {
        const d = (p.x - f.plane.point.x) * f.plane.normal.x + (p.y - f.plane.point.y) * f.plane.normal.y + (p.z - f.plane.point.z) * f.plane.normal.z;
        expect(Math.abs(d)).toBeLessThan(1e-9);
      }
    }
    const b = bounds(moved);
    expect(b.min.x).toBeCloseTo(10, 9);
    expect(b.max.x).toBeCloseTo(11, 9);
    expect(b.min.z).toBeCloseTo(-5, 9);
  });
});

describe('explodeGroup', () => {
  it('puts the faces back where the object now sits, with their paint', () => {
    const h = host();
    const faces = box(h);
    paintFace(h.graph, faces[0]! as FaceId, '#00ff00');
    const made = makeGroup(h, faces as FaceId[], { component: false, name: 'Box' })!;
    const moved = { ...made.shape, position: [0, 2, 0] } as Shape;
    const link = explodeGroup(h, moved)!;
    expect(link.goneIds).toEqual([moved.id]);
    expect(h.graph.faces.size).toBe(6);
    expect(checkIntegrity(h.graph)).toEqual([]);
    const b = bounds(h.graph);
    expect(b.min.toArray()).toEqual([-1, 2, -0.5]);
    expect([...h.graph.faces.values()].some(f => f.attributes.materialFront === '#00ff00')).toBe(true);
  });
});

describe('components', () => {
  const shape = (id: string, componentId?: string, graph: unknown = { v: 1 }) =>
    ({ id, type: 'kernel_group', position: [0, 0, 0], kernelGraph: graph, componentId, componentName: 'Chair', args: {} } as unknown as Shape);

  it('editing one copy edits every copy of that component, and nothing else', () => {
    const shapes = [shape('a', 'c1'), shape('b', 'c1'), shape('c', 'c2'), shape('d')];
    const next = applyGroupEdit(shapes, shapes[0]!, { v: 2 } as unknown as SerializedGraph);
    expect(next.map(s => (s.kernelGraph as { v: number }).v)).toEqual([2, 2, 1, 1]);
    // A plain group edits only itself.
    expect(applyGroupEdit(shapes, shapes[3]!, { v: 3 } as unknown as SerializedGraph).map(s => (s.kernelGraph as { v: number }).v)).toEqual([1, 1, 1, 3]);
  });

  it('Make Unique splits a copy off', () => {
    const [a, b] = [shape('a', 'c1'), shape('b', 'c1')];
    const unique = makeUnique(b);
    expect(unique.componentId).not.toBe('c1');
    expect(applyGroupEdit([a, unique], a, { v: 9 } as unknown as SerializedGraph).map(s => (s.kernelGraph as { v: number }).v)).toEqual([9, 1]);
  });

  it('lists each definition once with its number of copies', () => {
    const defs = componentDefinitions([shape('a', 'c1'), shape('b', 'c1'), shape('c', 'c2'), shape('d')]);
    expect(defs.map(d => [d.componentId, d.count])).toEqual([['c1', 2], ['c2', 1]]);
  });

  it('places a copy through its own position, rotation and scale', () => {
    const m = shapeMatrix({ position: [1, 2, 3], rotation: [0, Math.PI, 0], scale: [2, 2, 2] });
    const p = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(-1, 9);
    expect(p.y).toBeCloseTo(2, 9);
  });
});
