import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { extractExclusionFootprints, isPointExcluded } from './grassGeometry';
import { bakeGrassMask } from './bladeGrass';
import { Shape, GrassSettings, DEFAULT_GRASS_SETTINGS, RoadModifier, TerrainModifier } from '../../types';

/** Grass-growing mask cells as instance-style positions, so placement tests read naturally. */
function generateGrassInstances(terrain: Shape, shapes: Shape[], modifiers: TerrainModifier[], settings: GrassSettings) {
  const mask = bakeGrassMask(terrain, shapes, modifiers, settings);
  const { width = 50, depth = 50 } = terrain.terrainData!;
  const matrices: number[] = [];
  for (let iz = 0; iz < mask.height; iz++) {
    for (let ix = 0; ix < mask.width; ix++) {
      if (!mask.data[iz * mask.width + ix]) continue;
      const x = terrain.position[0] - width / 2 + ((ix + 0.5) / mask.width) * width;
      const z = terrain.position[2] - depth / 2 + ((iz + 0.5) / mask.height) * depth;
      matrices.push(...new THREE.Matrix4().makeTranslation(x, 0, z).elements);
    }
  }
  return { instanceCount: matrices.length / 16, matrices: new Float32Array(matrices) };
}

describe('Procedural grass placement (presence mask)', () => {
  it('discards grass instances located within floor slab footprints', () => {
    // Floor slab placed in center [0, 0, 0] with width 10m x depth 10m
    const slabShape: Shape = {
      id: 'slab-1',
      name: 'Ground Floor Slab',
      type: 'box',
      position: [0, 0.1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#888888',
      args: [10, 0.2, 10],
      tags: ['architecture', 'floor-slab']
    };

    const dummyTerrain: Shape = {
      id: 't-1',
      name: 'Terrain',
      type: 'terrain',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#ffffff',
      args: [20, 0, 20],
      terrainData: {
        gridX: 16,
        gridY: 16,
        width: 20,
        depth: 20,
        heights: new Array(16 * 16).fill(0)
      }
    };

    const footprints = extractExclusionFootprints([slabShape], []);
    expect(footprints.length).toBe(1);
    expect(isPointExcluded(0, 0, 0, footprints)).toBe(true);
    expect(isPointExcluded(2, 0, 2, footprints)).toBe(true);
    expect(isPointExcluded(8, 0, 8, footprints)).toBe(false);

    const instancesWithSlab = generateGrassInstances(
      dummyTerrain,
      [slabShape],
      [],
      { ...DEFAULT_GRASS_SETTINGS, enabled: true, density: 4 }
    );

    const instancesWithoutSlab = generateGrassInstances(
      dummyTerrain,
      [],
      [],
      { ...DEFAULT_GRASS_SETTINGS, enabled: true, density: 4 }
    );

    // Floor slab exclusion must discard overlapping instances
    expect(instancesWithSlab.instanceCount).toBeLessThan(instancesWithoutSlab.instanceCount);

    // Verify none of the generated instances sit inside the slab bounds
    const mat4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < instancesWithSlab.instanceCount; i++) {
      mat4.fromArray(instancesWithSlab.matrices, i * 16);
      pos.setFromMatrixPosition(mat4);
      const inSlab = Math.abs(pos.x) <= 5.0 && Math.abs(pos.z) <= 5.0;
      expect(inSlab).toBe(false);
    }
  });

  it('discards grass instances located within and below civil road corridors', () => {
    const roadMod: RoadModifier = {
      id: 'road-1',
      name: 'Main Access Road',
      type: 'road',
      enabled: true,
      points: [
        [-15, 0.5, 0],
        [0, 0.5, 0],
        [15, 0.5, 0]
      ],
      width: 6.0,
      maxGradePercent: 12,
      bankingAngle: 0,
      markings: 'none',
      batterDistance: 1.0,
      profile: {
        hasCurb: true,
        width: 0.3,
        height: 0.15,
        hasDitch: false,
        ditchWidth: 0,
        ditchDepth: 0
      }
    };

    const dummyTerrain: Shape = {
      id: 't-1',
      name: 'Terrain',
      type: 'terrain',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#ffffff',
      args: [30, 0, 30],
      terrainData: {
        gridX: 16,
        gridY: 16,
        width: 30,
        depth: 30,
        heights: new Array(16 * 16).fill(0)
      }
    };

    const footprints = extractExclusionFootprints([], [roadMod]);
    expect(footprints.length).toBeGreaterThan(0);

    // Points directly along the road centerline must be excluded
    expect(isPointExcluded(0, 0, 0, footprints)).toBe(true);
    expect(isPointExcluded(-5, 0, 0, footprints)).toBe(true);
    // Points within half-width (3m + curb) should be excluded
    expect(isPointExcluded(0, 0, 2.0, footprints)).toBe(true);
    // Points far away from the road should NOT be excluded
    expect(isPointExcluded(0, 0, 10.0, footprints)).toBe(false);

    const instancesWithRoad = generateGrassInstances(
      dummyTerrain,
      [],
      [roadMod],
      { ...DEFAULT_GRASS_SETTINGS, enabled: true, density: 4 }
    );

    const instancesWithoutRoad = generateGrassInstances(
      dummyTerrain,
      [],
      [],
      { ...DEFAULT_GRASS_SETTINGS, enabled: true, density: 4 }
    );

    expect(instancesWithRoad.instanceCount).toBeLessThan(instancesWithoutRoad.instanceCount);

    // Verify none of the generated instances sit within the road corridor (width 6m -> ±3m in Z)
    const mat4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < instancesWithRoad.instanceCount; i++) {
      mat4.fromArray(instancesWithRoad.matrices, i * 16);
      pos.setFromMatrixPosition(mat4);
      const onRoad = Math.abs(pos.z) <= 3.2 && Math.abs(pos.x) <= 15.0;
      expect(onRoad).toBe(false);
    }
  });

  it('discards grass instances below polygon floor slabs', () => {
    // Polygon floor slab at center
    const polySlab: Shape = {
      id: 'poly-slab-1',
      name: 'Floor Slab (Story 1)',
      type: 'poly',
      position: [0, 0.2, 0],
      rotation: [0, 0, 0],
      color: '#cbd5e1',
      args: {
        vertices: [
          [-4, -4],
          [4, -4],
          [4, 4],
          [-4, 4]
        ],
        height: 0.25
      },
      tags: ['story-1', 'architecture', 'floor-slab']
    };

    const dummyTerrain: Shape = {
      id: 't-1',
      name: 'Terrain',
      type: 'terrain',
      position: [0, 0, 0],
      color: '#ffffff',
      args: [20, 0, 20],
      terrainData: {
        gridX: 16,
        gridY: 16,
        width: 20,
        depth: 20,
        heights: new Array(16 * 16).fill(0)
      }
    };

    const footprints = extractExclusionFootprints([polySlab], []);
    expect(footprints.length).toBe(1);
    expect(isPointExcluded(0, 0, 0, footprints)).toBe(true);
    expect(isPointExcluded(2, 0, 2, footprints)).toBe(true);
    expect(isPointExcluded(6, 0, 6, footprints)).toBe(false);

    const instances = generateGrassInstances(
      dummyTerrain,
      [polySlab],
      [],
      { ...DEFAULT_GRASS_SETTINGS, enabled: true, density: 4 }
    );

    const mat4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < instances.instanceCount; i++) {
      mat4.fromArray(instances.matrices, i * 16);
      pos.setFromMatrixPosition(mat4);
      const inPoly = Math.abs(pos.x) <= 4.0 && Math.abs(pos.z) <= 4.0;
      expect(inPoly).toBe(false);
    }
  });
});
