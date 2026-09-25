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
  computeWallFaceCorner,
} from './archRoomAssembly';
import { createTerrainShape } from './terrain/terrainFactory';
import { sampleTerrainElevation } from './archRoomAssembly';
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

  it('ignores untagged upper-floor slabs, even when the ground floor is hidden', () => {
    const terrainShape = createTerrainShape({ width: 30, depth: 30, resolution: 16, topography: 'flat' });
    const ground: Shape = { id: 'g', type: 'box', name: 'Ground Floor Slab', position: [3, 0.1, 2], rotation: [0, 0, 0], args: [6, 0.2, 4] } as Shape;
    // Named like a floor slab but with no story tag, three metres up (as the Claude connector wrote them).
    const upper: Shape = { ...ground, id: 'u', name: 'First Floor Slab (bedrooms)', position: [3, 2.9, 2] };
    const withGround = flattenTerrainForFloorSlabs(terrainShape, [ground], 1.0);
    const withBoth = flattenTerrainForFloorSlabs(terrainShape, [ground, upper], 1.0);
    expect(Array.from(withBoth!.heights)).toEqual(Array.from(withGround!.heights));
    expect(Math.max(...Array.from(withBoth!.heights))).toBeLessThan(1);
    // Hiding the ground floor in the outliner must not make the upper slab reshape the ground.
    expect(flattenTerrainForFloorSlabs(terrainShape, [{ ...ground, hidden: true }, upper], 1.0)).toBeNull();
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

  it('computes matching true outer/inner face corners for two walls meeting at a non-90-degree angle', () => {
    // Two walls of thickness 0.2 meeting at vertex (10,0): one arriving along +X, the other
    // leaving at 135 degrees from it - a case a fixed box extension cannot close flush. The
    // outer (and separately, the inner) face corner computed from EACH wall's own edge data
    // must be the exact same point, since that's what makes two independently-built wall
    // polygons share a flush edge with no gap and no overlap.
    const dirAfter = new THREE.Vector2(Math.cos((Math.PI * 3) / 4), Math.sin((Math.PI * 3) / 4));
    const before = { linePoint: new THREE.Vector2(0, 0), dir: new THREE.Vector2(1, 0), outwardNormal: new THREE.Vector2(0, -1), thickness: 0.2 };
    const after = { linePoint: new THREE.Vector2(10, 0), dir: dirAfter, outwardNormal: new THREE.Vector2(0, -1), thickness: 0.2 };
    const vertex = new THREE.Vector3(10, 0, 0);

    const outerFromBeforeSide = computeWallFaceCorner(vertex, before, after, 1);
    const outerFromAfterSide = computeWallFaceCorner(vertex, before, after, 1);
    expect(outerFromBeforeSide.x).toBeCloseTo(outerFromAfterSide.x);
    expect(outerFromBeforeSide.y).toBeCloseTo(outerFromAfterSide.y);

    // The outer and inner corners must be genuinely different points (one on each side of the
    // centerline corner), not both collapsing to the same value.
    const inner = computeWallFaceCorner(vertex, before, after, -1);
    expect(Math.abs(outerFromBeforeSide.x - inner.x) + Math.abs(outerFromBeforeSide.y - inner.y)).toBeGreaterThan(0.05);
  });

  it('falls back to a wall\'s own face offset at an open (neighborless) end', () => {
    const self = { linePoint: new THREE.Vector2(0, 0), dir: new THREE.Vector2(1, 0), outwardNormal: new THREE.Vector2(0, 1), thickness: 0.2 };
    const corner = computeWallFaceCorner(new THREE.Vector3(0, 0, 0), null, self, 1);
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y).toBeCloseTo(0.1);
  });

  it('grades the ground to the base of the walls, burying the slab and foundation skirt', () => {
    const terrainShape = createTerrainShape({ width: 30, depth: 30, resolution: 32, topography: 'flat' });
    const vertices = [
      new THREE.Vector3(-3, 0, -2),
      new THREE.Vector3(3, 0, -2),
      new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(-3, 0, 2),
    ];
    const assembly = buildRoomAssembly(vertices, terrainShape, undefined, { story: 1 });
    const graded: Shape = { ...terrainShape, terrainData: assembly.updatedTerrainData ?? terrainShape.terrainData };
    const wallBase = assembly.wallShapes[0].position[1] - (assembly.wallShapes[0].args as number[])[1] / 2;
    expect(wallBase).toBeCloseTo(assembly.datumZ);
    // Just outside the walls the ground is at the wall base (a hair below, never below the slab top).
    const outside = sampleTerrainElevation(4, 0, graded);
    expect(outside).toBeLessThanOrEqual(assembly.datumZ);
    expect(outside).toBeGreaterThan(assembly.datumZ - 0.05);
    // Deep inside the room the ground is cut well below the slab, so a ground material with
    // surface relief (up to 20 cm of displacement) can't push up through the floor.
    const slabBottom = assembly.slabShape.position[1] - (assembly.slabShape.args as { height: number }).height / 2;
    expect(sampleTerrainElevation(0, 0, graded)).toBeLessThan(assembly.datumZ - 0.2);
    // Right next to the walls it stays just under the slab top, so outside the walls the ground
    // still meets the wall base.
    const nearWall = sampleTerrainElevation(2.9, 0, graded);
    expect(nearWall).toBeLessThan(assembly.datumZ);
    expect(nearWall).toBeGreaterThan(slabBottom - 0.35);
    // The foundation skirt sits entirely below ground.
    const skirt = assembly.foundationShape!;
    expect(skirt.position[1] + (skirt.args as { height: number }).height / 2).toBeLessThanOrEqual(slabBottom + 1e-9);
  });
});
