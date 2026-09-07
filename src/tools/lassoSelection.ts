/**
 * PolyForm — Lasso & Marquee Selection Engine
 *
 * Implements 2D screen-space lasso (custom freehand path) and marquee (box)
 * multi-selection for 3D shapes and kernel surfaces.
 */

import * as THREE from 'three';
import type { Shape } from '../types';
import type { Graph, FaceId, Vec3 } from '../lib/geometry/types';
import { loopPoints } from '../lib/geometry/topology';

export type SelectionShapeMode = 'lasso' | 'marquee';
export type SelectionFilter = 'all' | 'shapes' | 'surfaces';
export type SelectionCriteria = 'crossing' | 'window';

export interface Point2D {
  x: number;
  y: number;
}

export interface LassoSelectionOptions {
  mode: SelectionShapeMode;
  filter: SelectionFilter;
  criteria: SelectionCriteria;
  isAdditive?: boolean;
  isSubtractive?: boolean;
}

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// 2D Geometric Math
// ---------------------------------------------------------------------------

/**
 * Tests if a 2D point is inside a polygon using ray-casting algorithm (even-odd rule).
 */
export function isPointInPolygon(point: Point2D, polygon: readonly Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Checks if two line segments (p1-p2 and q1-q2) intersect.
 */
export function doLineSegmentsIntersect(
  p1: Point2D,
  p2: Point2D,
  q1: Point2D,
  q2: Point2D
): boolean {
  const ccw = (a: Point2D, b: Point2D, c: Point2D) => {
    return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  };
  return (
    ccw(p1, q1, q2) !== ccw(p2, q1, q2) &&
    ccw(p1, p2, q1) !== ccw(p1, p2, q2)
  );
}

/**
 * Calculates axis-aligned 2D bounding box of a list of points.
 */
export function getBoundingBox2D(points: readonly Point2D[]): BoundingBox2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Tests if two 2D bounding boxes overlap.
 */
export function doBoundingBoxesOverlap(a: BoundingBox2D, b: BoundingBox2D): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

/**
 * Tests if box A is completely enclosed inside box B.
 */
export function isBoundingBoxInside(inner: BoundingBox2D, outer: BoundingBox2D): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

/**
 * Tests if two 2D polygons intersect or overlap.
 */
export function doPolygonsOverlap(
  polyA: readonly Point2D[],
  polyB: readonly Point2D[]
): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;

  // 1. Quick bounding box rejection
  const boxA = getBoundingBox2D(polyA);
  const boxB = getBoundingBox2D(polyB);
  if (!doBoundingBoxesOverlap(boxA, boxB)) return false;

  // 2. Check if any vertex of polyA is inside polyB
  for (const p of polyA) {
    if (isPointInPolygon(p, polyB)) return true;
  }

  // 3. Check if any vertex of polyB is inside polyA
  for (const p of polyB) {
    if (isPointInPolygon(p, polyA)) return true;
  }

  // 4. Check if any edge of polyA intersects any edge of polyB
  const nA = polyA.length;
  const nB = polyB.length;
  for (let i = 0; i < nA; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % nA];
    for (let j = 0; j < nB; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % nB];
      if (doLineSegmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

/**
 * Converts a 2-point marquee start/end into a 4-point rectangular polygon.
 */
export function marqueeToPolygon(start: Point2D, end: Point2D): Point2D[] {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

// ---------------------------------------------------------------------------
// 3D -> 2D Projection
// ---------------------------------------------------------------------------

const _vec3Scratch = new THREE.Vector3();

/**
 * Projects a 3D world coordinate to 2D viewport screen coordinates.
 * Returns inFront: true if the point is within camera view frustum in front of camera.
 */
export function project3DToScreen(
  pos: { x: number; y: number; z: number },
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number
): { point: Point2D; inFront: boolean } {
  _vec3Scratch.set(pos.x, pos.y, pos.z);

  // Check camera-space depth (camera looks down negative Z)
  _vec3Scratch.applyMatrix4(camera.matrixWorldInverse);
  const inFront = _vec3Scratch.z < -0.01;

  // Project to NDC [-1, 1]
  _vec3Scratch.set(pos.x, pos.y, pos.z);
  _vec3Scratch.project(camera);

  const screenX = (_vec3Scratch.x * 0.5 + 0.5) * viewportWidth;
  const screenY = (-_vec3Scratch.y * 0.5 + 0.5) * viewportHeight;

  return {
    point: { x: screenX, y: screenY },
    inFront: inFront && _vec3Scratch.z >= -1 && _vec3Scratch.z <= 1,
  };
}

// ---------------------------------------------------------------------------
// Shape & Surface Selection Testing
// ---------------------------------------------------------------------------

/**
 * Tests whether a single 3D Shape matches the lasso selection polygon.
 */
export function isShapeInLasso(
  shape: Shape,
  sceneObj: THREE.Object3D | null,
  lassoPolygon: readonly Point2D[],
  lassoBox: BoundingBox2D,
  criteria: SelectionCriteria,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  if (shape.hidden) return false;

  // Gather candidate 3D sample points (bounding box corners + center)
  let corners3D: THREE.Vector3[] = [];
  let center3D: THREE.Vector3;

  if (sceneObj) {
    sceneObj.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(sceneObj);
    if (!bbox.isEmpty()) {
      corners3D = [
        new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
        new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
        new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
        new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
        new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
        new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
        new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
        new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z),
      ];
      center3D = bbox.getCenter(new THREE.Vector3());
    } else {
      center3D = sceneObj.position.clone();
      corners3D = [center3D];
    }
  } else {
    // Fallback if mesh not yet mounted in scene
    center3D = new THREE.Vector3(...shape.position);
    corners3D = [center3D];
  }

  // Project points to 2D
  const projectedCorners: Point2D[] = [];
  let allCornersInFront = true;
  let anyCornerInFront = false;

  for (const c of corners3D) {
    const { point, inFront } = project3DToScreen(c, camera, viewportWidth, viewportHeight);
    if (inFront) {
      anyCornerInFront = true;
      projectedCorners.push(point);
    } else {
      allCornersInFront = false;
    }
  }

  const { point: screenCenter, inFront: centerInFront } = project3DToScreen(
    center3D,
    camera,
    viewportWidth,
    viewportHeight
  );

  if (!anyCornerInFront && !centerInFront) return false;

  const shape2DBox = getBoundingBox2D([...projectedCorners, screenCenter]);

  if (criteria === 'window') {
    // Strict window: all corners and center must be in front and inside the lasso
    if (!allCornersInFront || !centerInFront) return false;
    if (!isBoundingBoxInside(shape2DBox, lassoBox)) return false;

    if (!isPointInPolygon(screenCenter, lassoPolygon)) return false;
    for (const p of projectedCorners) {
      if (!isPointInPolygon(p, lassoPolygon)) return false;
    }
    return true;
  } else {
    // Crossing: touches or overlaps
    if (!doBoundingBoxesOverlap(shape2DBox, lassoBox)) return false;

    // Fast check: center or any corner inside lasso
    if (centerInFront && isPointInPolygon(screenCenter, lassoPolygon)) return true;
    for (const p of projectedCorners) {
      if (isPointInPolygon(p, lassoPolygon)) return true;
    }

    // Check if lasso is inside the shape's projected 2D box/hull
    if (isPointInPolygon(lassoPolygon[0], [
      { x: shape2DBox.minX, y: shape2DBox.minY },
      { x: shape2DBox.maxX, y: shape2DBox.minY },
      { x: shape2DBox.maxX, y: shape2DBox.maxY },
      { x: shape2DBox.minX, y: shape2DBox.maxY },
    ])) {
      return true;
    }

    // Edge intersection check between shape 2D box and lasso polygon
    const boxPoly: Point2D[] = [
      { x: shape2DBox.minX, y: shape2DBox.minY },
      { x: shape2DBox.maxX, y: shape2DBox.minY },
      { x: shape2DBox.maxX, y: shape2DBox.maxY },
      { x: shape2DBox.minX, y: shape2DBox.maxY },
    ];
    return doPolygonsOverlap(lassoPolygon, boxPoly);
  }
}

/**
 * Tests whether a single Kernel Face matches the lasso selection polygon.
 */
export function isKernelFaceInLasso(
  graph: Graph,
  faceId: FaceId,
  lassoPolygon: readonly Point2D[],
  lassoBox: BoundingBox2D,
  criteria: SelectionCriteria,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  const face = graph.faces.get(faceId);
  if (!face || (face.attributes as any)?.hidden) return false;

  const points3D = loopPoints(graph, face.outerLoop);
  if (points3D.length < 3) return false;

  // Compute 3D centroid
  let sumX = 0, sumY = 0, sumZ = 0;
  for (const p of points3D) {
    sumX += p.x;
    sumY += p.y;
    sumZ += p.z;
  }
  const centroid3D = {
    x: sumX / points3D.length,
    y: sumY / points3D.length,
    z: sumZ / points3D.length,
  };

  const projectedVertices: Point2D[] = [];
  let allInFront = true;
  let anyInFront = false;

  for (const p of points3D) {
    const { point, inFront } = project3DToScreen(p, camera, viewportWidth, viewportHeight);
    if (inFront) {
      anyInFront = true;
      projectedVertices.push(point);
    } else {
      allInFront = false;
    }
  }

  const { point: screenCentroid, inFront: centroidInFront } = project3DToScreen(
    centroid3D,
    camera,
    viewportWidth,
    viewportHeight
  );

  if (!anyInFront && !centroidInFront) return false;

  const face2DBox = getBoundingBox2D([...projectedVertices, screenCentroid]);

  if (criteria === 'window') {
    // Window mode: entire face must be inside the lasso
    if (!allInFront || !centroidInFront) return false;
    if (!isBoundingBoxInside(face2DBox, lassoBox)) return false;

    if (!isPointInPolygon(screenCentroid, lassoPolygon)) return false;
    for (const v of projectedVertices) {
      if (!isPointInPolygon(v, lassoPolygon)) return false;
    }
    return true;
  } else {
    // Crossing mode: any part touches or overlaps
    if (!doBoundingBoxesOverlap(face2DBox, lassoBox)) return false;

    if (centroidInFront && isPointInPolygon(screenCentroid, lassoPolygon)) return true;
    for (const v of projectedVertices) {
      if (isPointInPolygon(v, lassoPolygon)) return true;
    }

    // Check if lasso overlaps face 2D polygon
    if (projectedVertices.length >= 3) {
      if (doPolygonsOverlap(lassoPolygon, projectedVertices)) return true;
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Evaluation Function
// ---------------------------------------------------------------------------

export interface EvaluateLassoParams {
  rawPoints: readonly Point2D[];
  options: LassoSelectionOptions;
  camera: THREE.Camera;
  viewportWidth: number;
  viewportHeight: number;
  shapes: Shape[];
  getSceneObjectById: (id: string | null) => THREE.Object3D | null;
  kernelGraph?: Graph | null;
  currentSelectedIds: string[];
  currentSelectedFaceIds: number[];
}

export interface EvaluateLassoResult {
  selectedShapeIds: string[];
  selectedFaceIds: number[];
  matchedShapeCount: number;
  matchedFaceCount: number;
}

/**
 * Runs selection matching against both Shapes and Kernel Surfaces.
 */
export function evaluateLassoSelection(params: EvaluateLassoParams): EvaluateLassoResult {
  const {
    rawPoints,
    options,
    camera,
    viewportWidth,
    viewportHeight,
    shapes,
    getSceneObjectById,
    kernelGraph,
    currentSelectedIds,
    currentSelectedFaceIds,
  } = params;

  if (rawPoints.length < 2) {
    return {
      selectedShapeIds: currentSelectedIds,
      selectedFaceIds: currentSelectedFaceIds,
      matchedShapeCount: 0,
      matchedFaceCount: 0,
    };
  }

  // Convert points to polygon based on mode
  let polygon: Point2D[];
  if (options.mode === 'marquee') {
    polygon = marqueeToPolygon(rawPoints[0], rawPoints[rawPoints.length - 1]);
  } else {
    // In lasso mode, at least 3 points are needed for a polygon
    if (rawPoints.length < 3) {
      polygon = marqueeToPolygon(rawPoints[0], rawPoints[rawPoints.length - 1]);
    } else {
      polygon = [...rawPoints];
    }
  }

  const lassoBox = getBoundingBox2D(polygon);
  const matchedShapeIds: string[] = [];
  const matchedFaceIds: number[] = [];

  // 1. Evaluate Shapes (if filter is 'all' or 'shapes')
  if (options.filter === 'all' || options.filter === 'shapes') {
    for (const shape of shapes) {
      const sceneObj = getSceneObjectById(shape.id);
      if (
        isShapeInLasso(
          shape,
          sceneObj,
          polygon,
          lassoBox,
          options.criteria,
          camera,
          viewportWidth,
          viewportHeight
        )
      ) {
        matchedShapeIds.push(shape.id);
      }
    }
  }

  // 2. Evaluate Kernel Surfaces (if filter is 'all' or 'surfaces')
  if (kernelGraph && (options.filter === 'all' || options.filter === 'surfaces')) {
    for (const faceId of kernelGraph.faces.keys()) {
      if (
        isKernelFaceInLasso(
          kernelGraph,
          faceId,
          polygon,
          lassoBox,
          options.criteria,
          camera,
          viewportWidth,
          viewportHeight
        )
      ) {
        matchedFaceIds.push(faceId);
      }
    }
  }

  // 3. Apply Additive / Subtractive / Replace logic
  let finalShapeIds: string[];
  let finalFaceIds: number[];

  if (options.isAdditive) {
    const shapeSet = new Set(currentSelectedIds);
    matchedShapeIds.forEach((id) => shapeSet.add(id));
    finalShapeIds = Array.from(shapeSet);

    const faceSet = new Set(currentSelectedFaceIds);
    matchedFaceIds.forEach((id) => faceSet.add(id));
    finalFaceIds = Array.from(faceSet);
  } else if (options.isSubtractive) {
    const toRemoveShapes = new Set(matchedShapeIds);
    finalShapeIds = currentSelectedIds.filter((id) => !toRemoveShapes.has(id));

    const toRemoveFaces = new Set(matchedFaceIds);
    finalFaceIds = currentSelectedFaceIds.filter((id) => !toRemoveFaces.has(id));
  } else {
    finalShapeIds = matchedShapeIds;
    finalFaceIds = matchedFaceIds;
  }

  return {
    selectedShapeIds: finalShapeIds,
    selectedFaceIds: finalFaceIds,
    matchedShapeCount: matchedShapeIds.length,
    matchedFaceCount: matchedFaceIds.length,
  };
}
