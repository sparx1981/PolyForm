// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { buildTextShape, editTextShape, textQuaternion } from './textShapes';
import { textGeometry } from '../components/TextMesh';
import { DeveloperSDK } from '../services/developerService';
import { commandReproducesStep } from './macroVerify';
import { captureKernelState } from './geometry/graphPatch';
import { createGraph } from './geometry/topology';
import type { Shape } from '../types';

const axes = (q: [number, number, number, number]) => {
  const quat = new THREE.Quaternion(...q);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(quat);
  return { x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) };
};
const close = (a: THREE.Vector3, b: [number, number, number]) => expect(a.distanceTo(new THREE.Vector3(...b))).toBeLessThan(1e-6);
const font = new FontLoader().parse(JSON.parse(readFileSync(resolve(__dirname, '../assets/fonts/helvetiker_regular.typeface.json'), 'utf8')));

describe('text placement', () => {
  it('lays a flat label on the ground, reading the right way up from where you stand', () => {
    // Viewer to the south (+Z), looking north: letters run east (+X), tops point north (-Z).
    const a = axes(textQuaternion('text', [0, 1, 0], [0, 5, 10]));
    close(a.z, [0, 1, 0]);
    close(a.x, [1, 0, 0]);
    close(a.y, [0, 0, -1]);
  });

  it('puts a flat label on a wall upright, facing out of it', () => {
    const a = axes(textQuaternion('text', [1, 0, 0], [5, 1, 0]));
    close(a.z, [1, 0, 0]);
    close(a.y, [0, 1, 0]);
  });

  it('stands 3D letters up facing the viewer on the ground, and out of a wall', () => {
    const ground = axes(textQuaternion('text3d', [0, 1, 0], [0, 5, 10]));
    close(ground.y, [0, 1, 0]);
    close(ground.z, [0, 0, 1]);
    const wall = axes(textQuaternion('text3d', [-1, 0, 0], [5, 1, 3]));
    close(wall.z, [-1, 0, 0]);
    close(wall.y, [0, 1, 0]);
  });

  it('keeps the words and settings, not geometry, and refuses empty text', () => {
    const s = buildTextShape('text3d', { text: '  Garage ', position: [1, 0, 2], size: 0.4, depth: 0.05 });
    expect(s.type).toBe('text3d');
    expect(s.textData).toEqual({ text: 'Garage', size: 0.4, depth: 0.05, align: 'center', bold: false });
    expect(s.geometryData).toBeUndefined();
    expect(() => buildTextShape('text', { text: '  ', position: [0, 0, 0] })).toThrow();
    const e = editTextShape(s, { text: 'Workshop', size: 0.6 });
    expect(e.name).toBe('3D Text "Workshop"');
    expect(e.args).toEqual([0.6, 0.05]);
  });
});

describe('text geometry', () => {
  it('centres a label on its point and stands 3D letters on theirs, the given height tall', () => {
    const flat = textGeometry(font, buildTextShape('text', { text: 'Kitchen', position: [0, 0, 0], size: 0.5 }))!;
    const box = flat.boundingBox!;
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(1e-6);
    expect(Math.abs(box.min.y + box.max.y)).toBeLessThan(1e-6);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.3);
    expect(box.max.z - box.min.z).toBe(0);
    const solid = textGeometry(font, buildTextShape('text3d', { text: 'HI', position: [0, 0, 0], size: 1, depth: 0.2 }))!;
    solid.computeBoundingBox();
    expect(solid.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(solid.boundingBox!.max.z).toBeGreaterThanOrEqual(0.2);
  });

  it('aligns left and right on the point', () => {
    const left = textGeometry(font, buildTextShape('text', { text: 'Left', position: [0, 0, 0], align: 'left' }))!;
    expect(left.boundingBox!.min.x).toBeCloseTo(0, 6);
    const right = textGeometry(font, buildTextShape('text', { text: 'Right', position: [0, 0, 0], align: 'right' }))!;
    expect(right.boundingBox!.max.x).toBeCloseTo(0, 6);
  });
});

describe('sdk.text', () => {
  it('adds labels and 3D letters, edits them, and the Text tool\'s recorded command replays exactly', () => {
    let shapes: Shape[] = [];
    const logs: string[] = [];
    const sdk = new DeveloperSDK(shapes, (n: any) => { shapes = typeof n === 'function' ? n(shapes) : n; }, vi.fn(), null, { onLog: (l: string) => logs.push(l) });
    const label = sdk.text.add({ text: 'Lounge', position: [2, 0, 3] });
    const sign = sdk.text.add3D({ text: 'No. 12', position: [0, 0, 5], towardsViewer: [0, 0, 1], id: 'sign' });
    expect(shapes.map(s => s.type)).toEqual(['text', 'text3d']);
    sdk.text.edit(label.id, { text: 'Living room', bold: true });
    expect(shapes[0]!.textData).toMatchObject({ text: 'Living room', bold: true });
    sdk.text.edit('nope', { text: 'x' });
    expect(logs.some(l => l.includes('no text object'))).toBe(true);

    // As TextPlacementDialog records it: the options, plus the exact id, position and orientation.
    const placed = buildTextShape('text', { text: 'Hall', position: [1, 0, 1], normal: [0, 1, 0], towardsViewer: [3, 4, 5], size: 0.25 });
    const code = `sdk.text.add(${JSON.stringify({ text: 'Hall', size: 0.25, bold: false, id: placed.id, quaternion: placed.quaternion, position: placed.position })});`;
    const kernel = captureKernelState(createGraph());
    expect(commandReproducesStep(code, { shapesBefore: [sign], shapesAfter: [sign, placed], kernelBefore: kernel, kernelAfter: kernel })).toBe(true);
  });
});
