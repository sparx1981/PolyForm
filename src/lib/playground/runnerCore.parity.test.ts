// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DeveloperSDK } from '../../services/developerService';
import type { Shape } from '../../types';
import { createLocalRunner, type PlaygroundObject } from './runnerCore';

const runPreview = createLocalRunner();

function runReal(code: string): Shape[] {
  let shapes: Shape[] = [];
  const setShapes = (next: Shape[] | ((prev: Shape[]) => Shape[])) => {
    shapes = typeof next === 'function' ? next(shapes) : next;
  };
  const updateShapeColor = (id: string, color: string) => {
    const index = shapes.findIndex(shape => shape.id === id);
    if (index >= 0) shapes.splice(index, 1, { ...shapes[index]!, color });
  };
  const sdk = new DeveloperSDK(shapes, setShapes, updateShapeColor, null, { onLog: vi.fn() });
  new Function('sdk', code)(sdk);
  return shapes;
}

function visual(shape: Shape): Omit<PlaygroundObject, 'id'> {
  const rotationY = shape.rotation?.[1] ?? 0;
  const color = shape.color ?? '#ffffff';

  if (shape.type === 'cylinder') {
    const args = shape.args as number[];
    return {
      kind: 'cylinder',
      position: [...shape.position] as [number, number, number],
      size: [args[1]!, args[2]!, args[0]!],
      rotationY,
      color,
    };
  }

  if (shape.type === 'sphere') {
    const radius = (shape.args as number[])[0]!;
    return {
      kind: 'sphere',
      position: [...shape.position] as [number, number, number],
      size: [radius, radius, radius],
      rotationY,
      color,
    };
  }

  if (shape.type === 'roof') {
    const data = shape.customData ?? {};
    const baseWidth = Number(data.width ?? (shape.args as number[])[0] ?? 0);
    const baseDepth = Number(data.depth ?? (shape.args as number[])[2] ?? 0);
    const ridge = Number(data.ridgeHeight ?? (shape.args as number[])[1] ?? 0);
    const overhang = Number(data.eaveOverhang ?? 0);
    const roofType = (data.roofType ?? 'gable') as 'gable' | 'hip' | 'parapet';
    return {
      kind: 'roof',
      roofType,
      position: [shape.position[0], shape.position[1] + Math.max(0.05, ridge) / 2, shape.position[2]],
      size: [
        roofType === 'parapet' ? baseWidth : baseWidth + overhang * 2,
        Math.max(0.05, ridge),
        roofType === 'parapet' ? baseDepth : baseDepth + overhang * 2,
      ],
      rotationY,
      color,
    };
  }

  const args = shape.args as number[];
  let size: [number, number, number] = [args[0]!, args[1]!, args[2]!];
  let normalizedRotation = rotationY;

  // The room preview represents its east/west walls as an equivalent axis-aligned box,
  // while the real model stores the same geometry as a wall rotated 90 degrees.
  if (shape.type === 'wall' && Math.abs(Math.abs(rotationY) - Math.PI / 2) < 1e-8) {
    size = [args[2]!, args[1]!, args[0]!];
    normalizedRotation = 0;
  }

  return {
    kind: 'box',
    position: [...shape.position] as [number, number, number],
    size,
    rotationY: normalizedRotation,
    color,
  };
}

function previewVisuals(objects: PlaygroundObject[]) {
  return objects.map(({ id: _id, ...rest }) => rest);
}

describe('Developers-page preview ↔ real DeveloperSDK parity', () => {
  it.each([
    ['default box origin', `sdk.createBox({ width: 2, height: 3, depth: 4 });`],
    ['positioned box', `sdk.createBox({ width: 1.2, height: 0.4, depth: 5, position: [3, -1, 2] });`],
    ['default cylinder origin', `sdk.createCylinder({ radius: 0.4, height: 2.5 });`],
    ['tapered cylinder', `sdk.createCylinder({ radius: 0.6, radiusTop: 0.2, height: 3, position: [-2, 1, 4] });`],
    ['default sphere origin', `sdk.createSphere({ radius: 1.25 });`],
    ['positioned sphere', `sdk.createSphere({ radius: 0.35, position: [4, 2, -3] });`],
  ])('%s', async (_name, code) => {
    const real = runReal(code).map(visual);
    const preview = await runPreview(code);
    expect(preview.ok).toBe(true);
    expect(previewVisuals(preview.objects)).toEqual(real);
  });

  it.each([0.25, 2, 4.75])('pushPull amount %s matches real SDK height and position', async amount => {
    const code = `const b = sdk.createBox({ width: 2, height: 1, depth: 3, position: [1, 0, -2] }); sdk.pushPull(b, ${amount});`;
    const real = runReal(code).map(visual);
    const preview = await runPreview(code);
    expect(previewVisuals(preview.objects)).toEqual(real);
  });

  it.each([
    {
      name: 'default floor',
      args: `{ width: 6, length: 4, height: 2.8 }`,
    },
    {
      name: 'offset room with ceiling',
      args: `{ width: 8, length: 5, height: 3.2, wallThickness: 0.3, position: [10, 0.4, -3], includeCeiling: true, wallColor: '#eee8dd', floorColor: '#665544', ceilingColor: '#fafafa' }`,
    },
    {
      name: 'walls only',
      args: `{ width: 3.5, length: 7, height: 2.4, wallThickness: 0.12, includeFloor: false }`,
    },
  ])('createRoom: $name', async ({ args }) => {
    const code = `sdk.architecture.createRoom(${args});`;
    const real = runReal(code).map(visual);
    const preview = await runPreview(code);
    expect(preview.ok).toBe(true);
    expect(previewVisuals(preview.objects)).toEqual(real);
  });

  it.each([
    `{ start: [0, 0, 0], end: [3, 0, 4], height: 2.6, thickness: 0.18, color: '#ddeeff' }`,
    `{ start: [1, 0.5, -2], end: [4, 1.5, 2], height: 2.2, thickness: 0.14 }`,
    `{ length: 4.5, height: 3, thickness: 0.25, position: [2, 1.5, -1], rotation: [0, 0.4, 0] }`,
  ])('createWall matches preview for %s', async args => {
    const code = `sdk.architecture.createWall(${args});`;
    const real = runReal(code).map(visual);
    const preview = await runPreview(code);
    expect(previewVisuals(preview.objects)).toEqual(real);
  });

  it.each([
    `{ width: 6, depth: 4 }`,
    `{ roofType: 'hip', width: 8, depth: 5, pitchAngleDeg: 28, eaveOverhang: 0.55, position: [2, 3.1, -4], color: '#884422' }`,
    `{ roofType: 'gable', width: 3, depth: 7, pitchAngleDeg: 50, eaveOverhang: 0 }`,
    `{ roofType: 'parapet', width: 5, depth: 5, pitchAngleDeg: 20, position: [-3, 2.8, 1] }`,
  ])('createRoof matches real SDK dimensions, placement and defaults for %s', async args => {
    const code = `sdk.architecture.createRoof(${args});`;
    const real = runReal(code).map(visual);
    const preview = await runPreview(code);
    expect(preview.ok).toBe(true);
    expect(previewVisuals(preview.objects)).toEqual(real);
  });
});
