import { describe, it, expect } from 'vitest';
import {
  isPointInPolygon,
  doLineSegmentsIntersect,
  getBoundingBox2D,
  doBoundingBoxesOverlap,
  isBoundingBoxInside,
  doPolygonsOverlap,
  marqueeToPolygon,
  evaluateLassoSelection,
  Point2D,
} from './lassoSelection';
import * as THREE from 'three';
import { createGraph } from '../lib/geometry/topology';

describe('lassoSelection 2D geometry math', () => {
  const square: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('correctly tests point in polygon', () => {
    expect(isPointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 10, y: 10 }, square)).toBe(true);
    expect(isPointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(isPointInPolygon({ x: -10, y: 50 }, square)).toBe(false);
  });

  it('tests point in complex concave polygon', () => {
    // U-shaped polygon
    const uShape: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 100 },
      { x: 0, y: 100 },
    ];

    expect(isPointInPolygon({ x: 15, y: 50 }, uShape)).toBe(true);
    expect(isPointInPolygon({ x: 85, y: 50 }, uShape)).toBe(true);
    expect(isPointInPolygon({ x: 50, y: 15 }, uShape)).toBe(true);
    // Point inside the "gap" of the U shape
    expect(isPointInPolygon({ x: 50, y: 70 }, uShape)).toBe(false);
  });

  it('detects line segment intersections', () => {
    expect(
      doLineSegmentsIntersect(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 10, y: 0 }
      )
    ).toBe(true);

    expect(
      doLineSegmentsIntersect(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 5 },
        { x: 10, y: 5 }
      )
    ).toBe(false);
  });

  it('detects bounding box overlap and containment', () => {
    const box1 = { minX: 10, minY: 10, maxX: 50, maxY: 50 };
    const box2 = { minX: 40, minY: 40, maxX: 80, maxY: 80 };
    const box3 = { minX: 100, minY: 100, maxX: 150, maxY: 150 };
    const inner = { minX: 20, minY: 20, maxX: 30, maxY: 30 };

    expect(doBoundingBoxesOverlap(box1, box2)).toBe(true);
    expect(doBoundingBoxesOverlap(box1, box3)).toBe(false);
    expect(isBoundingBoxInside(inner, box1)).toBe(true);
    expect(isBoundingBoxInside(box2, box1)).toBe(false);
  });

  it('detects polygon overlaps', () => {
    const polyA = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ];
    const polyB = [
      { x: 40, y: 40 },
      { x: 90, y: 40 },
      { x: 90, y: 90 },
      { x: 40, y: 90 },
    ];
    const polyC = [
      { x: 100, y: 100 },
      { x: 150, y: 100 },
      { x: 150, y: 150 },
      { x: 100, y: 150 },
    ];

    expect(doPolygonsOverlap(polyA, polyB)).toBe(true);
    expect(doPolygonsOverlap(polyA, polyC)).toBe(false);
  });

  it('converts marquee drag coordinates into a 4-point rectangle', () => {
    const rect = marqueeToPolygon({ x: 100, y: 200 }, { x: 50, y: 80 });
    expect(rect).toEqual([
      { x: 50, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 200 },
      { x: 50, y: 200 },
    ]);
  });
});

describe('evaluateLassoSelection logic', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const shapes: any[] = [
    {
      id: 'shape-1',
      type: 'box',
      position: [0, 0, 0],
      color: '#fff',
      args: [1, 1, 1],
    },
    {
      id: 'shape-2',
      type: 'box',
      position: [50, 50, 50], // Far off
      color: '#fff',
      args: [1, 1, 1],
    },
  ];

  const getSceneObjectById = (id: string | null) => {
    if (id === 'shape-1') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.position.set(0, 0, 0);
      mesh.updateMatrixWorld(true);
      return mesh;
    }
    if (id === 'shape-2') {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.position.set(50, 50, 50);
      mesh.updateMatrixWorld(true);
      return mesh;
    }
    return null;
  };

  it('selects shapes enclosed in window selection', () => {
    // Full screen marquee covering center where shape-1 projects to around (400, 300)
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 800, y: 600 },
    ];

    const result = evaluateLassoSelection({
      rawPoints: points,
      options: {
        mode: 'marquee',
        filter: 'shapes',
        criteria: 'window',
      },
      camera,
      viewportWidth: 800,
      viewportHeight: 600,
      shapes,
      getSceneObjectById,
      kernelGraph: createGraph(),
      currentSelectedIds: [],
      currentSelectedFaceIds: [],
    });

    expect(result.selectedShapeIds).toContain('shape-1');
    expect(result.selectedShapeIds).not.toContain('shape-2');
  });

  it('handles additive selection with Shift key', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 800, y: 600 },
    ];

    const result = evaluateLassoSelection({
      rawPoints: points,
      options: {
        mode: 'marquee',
        filter: 'shapes',
        criteria: 'crossing',
        isAdditive: true,
      },
      camera,
      viewportWidth: 800,
      viewportHeight: 600,
      shapes,
      getSceneObjectById,
      kernelGraph: createGraph(),
      currentSelectedIds: ['pre-existing-shape'],
      currentSelectedFaceIds: [],
    });

    expect(result.selectedShapeIds).toContain('shape-1');
    expect(result.selectedShapeIds).toContain('pre-existing-shape');
  });

  it('handles subtractive selection with Alt key', () => {
    const points: Point2D[] = [
      { x: 0, y: 0 },
      { x: 800, y: 600 },
    ];

    const result = evaluateLassoSelection({
      rawPoints: points,
      options: {
        mode: 'marquee',
        filter: 'shapes',
        criteria: 'crossing',
        isSubtractive: true,
      },
      camera,
      viewportWidth: 800,
      viewportHeight: 600,
      shapes,
      getSceneObjectById,
      kernelGraph: createGraph(),
      currentSelectedIds: ['shape-1', 'shape-2'],
      currentSelectedFaceIds: [],
    });

    // shape-1 matched the lasso, so subtractive mode removes it from current selection
    expect(result.selectedShapeIds).not.toContain('shape-1');
    expect(result.selectedShapeIds).toContain('shape-2');
  });
});
