// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DeveloperSDK } from './developerService';
import { buildFence, buildPatio, buildWaterBody } from '../lib/siteBuilders';
import { KernelArcHost } from '../tools/kernelArcHost';
import { commitKernelPushPull } from '../tools/kernelPushPull';
import { commitKernelFaceOffset } from '../tools/kernelFaceOffset';
import { captureKernelState, diffKernelStates } from '../lib/geometry/graphPatch';
import type { Shape } from '../types';
import { detectRooms } from '../lib/spatial/rooms';
import { planRoomFurnishing } from '../lib/interiors/smartFurnish';
import { bakeSemanticSimulation } from '../lib/interiors/bakeSimulation';
import { createInteriorFurnitureShape } from '../lib/interiors/parametricFurniture';

function makeSdk(initialShapes: Shape[] = [], host?: KernelArcHost) {
  let shapes = initialShapes;
  const sdk = new DeveloperSDK(
    shapes,
    (next: Shape[] | ((prev: Shape[]) => Shape[])) => {
      shapes = typeof next === 'function' ? next(shapes) : next;
    },
    vi.fn(),
    null,
    host ? { kernelHost: host, bumpKernel: vi.fn(), onLog: vi.fn() } : { onLog: vi.fn() },
  );
  return { sdk, get shapes() { return shapes; } };
}

function expectSameKernel(a: KernelArcHost, b: KernelArcHost) {
  expect(diffKernelStates(captureKernelState(a.graph), captureKernelState(b.graph))).toBeNull();
}

