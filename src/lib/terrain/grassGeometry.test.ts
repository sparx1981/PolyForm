import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGrassBladeGeometry, generateGrassInstances, extractExclusionFootprints, isPointExcluded, seededRandom, nearestClump, partitionGrassChunks, grassKeepFraction, grassLodRange } from './grassGeometry';
import { Shape, GrassSettings, DEFAULT_GRASS_SETTINGS, RoadModifier } from '../../types';

describe('Procedural Grass Geometry & Instancing Engine', () => {
  it('creates a tapered radial tuft within the original triangle budget', () => {
    const geo = createGrassBladeGeometry();

    expect(geo.getAttribute('position')).toBeDefined();
    expect(geo.getAttribute('normal')).toBeDefined();
    expect(geo.getAttribute('aHeightPercent')).toBeDefined();
    expect(geo.getAttribute('aBladeTone')).toBeDefined();
    expect(geo.getIndex()).toBeDefined();
    expect(geo.getIndex()!.count / 3).toBe(18);
    // The fuller default lawn still submits fewer blade triangles per square metre than before.
    expect((geo.getIndex()!.count / 3) * DEFAULT_GRASS_SETTINGS.density).toBeLessThanOrEqual(26 * 8);

    const posCount = geo.getAttribute('position').count;
    const hPct = geo.getAttribute('aHeightPercent');

    expect(posCount).toBeGreaterThan(0);
    expect(hPct.count).toBe(posCount);

    // Root vertices should be 0.0 and tip vertices should reach 1.0
    let minH = 1.0;
    let maxH = 0.0;
    for (let i = 0; i < hPct.count; i++) {
      const val = hPct.getX(i);
      if (val < minH) minH = val;
      if (val > maxH) maxH = val;
    }
    expect(minH).toBe(0.0);
    expect(maxH).toBe(1.0);
    const bounds = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
    expect(bounds.max.y).toBeGreaterThan(1);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.25);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0.25);
    geo.dispose();
  });

  it('generates zero instances when grass is disabled', () => {
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
        heights: new Array(16 * 16).fill(0),
        grass: {
          ...DEFAULT_GRASS_SETTINGS,
          enabled: false
        }
      }
    };

    const instances = generateGrassInstances(dummyTerrain, [], [], {
      ...DEFAULT_GRASS_SETTINGS,
      enabled: false
    });

    expect(instances.instanceCount).toBe(0);
    expect(instances.matrices.length).toBe(0);
  });

  it('generates instanced positions and attributes across terrain', () => {
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

    const settings: GrassSettings = {
      ...DEFAULT_GRASS_SETTINGS,
      enabled: true,
      density: 4,
      maxSlopeAngle: 45
    };

    const instances = generateGrassInstances(dummyTerrain, [], [], settings);

    expect(instances.instanceCount).toBeGreaterThan(0);
    expect(instances.matrices.length).toBe(instances.instanceCount * 16);
    expect(instances.shapeOffsets.length).toBe(instances.instanceCount * 4);
    expect(instances.heightVariances.length).toBe(instances.instanceCount);
  });

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

  it('uses a random sequence that does not repeat within a large lawn', () => {
    const rng = seededRandom(42);
    const first = [rng(), rng(), rng(), rng()];
    // The old LCG repeated after 233,280 values; a 100k-tuft lawn draws about 700k.
    for (let i = 0; i < 700000; i++) rng();
    const later = [rng(), rng(), rng(), rng()];
    expect(later).not.toEqual(first);
    const again = seededRandom(42);
    expect([again(), again(), again(), again()]).toEqual(first);
  });

  it('groups nearby tufts into stable clumps', () => {
    const a = nearestClump(3.01, 5.02, 0.5);
    const b = nearestClump(3.01, 5.02, 0.5);
    expect(a).toEqual(b);
    expect(a.distance).toBeLessThan(0.5 * Math.SQRT2 * 1.5);
    expect(Math.hypot(a.dirX, a.dirZ)).toBeCloseTo(1, 5);
    expect(a.hash).toBeGreaterThanOrEqual(0);
    expect(a.hash).toBeLessThan(1);
  });

  it('partitions instances into shuffled tiles without losing any', () => {
    const terrain: Shape = {
      id: 't-1', name: 'Terrain', type: 'terrain', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      color: '#ffffff', args: [40, 0, 40],
      terrainData: { gridX: 8, gridY: 8, width: 40, depth: 40, heights: new Array(64).fill(0) }
    };
    const data = generateGrassInstances(terrain, [], [], { ...DEFAULT_GRASS_SETTINGS, enabled: true, density: 4 });
    const chunks = partitionGrassChunks(data, 16);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((sum, chunk) => sum + chunk.instanceCount, 0)).toBe(data.instanceCount);
    for (const chunk of chunks) {
      expect(chunk.ranks[0]).toBe(0);
      expect(chunk.ranks[chunk.instanceCount - 1]).toBeLessThan(1);
      for (let i = 0; i < chunk.instanceCount; i++) {
        const dx = chunk.matrices[i * 16 + 12] - chunk.center[0];
        const dz = chunk.matrices[i * 16 + 14] - chunk.center[2];
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(chunk.radius + 1e-4);
      }
    }
  });

  it('thins grass with distance, starting later for taller grass', () => {
    const lawn = grassLodRange({ baseHeight: 0.05, heightVariance: 0.1 });
    expect(grassKeepFraction(0, lawn)).toBe(1);
    expect(grassKeepFraction(lawn.near, lawn)).toBe(1);
    expect(grassKeepFraction(lawn.far * 2, lawn)).toBeCloseTo(lawn.minKeep);
    expect(grassKeepFraction((lawn.near + lawn.far) / 2, lawn)).toBeLessThan(1);
    const meadow = grassLodRange({ baseHeight: 0.8, heightVariance: 0.5 });
    expect(meadow.near).toBeGreaterThan(lawn.near);
    expect(meadow.far).toBeGreaterThan(lawn.far);
  });
});
