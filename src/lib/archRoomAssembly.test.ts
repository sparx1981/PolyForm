import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  isPointInPolygon2D,
  distanceToPolygonBoundary2D,
  calculateBalancedDatumElevation,
  buildRoomAssembly,
} from './archRoomAssembly';
import { Shape } from '../types';

describe('ArchRoomAssembly & Site Terracing', () => {
  it('correctly determines 2D point in polygon', () => {
    const polygon: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];

    expect(isPointInPolygon2D(5, 5, polygon)).toBe(true);
    expect(isPointInPolygon2D(15, 5, polygon)).toBe(false);
  });

  it('calculates balanced median datum elevation', () => {
    const vertices = [
      new THREE.Vector3(0, 1.0, 0),
      new THREE.Vector3(10, 3.0, 0),
      new THREE.Vector3(10, 5.0, 10),
      new THREE.Vector3(0, 2.0, 10),
    ];

    const z0 = calculateBalancedDatumElevation(vertices, null);
    // Heights: [1.0, 2.0, 3.0, 5.0] -> median is (2.0 + 3.0)/2 = 2.5
    expect(z0).toBeCloseTo(2.5);
  });

  it('builds full room assembly with wall solids, floor slab, and foundation skirt', () => {
    const vertices = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(6, 0, 0),
      new THREE.Vector3(6, 0, 4),
      new THREE.Vector3(0, 0, 4),
    ];

    const result = buildRoomAssembly(vertices, null);
    expect(result.wallShapes.length).toBe(4);
    expect(result.slabShape).not.toBeNull();
    expect(result.slabShape.name).toContain('Floor Slab');
    expect(result.slabShape.rotation).toEqual([Math.PI / 2, 0, 0]);
    expect(result.slabShape.quaternion).toBeDefined();
    expect(result.foundationShape).not.toBeNull();
  });

  it('correctly maps floor slab local vertices without Z-axis inversion for L-shaped rooms', () => {
    const lShapedVertices = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(10, 0, 4),
      new THREE.Vector3(4, 0, 4),
      new THREE.Vector3(4, 0, 8),
      new THREE.Vector3(0, 0, 8),
    ];

    const result = buildRoomAssembly(lShapedVertices, null);
    expect(result.slabShape.type).toBe('poly');
    expect(result.slabShape.rotation).toEqual([Math.PI / 2, 0, 0]);
    const verts = result.slabShape.args.vertices as [number, number][];
    expect(verts.length).toBe(6);
    // Center of bounding box [0..10] x [0..8] is (5, 4)
    expect(result.slabShape.position[0]).toBe(5);
    expect(result.slabShape.position[2]).toBe(4);
    // Point (0,0) in local coords is (0-5, 0-4) = (-5, -4)
    expect(verts[0]).toEqual([-5, -4]);
    // Point (10,0) is (5, -4)
    expect(verts[1]).toEqual([5, -4]);
  });
});
