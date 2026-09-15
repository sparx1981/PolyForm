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

  it('places tiles on the real facets of a general (non-rectangular, non-L-shaped) polygon roof', () => {
    // Diamond (45deg-rotated square) footprint: a convex quadrilateral,
    // but its area is far below its axis-aligned bounding box area, so
    // extractRoomFootprintPolygon's isRectangular check (n===4 AND
    // polyArea >= 0.92*bboxArea) correctly rejects it, and it isn't the
    // 6-vertex L-shape case either - so it must fall through to the
    // general-polygon tiling branch.
    const len = Math.sqrt(18);
    const diamondRoomWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [4.5, 1.4, 1.5], rotation: [0, -Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4.5, 1.4, 4.5], rotation: [0, -3 * Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [1.5, 1.4, 4.5], rotation: [0, 3 * Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [1.5, 1.4, 1.5], rotation: [0, Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
    ];

    const assembly = buildRoofAssemblyForRoom(diamondRoomWalls, {
      roofType: 'hip',
      pitchAngleDeg: 35,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
      tileShape: 'flat',
      tileSize: 0.35,
    });

    expect(assembly).toBeDefined();
    if (!assembly) return;
    expect(assembly.tilesShape).toBeDefined();
    const positions = assembly.tilesShape!.geometryData!.positions;
    expect(positions.length).toBeGreaterThan(0);

    // localEavePoly is in the same local coordinate frame as the tile
    // shape's own geometryData (both centered on the roof's world center).
    const localEavePoly = assembly.roofShape.roofData?.localEavePoly as [number, number][] | undefined;
    expect(localEavePoly).toBeDefined();
    if (!localEavePoly) return;

    // Point-in-polygon (ray casting) with a small tolerance for the edge
    // itself, since tile-grid quantization can place a tile fractionally
    // past the true boundary.
    const pointInPoly = (x: number, z: number, poly: [number, number][], tol = 0.15): boolean => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
          inside = !inside;
        }
      }
      if (inside) return true;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        const dx = xj - xi, dz = zj - zi;
        const len2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / len2));
        const px = xi + t * dx, pz = zi + t * dz;
        if (Math.hypot(x - px, z - pz) < tol) return true;
      }
      return false;
    };

    let outsideCount = 0;
    for (let i = 0; i < positions.length; i += 3) {
      if (!pointInPoly(positions[i], positions[i + 2], localEavePoly)) outsideCount++;
    }
    // Before general-polygon tiling, this diamond-shaped roof got a
    // single rectangular tile grid sized to its axis-aligned bounding
    // box - most of that grid falls in the four corner void triangles
    // outside the diamond, so this assertion would fail against that
    // old behavior.
    expect(outsideCount).toBe(0);
  });

  it('keeps general-polygon tile apex height in sync with the slope mesh apex height', () => {
    // Regression test for a pitchAngleDeg divergence: buildRoofAssemblyForRoom
    // passed `params.pitchAngleDeg || 35` into the slope mesh but the raw
    // `params.pitchAngleDeg` into the tile mesh, whose own default only
    // covers `undefined` - so an explicit pitchAngleDeg of 0 made the slope
    // mesh apex sit far above the tile mesh apex (tiles sinking through the
    // roof near the peak). Using the same diamond footprint as above.
    const len = Math.sqrt(18);
    const diamondRoomWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [4.5, 1.4, 1.5], rotation: [0, -Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4.5, 1.4, 4.5], rotation: [0, -3 * Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [1.5, 1.4, 4.5], rotation: [0, 3 * Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [1.5, 1.4, 1.5], rotation: [0, Math.PI / 4, 0], args: [len, 2.8, 0.2], color: '#ffffff' },
    ];

    const assembly = buildRoofAssemblyForRoom(diamondRoomWalls, {
      roofType: 'hip',
      pitchAngleDeg: 0,
      ridgeHeight: 2.0,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
      tileShape: 'flat',
      tileSize: 0.35,
    });

    expect(assembly).toBeDefined();
    if (!assembly) return;

    const slopePositions = assembly.roofShape.geometryData!.positions;
    const tilePositions = assembly.tilesShape!.geometryData!.positions;
    let slopeMaxY = -Infinity;
    for (let i = 1; i < slopePositions.length; i += 3) slopeMaxY = Math.max(slopeMaxY, slopePositions[i]);
    let tileMaxY = -Infinity;
    for (let i = 1; i < tilePositions.length; i += 3) tileMaxY = Math.max(tileMaxY, tilePositions[i]);

    expect(tileMaxY).toBeCloseTo(slopeMaxY, 1);
  });

  it('keeps the general-polygon fan apex inside a concave (T-shaped) footprint', () => {
    // T-shaped 8-vertex footprint with 2 reflex corners: a horizontal top
    // bar (x[0,6] z[4,6]) and a vertical stem (x[2,4] z[0,4]). This has 8
    // vertices, so it isn't the rectangular (n===4) or L-shape (n===6,
    // 1 reflex corner) special case - it must take the general-polygon
    // path. The naive vertex-mean centroid of this shape sits at roughly
    // (3, 3.14), which is OUTSIDE the polygon (in the left or right
    // "armpit" void) since the stem is only 2m wide - a real defect the
    // pole-of-inaccessibility apex must avoid.
    const tShapeRoomWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [0, 1.4, 5], args: [0.2, 2.8, 2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [3, 1.4, 6], args: [6, 2.8, 0.2], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [6, 1.4, 5], args: [0.2, 2.8, 2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [5, 1.4, 4], args: [2, 2.8, 0.2], color: '#ffffff' },
      { id: 'w5', type: 'wall', position: [4, 1.4, 2], args: [0.2, 2.8, 4], color: '#ffffff' },
      { id: 'w6', type: 'wall', position: [3, 1.4, 0], args: [2, 2.8, 0.2], color: '#ffffff' },
      { id: 'w7', type: 'wall', position: [2, 1.4, 2], args: [0.2, 2.8, 4], color: '#ffffff' },
      { id: 'w8', type: 'wall', position: [1, 1.4, 4], args: [2, 2.8, 0.2], color: '#ffffff' },
    ];

    const assembly = buildRoofAssemblyForRoom(tShapeRoomWalls, {
      roofType: 'hip',
      pitchAngleDeg: 35,
      eaveOverhang: 0.2,
      fasciaHeight: 0.18,
      tileShape: 'flat',
      tileSize: 0.35,
    });

    expect(assembly).toBeDefined();
    if (!assembly) return;
    expect(assembly.tilesShape).toBeDefined();
    const positions = assembly.tilesShape!.geometryData!.positions;
    expect(positions.length).toBeGreaterThan(0);

    const localEavePoly = assembly.roofShape.roofData?.localEavePoly as [number, number][] | undefined;
    expect(localEavePoly).toBeDefined();
    if (!localEavePoly) return;

    // A larger tolerance than the convex-footprint tests above: near a
    // triangular hip-end facet's acute corner, a tile quad can legitimately
    // overshoot the true edge by close to a full tile width in two
    // directions at once - this is ordinary tile-grid quantization, not
    // the apex-outside-the-polygon defect this test targets.
    const pointInPoly = (x: number, z: number, poly: [number, number][], tol = 0.3): boolean => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
          inside = !inside;
        }
      }
      if (inside) return true;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        const dx = xj - xi, dz = zj - zi;
        const len2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / len2));
        const px = xi + t * dx, pz = zi + t * dz;
        if (Math.hypot(x - px, z - pz) < tol) return true;
      }
      return false;
    };

    let outsideCount = 0;
    for (let i = 0; i < positions.length; i += 3) {
      if (!pointInPoly(positions[i], positions[i + 2], localEavePoly)) outsideCount++;
    }
    // Before the pole-of-inaccessibility fix, the fan apex for this
    // T-shape sat outside the polygon (in one of the armpit voids),
    // pulling a large share of tile facets far outside the real footprint
    // - well beyond the tile-quantization tolerance above.
    expect(outsideCount).toBe(0);
  });

  it('tapers standing-seam ribs with a hip roof\'s narrowing profile instead of protruding past the ridge', () => {
    const rectWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [0, 1.4, -3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
    ];
    const ridgeHeight = 2.2;

    const assembly = buildRoofAssemblyForRoom(rectWalls, {
      roofType: 'hip',
      ridgeHeight,
      eaveOverhang: 0.3,
      fasciaHeight: 0.18,
      tileShape: 'standing-seam',
      tileSize: 0.4,
    });

    expect(assembly).toBeDefined();
    if (!assembly) return;
    const positions = assembly.tilesShape!.geometryData!.positions;
    expect(positions.length).toBeGreaterThan(0);

    // Near the ridge, a hip roof this shape (8m x 6m, 0.3m eave overhang)
    // has narrowed to just the ridge line itself (half-width 4.35 - 3.35 =
    // 1.0m) - before the per-segment clipping fix, a standing-seam rib
    // kept its full eave-edge horizontal offset (up to ~4.35m) all the way
    // to the ridge instead of tapering with the roof, so a vertex near
    // ridge height could sit ~4x farther from the center axis than the
    // real roof surface allows there.
    let worstOffsetNearRidge = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      if (y > ridgeHeight * 0.85) {
        worstOffsetNearRidge = Math.max(worstOffsetNearRidge, Math.abs(positions[i]), Math.abs(positions[i + 2]));
      }
    }
    expect(worstOffsetNearRidge).toBeLessThan(1.5);
  });
});
