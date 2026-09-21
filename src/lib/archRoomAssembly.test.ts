import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  isPointInPolygon2D,
  distanceToPolygonBoundary2D,
  calculateBalancedDatumElevation,
  buildRoomAssembly,
  flattenTerrainForFloorSlabs,
  intersectLines2D,
  computeWallCornerPoint,
  computeMiterExtension,
} from './archRoomAssembly';
import { createTerrainShape } from './terrain/terrainFactory';
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

  it('only lets the ground-floor slab shape terrain; upper stories never touch it', () => {
    const terrainShape = createTerrainShape({ width: 30, depth: 30, resolution: 16, topography: 'flat' });
    const vertices = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(6, 0, 0),
      new THREE.Vector3(6, 0, 4),
      new THREE.Vector3(0, 0, 4),
    ];
    const groundFloor = buildRoomAssembly(vertices, terrainShape, undefined, { story: 1 });
    expect(groundFloor.slabShape.tags).toContain('story-1');

    // A story-2 slab (as buildNextFloorLevel produces) sitting several meters above grade.
    const upperFloorSlab: Shape = {
      ...groundFloor.slabShape,
      id: 'upper-slab',
      position: [groundFloor.slabShape.position[0], groundFloor.slabShape.position[1] + 2.8, groundFloor.slabShape.position[2]],
      tags: ['architecture', 'story-2', 'floor-slab'],
    };

    // Only the upper-story slab present: nothing should qualify, so the terrain is untouched.
    expect(flattenTerrainForFloorSlabs(terrainShape, [upperFloorSlab], 1.0)).toBeNull();

    // With both present, the result must match flattening for the ground floor alone -
    // the upper slab must not additionally reshape the terrain at its own elevation.
    const withGroundOnly = flattenTerrainForFloorSlabs(terrainShape, [groundFloor.slabShape], 1.0);
    const withBoth = flattenTerrainForFloorSlabs(terrainShape, [groundFloor.slabShape, upperFloorSlab], 1.0);
    expect(Array.from(withBoth!.heights)).toEqual(Array.from(withGroundOnly!.heights));
  });

  it('miters a 90-degree exterior-justified corner to the exact offset-line intersection', () => {
    // Two walls of thickness 0.2 meeting at a right angle at the raw vertex (10, 0), each
    // pushed outward by half its thickness (0.1) - the true corner is where their offset
    // centerlines cross, not the raw vertex itself.
    const before = { offsetPoint: new THREE.Vector2(0, -0.1), dir: new THREE.Vector2(1, 0) };
    const after = { offsetPoint: new THREE.Vector2(10.1, 0), dir: new THREE.Vector2(0, 1) };
    const corner = computeWallCornerPoint(new THREE.Vector3(10, 0, 0), before, after);
    expect(corner.x).toBeCloseTo(10.1);
    expect(corner.y).toBeCloseTo(-0.1);
  });

  it('miters a non-90-degree corner exactly, unlike a fixed half-thickness extension', () => {
    // A 135-degree turn (post-turn direction at +135deg from the incoming direction) - a fixed
    // "extend by half the thickness" would either gap or overlap here; the true miter point is
    // the exact intersection of the two offset lines regardless of the angle between them.
    const before = { offsetPoint: new THREE.Vector2(0, -0.1), dir: new THREE.Vector2(1, 0) };
    const dirAfter = new THREE.Vector2(Math.cos(Math.PI * 3 / 4), Math.sin(Math.PI * 3 / 4));
    const normalAfter = new THREE.Vector2(-dirAfter.y, dirAfter.x).multiplyScalar(0.1);
    const after = { offsetPoint: new THREE.Vector2(10, 0).add(normalAfter), dir: dirAfter };
    const corner = computeWallCornerPoint(new THREE.Vector3(10, 0, 0), before, after);
    // Verify the corner actually lies on BOTH offset lines (the defining property of a correct
    // miter join), rather than pinning to a single hand-computed value.
    const onBeforeLine = corner.clone().sub(before.offsetPoint).cross(before.dir);
    const onAfterLine = corner.clone().sub(after.offsetPoint).cross(dirAfter);
    expect(Math.abs(onBeforeLine)).toBeLessThan(1e-9);
    expect(Math.abs(onAfterLine)).toBeLessThan(1e-9);
  });

  it('falls back to the incoming wall\'s own offset point for a degenerate (parallel) join', () => {
    const before = { offsetPoint: new THREE.Vector2(0, -0.1), dir: new THREE.Vector2(1, 0) };
    const after = { offsetPoint: new THREE.Vector2(5, -0.1), dir: new THREE.Vector2(1, 0) };
    const corner = computeWallCornerPoint(new THREE.Vector3(5, 0, 0), before, after);
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y).toBeCloseTo(-0.1);
    expect(intersectLines2D([0, 0], [1, 0], [5, 0], [1, 0])).toBeNull();
  });

  it('computes the exact half-thickness miter extension at a 90-degree corner', () => {
    // Derived from first principles (two width-t strips crossing at a right angle, cut flush
    // at the shared centerline point): the naive flush cut leaves an uncovered t/2 x t/2
    // square at the corner unless each wall is additionally extended by exactly t/2.
    expect(computeMiterExtension(0.2, Math.PI / 2)).toBeCloseTo(0.1);
  });

  it('needs no miter extension for a straight (non-turning) join', () => {
    expect(computeMiterExtension(0.2, 0)).toBeCloseTo(0);
  });

  it('caps the miter extension near a 180-degree fold instead of diverging to infinity', () => {
    const ext = computeMiterExtension(0.2, Math.PI * 0.999);
    expect(Number.isFinite(ext)).toBe(true);
    expect(ext).toBeLessThan(10);
  });
});
