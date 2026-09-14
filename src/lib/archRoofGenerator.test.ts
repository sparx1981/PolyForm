import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createGableRoofGeometry,
  createHipRoofGeometry,
  buildRoofShapeForRoom,
  buildCeilingSlabForRoom,
  buildNextFloorLevel,
  buildRoofAssemblyForRoom,
} from './archRoofGenerator';
import { Shape } from '../types';

describe('ArchRoofGenerator & Multi-Story Stacking', () => {
  it('creates 3D Gable roof geometry with valid vertex buffers and normals', () => {
    const geom = createGableRoofGeometry(6.0, 4.0, 2.0, 0.3);
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('position').count).toBeGreaterThan(0);
    expect(geom.getAttribute('normal')).toBeDefined();
  });

  it('creates 3D Hip roof geometry with valid vertex buffers and normals', () => {
    const geom = createHipRoofGeometry(6.0, 4.0, 2.0, 0.3);
    expect(geom.getAttribute('position')).toBeDefined();
    expect(geom.getAttribute('position').count).toBeGreaterThan(0);
    expect(geom.getAttribute('normal')).toBeDefined();
  });

  it('builds parametric roof shape for a set of room walls', () => {
    const walls: Shape[] = [
      { id: 'w1', type: 'wall', position: [3, 1.2, 0], args: [6, 2.4, 0.2], color: '#fff' },
      { id: 'w2', type: 'wall', position: [3, 1.2, 4], args: [6, 2.4, 0.2], color: '#fff' },
      { id: 'w3', type: 'wall', position: [0, 1.2, 2], args: [4, 2.4, 0.2], color: '#fff' },
      { id: 'w4', type: 'wall', position: [6, 1.2, 2], args: [4, 2.4, 0.2], color: '#fff' },
    ];

    const roof = buildRoofShapeForRoom(walls, {
      roofType: 'gable',
      ridgeHeight: 2.0,
      eaveOverhang: 0.3,
    });

    expect(roof).not.toBeNull();
    expect(roof!.type).toBe('custom');
    expect(roof!.geometryData).toBeDefined();
    expect(roof!.position[1]).toBeCloseTo(2.4); // Sits on top of walls
  });

  it('builds ceiling slab for a room', () => {
    const walls: Shape[] = [
      { id: 'w1', type: 'wall', position: [3, 1.2, 0], args: [6, 2.4, 0.2], color: '#fff' },
    ];

    const ceiling = buildCeilingSlabForRoom(walls, 0.2);
    expect(ceiling).not.toBeNull();
    expect(['poly', 'box']).toContain(ceiling!.type);
    expect(ceiling!.name).toContain('Slab');
  });

  it('stacks multi-story floor levels correctly', () => {
    const walls: Shape[] = [
      { id: 'w1', type: 'wall', position: [3, 1.2, 0], args: [6, 2.4, 0.2], color: '#fff', tags: ['story-1'] },
    ];
    const openings: Shape[] = [
      { id: 'd1', type: 'door', position: [3, 1.05, 0], args: [0.9, 2.1, 0.2], hostWallId: 'w1', color: '#fff' },
    ];

    const { newWalls, newOpenings, newSlab } = buildNextFloorLevel(walls, [...walls, ...openings], true);

    expect(newWalls.length).toBe(1);
    expect(newWalls[0].position[1]).toBeCloseTo(3.6); // 1.2 + 2.4
    expect(newWalls[0].tags).toContain('story-2');
    expect(newOpenings.length).toBe(1);
    expect(newOpenings[0].hostWallId).toBe(newWalls[0].id);
    expect(newSlab).not.toBeNull();
  });
});

describe('3D Roof Tile Placement (per-facet, matches the real roof shape)', () => {
  // Same L-shaped room footprint already used and verified in
  // timberFrameGenerator.test.ts - its courtyard/notch void is at
  // x in [0.5, 3.5], z in [-3.5, -0.5].
  const lShapeRoomWalls: Shape[] = [
    { id: 'w1', type: 'wall', position: [2, 1.4, 0], args: [4, 2.8, 0.2], color: '#ffffff' },
    { id: 'w2', type: 'wall', position: [4, 1.4, 3], args: [0.2, 2.8, 6], color: '#ffffff' },
    { id: 'w3', type: 'wall', position: [0, 1.4, 6], args: [8, 2.8, 0.2], color: '#ffffff' },
    { id: 'w4', type: 'wall', position: [-4, 1.4, 1], args: [0.2, 2.8, 10], color: '#ffffff' },
    { id: 'w5', type: 'wall', position: [-2, 1.4, -4], args: [4, 2.8, 0.2], color: '#ffffff' },
    { id: 'w6', type: 'wall', position: [0, 1.4, -2], args: [0.2, 2.8, 4], color: '#ffffff' },
  ];

  function expectNoTileVerticesInVoid(assembly: ReturnType<typeof buildRoofAssemblyForRoom>) {
    expect(assembly).toBeDefined();
    if (!assembly) return;
    expect(assembly.tilesShape).toBeDefined();
    const positions = assembly.tilesShape!.geometryData!.positions;
    // Before per-facet tiling, an L-shaped roof got a single rectangular
    // tile grid sized to its bounding box - that grid necessarily covers
    // the courtyard/notch void too, so this assertion would fail against
    // the old behavior.
    expect(positions.length).toBeGreaterThan(0);
    // geometryData vertices are local to the tile shape's own position
    // (the roof's world center) - offset back to world space before
    // comparing against the void region, which is expressed in the same
    // world coordinates as the wall shapes above.
    const [centerX, , centerZ] = assembly.tilesShape!.position;
    let voidVertexCount = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] + centerX;
      const z = positions[i + 2] + centerZ;
      if (x > 0.8 && x < 3.5 && z > -3.5 && z < -0.8) voidVertexCount++;
    }
    expect(voidVertexCount).toBe(0);
  }

  it('places gable roof tiles on the real L-shaped facets, not the bounding-box rectangle', () => {
    const assembly = buildRoofAssemblyForRoom(lShapeRoomWalls, {
      roofType: 'gable',
      pitchAngleDeg: 35,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
      tileShape: 'flat',
      tileSize: 0.35,
    });
    expectNoTileVerticesInVoid(assembly);
  });

  it('places hip roof tiles on the real L-shaped facets, not the bounding-box rectangle', () => {
    const assembly = buildRoofAssemblyForRoom(lShapeRoomWalls, {
      roofType: 'hip',
      pitchAngleDeg: 35,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
      tileShape: 'flat',
      tileSize: 0.35,
    });
    expectNoTileVerticesInVoid(assembly);
  });

  it('still tiles a plain rectangular roof correctly (no regression for the common case)', () => {
    const rectWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [0, 1.4, -3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
    ];
    const assembly = buildRoofAssemblyForRoom(rectWalls, {
      roofType: 'gable',
      pitchAngleDeg: 35,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
      tileShape: 'flat',
      tileSize: 0.35,
    });
    expect(assembly).toBeDefined();
    if (!assembly) return;
    expect(assembly.tilesShape).toBeDefined();
    expect(assembly.tilesShape!.geometryData!.positions.length).toBeGreaterThan(0);
  });
});