describe('Developer SDK ↔ in-app tool parity', () => {
  describe('landscape shared builders', () => {
    it.each([
      {
        name: 'open picket fence',
        points: [[0, 0], [6, 0], [8, 2]] as [number, number][],
        options: { id: 'fence-a', name: 'Fence A', style: 'picket' as const, height: 1.05, color: '#765432', finish: 'painted', seed: 2 },
      },
      {
        name: 'closed close-board fence',
        points: [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][],
        options: { id: 'fence-b', name: 'Fence B', style: 'close-board' as const, height: 1.8, closed: true, color: '#334455', seed: 11 },
      },
      {
        name: 'post-and-rail fence at default height',
        points: [[-3, -1], [0, 2], [4, 3]] as [number, number][],
        options: { id: 'fence-c', name: 'Fence C', style: 'post-rail' as const, seed: 7 },
      },
    ])('$name matches the Fence tool builder exactly', ({ points, options }) => {
      const expected = buildFence([], points, options);
      const h = makeSdk();
      const actual = h.sdk.landscape.addFence(points, options);
      expect(actual).toEqual(expected);
      expect(h.shapes).toEqual([expected]);
    });

    it.each([
      {
        name: 'ordinary still pond',
        points: [[0, 0], [5, 0], [5, 3], [0, 3]] as [number, number][],
        options: { id: 'water-a', name: 'Water A', depth: 0.8, clarity: 'clear', level: 0.12 },
      },
      {
        name: 'directional stream',
        points: [[0, 0], [12, 0], [12, 2], [0, 2]] as [number, number][],
        options: {
          id: 'water-b',
          name: 'Water B',
          depth: 0.55,
          clarity: 'clear',
          level: 0.25,
          flow: { mode: 'stream' as const, direction: [1, 0.25] as [number, number], speed: 0.7, turbulence: 0.35 },
        },
      },
      {
        name: 'large lake outline',
        points: [[0, 0], [45, 0], [45, 35], [0, 35]] as [number, number][],
        options: { id: 'water-c', name: 'Water C', depth: 2.4, clarity: 'lake', level: -0.05 },
      },
    ])('$name matches the Water tool builder exactly', ({ points, options }) => {
      const expected = buildWaterBody([], points, options);
      const h = makeSdk();
      const actual = h.sdk.landscape.addPond(points, options);
      expect(actual).toEqual(expected);
      expect(h.shapes).toEqual([expected]);
    });

    it.each([
      {
        name: 'plain patio',
        points: [[0, 0], [4, 0], [4, 3], [0, 3]] as [number, number][],
        options: { id: 'patio-a', name: 'Patio A', kind: 'patio' as const, level: 0.08 },
      },
      {
        name: 'raised deck',
        points: [[10, 0], [15, 0], [15, 4], [10, 4]] as [number, number][],
        options: { id: 'patio-b', name: 'Deck B', kind: 'deck' as const, level: 0.62 },
      },
      {
        name: 'curved-edge patio with custom settings',
        points: [[-5, -2], [-1, -2], [-1, 2], [-5, 2]] as [number, number][],
        options: {
          id: 'patio-c',
          name: 'Patio C',
          kind: 'patio' as const,
          level: 0.14,
          bulges: [0.2, 0, -0.15, 0],
          settings: { kerb: false, paving: 'porcelain' as const },
        },
      },
    ])('$name matches the Patio tool builder exactly', ({ points, options }) => {
      const expected = buildPatio([], points, options);
      const h = makeSdk();
      const actual = h.sdk.landscape.addPatio(points, options);
      expect(actual).toEqual(expected);
      expect(h.shapes).toEqual([expected]);
    });
  });


  describe('Interior Studio shared planning and simulation', () => {
    const wall = (id: string, x: number, z: number, length: number, rotationY = 0): Shape => ({
      id,
      type: 'wall',
      position: [x, 1.4, z],
      rotation: [0, rotationY, 0],
      args: [length, 2.8, 0.2],
      color: '#fff',
    });

    const roomShapes = (): Shape[] => [
      wall('north', 0, -5, 10),
      wall('south', 0, 5, 10),
      wall('west', -5, 0, 10, Math.PI / 2),
      wall('east', 5, 0, 10, Math.PI / 2),
    ];

    const withoutGeneratedId = (shape: Shape) => {
      const { id: _id, ...rest } = shape;
      return rest;
    };

    it.each(['bedroom', 'living-room', 'soft-furnishings', 'storage', 'minimal'] as const)(
      'furnishRoom(%s) matches Interior Studio planning',
      preset => {
        const shapes = roomShapes();
        const room = detectRooms(shapes)[0]!;
        const expected = planRoomFurnishing(shapes, room, preset);
        const h = makeSdk(shapes);
        const actual = h.sdk.interiors.furnishRoom(room.id, preset);

        expect(actual.unplaced).toEqual(expected.unplaced);
        expect(actual.shapes.map(withoutGeneratedId)).toEqual(expected.shapes.map(withoutGeneratedId));
        expect(h.shapes.slice(shapes.length).map(withoutGeneratedId)).toEqual(expected.shapes.map(withoutGeneratedId));
      },
    );

    it.each([
      ['sofa', 0],
      ['sofa', 0.42],
      ['sofa', 1],
      ['curtain', 0.32],
      ['curtain', 0.75],
      ['curtain', 1.5],
    ] as const)('bakeSimulation(%s, %s) matches Interior Studio settling', (type, strength) => {
      const source = createInteriorFurnitureShape(type, { id: 'fixture', position: [1, 0, 2] });
      const expected = bakeSemanticSimulation(source, strength);
      const h = makeSdk([source]);
      const actual = h.sdk.interiors.bakeSimulation('fixture', strength);

      // Both paths stamp the bake time independently. Geometry and all behavioural metadata
      // must otherwise be identical; compare the timestamp separately as a valid finite value.
      const expectedBake = expected.customData?.simulationBake;
      const actualBake = actual.customData?.simulationBake;
      expect(actualBake?.type).toBe(expectedBake?.type);
      expect(actualBake?.strength).toBe(expectedBake?.strength);
      expect(Number.isFinite(actualBake?.bakedAt)).toBe(true);

      const stripBakeTime = (shape: Shape): Shape => ({
        ...shape,
        customData: {
          ...shape.customData,
          simulationBake: shape.customData?.simulationBake
            ? { ...shape.customData.simulationBake, bakedAt: 0 }
            : undefined,
        },
      });
      expect(stripBakeTime(actual)).toEqual(stripBakeTime(expected));
      expect(stripBakeTime(h.shapes[0]!)).toEqual(stripBakeTime(expected));
    });
  });

  describe('kernel tool commits', () => {
    it.each([0.25, 1.5, -0.4])(
      'sdk.drawing.pushPull(%s) matches the Push/Pull tool commit',
      distance => {
        const uiHost = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
        const sdkHost = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
        const uiSetup = makeSdk([], uiHost);
        const sdkSetup = makeSdk([], sdkHost);

        const uiFaces = uiSetup.sdk.drawing.shape([[0, 0, 0], [3, 0, 0], [3, 0, 2], [0, 0, 2]]);
        const sdkFaces = sdkSetup.sdk.drawing.shape([[0, 0, 0], [3, 0, 0], [3, 0, 2], [0, 0, 2]]);
        expect(uiFaces).toEqual(sdkFaces);

        const uiOk = commitKernelPushPull(uiHost, uiFaces[0]!, distance);
        const sdkOk = sdkSetup.sdk.drawing.pushPull(sdkFaces[0]!, distance);
        expect(sdkOk).toBe(uiOk);
        expectSameKernel(uiHost, sdkHost);
      },
    );

    it.each([-0.2, -0.75, 0.35])(
      'sdk.drawing.offset(%s) matches the Offset tool commit',
      distance => {
        const uiHost = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
        const sdkHost = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
        const uiSetup = makeSdk([], uiHost);
        const sdkSetup = makeSdk([], sdkHost);

        const uiFaces = uiSetup.sdk.drawing.shape([[0, 0, 0], [5, 0, 0], [5, 0, 4], [0, 0, 4]]);
        const sdkFaces = sdkSetup.sdk.drawing.shape([[0, 0, 0], [5, 0, 0], [5, 0, 4], [0, 0, 4]]);
        expect(uiFaces).toEqual(sdkFaces);

        const uiOk = commitKernelFaceOffset(uiHost, uiFaces[0]!, distance);
        const sdkOk = sdkSetup.sdk.drawing.offset(sdkFaces[0]!, distance);
        expect(sdkOk).toBe(uiOk);
        expectSameKernel(uiHost, sdkHost);
      },
    );
  });
});
