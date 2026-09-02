import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createGableRoofGeometry,
  createHipRoofGeometry,
  buildRoofShapeForRoom,
  buildCeilingSlabForRoom,
  buildNextFloorLevel,
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
