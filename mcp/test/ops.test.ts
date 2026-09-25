import { describe, expect, it } from 'vitest';
import type { Shape } from '../../src/types';
import * as THREE from 'three';
import { carryHosted, fenceRun, openingInWall, patioOrDeck, summarize, transformShape, waterBody, withQuaternions, withSdk, withTerrainTexture } from '../src/ops';

const wallAlongX = (): Shape => withSdk([], sdk => sdk.architecture.createWall({ start: [0, 0, 0], end: [4, 0, 0], height: 2.8 })).created[0];

describe('building with the app scripting library', () => {
  it('makes a room of four walls and a floor', () => {
    const run = withSdk([], sdk => sdk.architecture.createRoom({ width: 5, length: 4 }));
    expect(run.created.map(s => s.type).sort()).toEqual(['box', 'wall', 'wall', 'wall', 'wall']);
  });

  it('makes a wall from start to end standing on the floor', () => {
    const wall = wallAlongX();
    expect(wall.args[0]).toBeCloseTo(4);
    expect(wall.position).toEqual([2, 1.4, 0]);
  });
});

describe('openings', () => {
  it('sets a door in the wall, bottom on the floor, where asked along it', () => {
    const door = openingInWall(wallAlongX(), 'door', { along: 1 });
    expect(door.position[0]).toBeCloseTo(1);
    expect(door.position[1]).toBeCloseTo(1.05);
    expect(door.position[2]).toBeCloseTo(0);
    expect(door.args).toEqual([0.9, 2.1, 0.2]);
    expect(door.hostWallId).toBeDefined();
  });

  it('puts a window at sill height and keeps it inside the wall', () => {
    const win = openingInWall(wallAlongX(), 'window', { along: 100, sill: 1 });
    expect(win.position[0]).toBeCloseTo(4 - 0.6);
    expect(win.position[1]).toBeCloseTo(1 + 0.6);
  });

  it('refuses openings bigger than the wall', () => {
    expect(() => openingInWall(wallAlongX(), 'door', { width: 5 })).toThrow(/wider than the wall/);
  });

  it('moves doors with their wall', () => {
    const wall = wallAlongX();
    const door = openingInWall(wall, 'door', { along: 1 });
    const moved = transformShape(wall, { offset: [0, 0, 3], rotateYDeg: 90 });
    const [, carried] = carryHosted(wall, moved, [moved, door]);
    // Wall centre (2, _, 0) → (2, _, 3); door was 1 m left of centre along x, now along -z... turned 90° about y.
    expect(carried.position[0]).toBeCloseTo(2);
    expect(carried.position[2]).toBeCloseTo(4);
  });
});

describe('landscape', () => {
  it('makes a fence run centred on its points', () => {
    const fence = fenceRun([], [[0, 0], [10, 0], [10, 5]], { style: 'picket', height: 1 });
    expect(fence.position).toEqual([20 / 3, 0, 5 / 3]);
    expect(fence.args[0]).toBeCloseTo(15);
    expect(fence.fenceData!.style).toBe('picket');
  });

  it('makes a pond at ground level when there is no terrain', () => {
    const pond = waterBody([], [[0, 0], [4, 0], [4, 3], [0, 3]], { depth: 1 });
    expect(pond.type).toBe('water');
    expect(pond.position[1]).toBeCloseTo(0.02);
  });

  it('sets a patio against a house level with its floor', () => {
    const room = withSdk([], sdk => sdk.architecture.createRoom({ width: 6, length: 6, position: [0, 0.3, 0] })).shapes;
    // North wall outer face is at z = 3.1; patio runs along it.
    const patio = patioOrDeck(room, [[-2, 3.1], [2, 3.1], [2, 6], [-2, 6]], { kind: 'patio' });
    expect(patio.position[1]).toBeCloseTo(0.3);
    expect(patio.patioData!.wallEdges![0]).toBe(true);
    expect(patio.patioData!.wallEdges![1]).toBe(false);
  });

  it('raises a free-standing deck above the ground', () => {
    const deck = patioOrDeck([], [[0, 0], [3, 0], [3, 3], [0, 3]], { kind: 'deck', deckHeight: 0.6 });
    expect(deck.position[1]).toBeCloseTo(0.6);
    expect(deck.patioData!.kind).toBe('deck');
  });
});

describe('summaries', () => {
  it('counts objects and totals', () => {
    const shapes = [
      ...withSdk([], sdk => sdk.architecture.createRoom({ width: 5, length: 4 })).shapes,
      patioOrDeck([], [[10, 0], [13, 0], [13, 2], [10, 2]], { kind: 'patio' }),
    ];
    const summary = summarize(shapes);
    expect(summary.byType.wall).toBe(4);
    expect(summary.totals.patioAreaM2).toBeCloseTo(6);
    expect(summary.totals.wallLengthM).toBeGreaterThan(15);
  });
});

describe('app compatibility', () => {
  it('gives scripted walls a quaternion so the app cuts openings where the doors are', () => {
    const [wall] = withQuaternions(withSdk([], sdk => sdk.architecture.createWall({ start: [1, 0, -4], end: [1, 0, 4] })).created);
    expect(wall.quaternion).toBeDefined();
    const door = openingInWall(wall, 'door', { along: 2 });
    // The app measures an opening along the wall with the wall's quaternion only.
    const local = new THREE.Vector3(...door.position).sub(new THREE.Vector3(...wall.position))
      .applyQuaternion(new THREE.Quaternion(...wall.quaternion!).invert());
    expect(local.x).toBeCloseTo(2 - 4);
    expect(local.z).toBeCloseTo(0);
  });

  it('paints terrain with a built-in texture instead of an unregistered library material', () => {
    const [terrain] = withSdk([], sdk => sdk.landscape.createTerrain({ width: 10, depth: 10, resolution: 16, topography: 'flat' })).created;
    const painted = withTerrainTexture(terrain, 'lush_grass');
    expect(painted.materialBindingId).toBeUndefined();
    expect(painted.terrainData!.textureUrl).toBe('lush_grass');
    expect(() => withTerrainTexture(terrain, 'nope')).toThrow(/Unknown terrain texture/);
  });
});
