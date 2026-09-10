/**
 * PolyForm Terrain Studio - Road Ribbon & Corridor Geometry
 */

import * as THREE from 'three';
import type { CurbDitchProfile } from './types';
import type { RoadModifier, TerrainModifier, PadModifier, TerrainData } from '../../types';
import { evaluateCatmullRomSpline, distancePointToLineSegment2D } from './math';
import { calculatePadElevationAtPoint } from './padGeometry';

interface CrossSectionPoint {
  offset: number;
  height: number;
}

/**
 * Builds the transverse cross-section slices for a road corridor based on road width,
 * curb dimensions, and roadside drainage ditches.
 */
function buildCrossSectionProfile(
  width: number,
  profile: CurbDitchProfile
): { points: CrossSectionPoint[]; minOffset: number; maxOffset: number } {
  const halfW = Math.max(0.05, width / 2);
  const hasCurb = Boolean(profile?.hasCurb);
  const hasDitch = Boolean(profile?.hasDitch);

  const curbW = hasCurb ? Math.max(0.01, profile.width || 0.15) : 0;
  const curbH = hasCurb ? Math.max(0.01, profile.height || 0.15) : 0;
  const ditchW = hasDitch ? Math.max(0.01, profile.ditchWidth || 1.2) : 0;
  const ditchD = hasDitch ? Math.max(0.01, profile.ditchDepth || 0.35) : 0;

  const points: CrossSectionPoint[] = [];

  // 1. Left drainage ditch (sloping inward from daylight to shoulder)
  if (hasDitch) {
    const outerLeft = -(halfW + curbW + ditchW);
    const invertLeft = -(halfW + curbW + ditchW / 2);
    const innerLeft = -(halfW + curbW);

    points.push({ offset: outerLeft, height: 0 });
    points.push({ offset: invertLeft, height: -ditchD });
    points.push({ offset: innerLeft, height: 0 });
  }

  // 2. Left extruded curb (back bottom -> back top -> front top -> front gutter)
  if (hasCurb) {
    const curbBack = -(halfW + curbW);
    const curbFront = -halfW;

    // Only add back bottom if ditch wasn't present (otherwise ditch inner point is already there)
    if (!hasDitch) {
      points.push({ offset: curbBack, height: 0 });
    }
    points.push({ offset: curbBack, height: curbH });
    points.push({ offset: curbFront, height: curbH });
    points.push({ offset: curbFront, height: 0 });
  }

  // 3. Road pavement surface (left edge, centerline, right edge)
  points.push({ offset: -halfW, height: 0 });
  points.push({ offset: 0, height: 0 });
  points.push({ offset: halfW, height: 0 });

  // 4. Right extruded curb (front gutter -> front top -> back top -> back bottom)
  if (hasCurb) {
    const curbFront = halfW;
    const curbBack = halfW + curbW;

    points.push({ offset: curbFront, height: 0 });
    points.push({ offset: curbFront, height: curbH });
    points.push({ offset: curbBack, height: curbH });
    points.push({ offset: curbBack, height: 0 });
  }

  // 5. Right drainage ditch (shoulder -> invert -> daylight)
  if (hasDitch) {
    const innerRight = halfW + curbW;
    const invertRight = halfW + curbW + ditchW / 2;
    const outerRight = halfW + curbW + ditchW;

    if (!hasCurb) {
      points.push({ offset: innerRight, height: 0 });
    }
    points.push({ offset: invertRight, height: -ditchD });
    points.push({ offset: outerRight, height: 0 });
  }

  let minOffset = points[0]?.offset ?? -halfW;
  let maxOffset = points[points.length - 1]?.offset ?? halfW;
  for (const pt of points) {
    if (pt.offset < minOffset) minOffset = pt.offset;
    if (pt.offset > maxOffset) maxOffset = pt.offset;
  }

  return { points, minOffset, maxOffset };
}

/**
 * Pure function generating a Three.js BufferGeometry representing a 3D road corridor ribbon
 * swept along splinePoints with position, normal, and uv attributes.
 * Includes extruded curb steps and drainage ditches when enabled.
 *
 * @param splinePoints Array of 3D points [x, y, z] along the road centerline spline.
 * @param width Carriageway pavement width in meters.
 * @param profile Profile configuring curb dimensions, ditch width/depth, and enable toggles.
 * @returns Three.js BufferGeometry with position, normal, and uv attributes.
 */
export function generateRoadRibbonGeometry(
  splinePoints: [number, number, number][],
  width: number,
  profile: CurbDitchProfile
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  if (!splinePoints || splinePoints.length < 2) {
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(0), 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(0), 3)
    );
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(0), 2)
    );
    return geometry;
  }

  // Filter out adjacent duplicate points
  const cleanPoints: [number, number, number][] = [splinePoints[0]];
  for (let i = 1; i < splinePoints.length; i++) {
    const prev = cleanPoints[cleanPoints.length - 1];
    const curr = splinePoints[i];
    const distSq =
      (curr[0] - prev[0]) ** 2 +
      (curr[1] - prev[1]) ** 2 +
      (curr[2] - prev[2]) ** 2;
    if (distSq > 1e-6) {
      cleanPoints.push(curr);
    }
  }

  if (cleanPoints.length < 2) {
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(0), 3)
    );
    geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(0), 3)
    );
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(0), 2)
    );
    return geometry;
  }

  const { points: slicePoints, minOffset, maxOffset } = buildCrossSectionProfile(
    width,
    profile
  );
  const totalOffsetSpan = Math.max(0.01, maxOffset - minOffset);

  const numSlices = cleanPoints.length;
  const numSlicePoints = slicePoints.length;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Compute cumulative station distances for V texture coordinates
  const stationDistances: number[] = [0];
  for (let i = 1; i < numSlices; i++) {
    const prev = cleanPoints[i - 1];
    const curr = cleanPoints[i];
    const dist = Math.hypot(
      curr[0] - prev[0],
      curr[1] - prev[1],
      curr[2] - prev[2]
    );
    stationDistances.push(stationDistances[i - 1] + dist);
  }

  const up = new THREE.Vector3(0, 1, 0);

  // Generate vertices
  for (let i = 0; i < numSlices; i++) {
    const center = new THREE.Vector3(...cleanPoints[i]);
    const tangent = new THREE.Vector3();

    if (i === 0) {
      tangent.subVectors(
        new THREE.Vector3(...cleanPoints[1]),
        new THREE.Vector3(...cleanPoints[0])
      );
    } else if (i === numSlices - 1) {
      tangent.subVectors(
        new THREE.Vector3(...cleanPoints[i]),
        new THREE.Vector3(...cleanPoints[i - 1])
      );
    } else {
      tangent.subVectors(
        new THREE.Vector3(...cleanPoints[i + 1]),
        new THREE.Vector3(...cleanPoints[i - 1])
      );
    }

    if (tangent.lengthSq() < 1e-8) {
      tangent.set(0, 0, 1);
    } else {
      tangent.normalize();
    }

    // Right vector pointing laterally across the road
    const right = new THREE.Vector3().crossVectors(up, tangent);
    if (right.lengthSq() < 1e-8) {
      right.set(1, 0, 0);
    } else {
      right.normalize();
    }

    // Surface normal vector perpendicular to road plane
    const normal = new THREE.Vector3().crossVectors(tangent, right).normalize();

    const vCoord = stationDistances[i];

    for (let j = 0; j < numSlicePoints; j++) {
      const slicePt = slicePoints[j];
      const pos = center
        .clone()
        .addScaledVector(right, slicePt.offset)
        .addScaledVector(normal, slicePt.height + 0.02); // +20mm safety elevation bias above subgrade to eliminate surface z-fighting

      positions.push(pos.x, pos.y, pos.z);

      const uCoord = (slicePt.offset - minOffset) / totalOffsetSpan;
      uvs.push(uCoord, vCoord);
    }
  }

  // Generate index buffer for quad strips
  for (let i = 0; i < numSlices - 1; i++) {
    for (let j = 0; j < numSlicePoints - 1; j++) {
      const p00 = i * numSlicePoints + j;
      const p10 = (i + 1) * numSlicePoints + j;
      const p11 = (i + 1) * numSlicePoints + (j + 1);
      const p01 = i * numSlicePoints + (j + 1);

      // Triangles with upward outward normal winding
      indices.push(p00, p01, p11);
      indices.push(p00, p11, p10);
    }
  }

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Evaluates target terrain elevation and batter falloff for a road corridor at point (x, z).
 */
export function calculateRoadElevationAtPoint(
  worldX: number,
  worldZ: number,
  nativeY: number,
  road: RoadModifier,
  sampledSpline?: [number, number, number][]
): { targetY: number; isUnderRoad: boolean; isBatter: boolean } {
  if (!road || !road.enabled || !road.points || road.points.length < 2) {
    return { targetY: nativeY, isUnderRoad: false, isBatter: false };
  }

  const sampled = sampledSpline || evaluateCatmullRomSpline(road.points, 12, false);
  if (sampled.length < 2) {
    return { targetY: nativeY, isUnderRoad: false, isBatter: false };
  }

  const halfW = Math.max(0.2, road.width / 2);
  const curbW = road.profile?.hasCurb ? (road.profile.width || 0.3) : 0;
  const ditchW = road.profile?.hasDitch ? (road.profile.ditchWidth || 0.8) : 0;
  const fullRoadHalfWidth = halfW + curbW + ditchW;
  const daylightBatter = Math.max(0.8, road.batterDistance ?? 1.8);
  const totalCorridorRadius = fullRoadHalfWidth + daylightBatter;

  let minDist = Infinity;
  let roadElevationAtClosest = nativeY;

  for (let i = 0; i < sampled.length - 1; i++) {
    const p1 = sampled[i];
    const p2 = sampled[i + 1];

    const seg = distancePointToLineSegment2D(worldX, worldZ, p1[0], p1[2], p2[0], p2[2]);
    if (seg.distance < minDist) {
      minDist = seg.distance;
      roadElevationAtClosest = p1[1] + (p2[1] - p1[1]) * seg.t;
    }
  }

  if (minDist > totalCorridorRadius) {
    return { targetY: nativeY, isUnderRoad: false, isBatter: false };
  }

  // Civil subgrade excavation: 160mm subbase bedding below pavement surface
  const subgradeElev = roadElevationAtClosest - 0.16;

  if (minDist <= fullRoadHalfWidth) {
    // Directly underneath road ribbon pavement, curb, or ditch - terrain cannot protrude through
    return { targetY: subgradeElev, isUnderRoad: true, isBatter: false };
  }

  // Daylight shoulder batter transition
  const t = Math.max(0, Math.min(1, (minDist - fullRoadHalfWidth) / daylightBatter));
  // Smoothstep blend to natural terrain
  const factor = t * t * (3 - 2 * t);
  const targetY = subgradeElev + (nativeY - subgradeElev) * factor;

  return { targetY, isUnderRoad: false, isBatter: true };
}

/**
 * Modifies a terrain shape's heights array by applying road corridor grading and daylight batter slopes.
 * Eliminates clashes and terrain peaking through the road ribbon.
 */
export function applyRoadGradingToTerrain(
  terrain: { terrainData?: { gridX: number; gridY: number; width: number; depth: number; heights: number[] }; position: [number, number, number] },
  road: RoadModifier
): { gridX: number; gridY: number; width: number; depth: number; heights: number[] } | null {
  if (!terrain.terrainData || !road.points || road.points.length < 2) return null;
  const { gridX, gridY, width, depth, heights } = terrain.terrainData;
  const posX = terrain.position[0];
  const posY = terrain.position[1];
  const posZ = terrain.position[2];

  const sampled = evaluateCatmullRomSpline(road.points, 12, false);
  const newHeights = [...heights];
  let modified = false;

  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const worldX = posX - width / 2 + (ix / Math.max(1, gridX - 1)) * width;
      const worldZ = posZ - depth / 2 + (iy / Math.max(1, gridY - 1)) * depth;

      const idx = iy * gridX + ix;
      const nativeY = posY + (heights[idx] ?? 0);

      const res = calculateRoadElevationAtPoint(worldX, worldZ, nativeY, road, sampled);
      if (res.isUnderRoad || res.isBatter) {
        const targetLocalH = res.targetY - posY;
        if (Math.abs(newHeights[idx] - targetLocalH) > 1e-4) {
          newHeights[idx] = targetLocalH;
          modified = true;
        }
      }
    }
  }

  return modified ? { ...terrain.terrainData, heights: newHeights } : null;
}

/**
 * Recalculates the complete terrain heightfield from its pristine baseHeights,
 * applying all enabled road corridors and building pads in deterministic order.
 * Ensures that changes to road width, curb, ditch, or pad dimensions immediately
 * and accurately update the terrain without accumulating permanent grading artifacts.
 */
export function regradeTerrainWithModifiers(
  terrain: { terrainData?: TerrainData; position: [number, number, number] },
  modifiers: TerrainModifier[]
): TerrainData | null {
  if (!terrain.terrainData) return null;
  const { gridX, gridY, width, depth, heights } = terrain.terrainData;
  const baseHeights = terrain.terrainData.baseHeights && terrain.terrainData.baseHeights.length === heights.length
    ? terrain.terrainData.baseHeights
    : [...heights];

  const posX = terrain.position[0];
  const posY = terrain.position[1];
  const posZ = terrain.position[2];

  const enabledPads = modifiers.filter((m): m is PadModifier => m.type === 'pad' && m.enabled);
  const enabledRoads = modifiers.filter((m): m is RoadModifier => m.type === 'road' && m.enabled && Boolean(m.points && m.points.length >= 2));

  // Pre-sample road splines for high performance across the grid
  const sampledRoads = enabledRoads.map(road => ({
    road,
    sampled: evaluateCatmullRomSpline(road.points, 12, false),
  }));

  const newHeights = [...baseHeights];
  let anyChange = false;

  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const idx = iy * gridX + ix;
      const worldX = posX - width / 2 + (ix / Math.max(1, gridX - 1)) * width;
      const worldZ = posZ - depth / 2 + (iy / Math.max(1, gridY - 1)) * depth;

      let currentWorldY = posY + baseHeights[idx];

      // 1. Apply building and grading pads first
      for (const pad of enabledPads) {
        const padRes = calculatePadElevationAtPoint(worldX, worldZ, currentWorldY, pad);
        if (padRes.isInside || padRes.isBatter) {
          currentWorldY = padRes.targetY;
        }
      }

      // 2. Apply road corridors and grading
      for (const { road, sampled } of sampledRoads) {
        const roadRes = calculateRoadElevationAtPoint(worldX, worldZ, currentWorldY, road, sampled);
        if (roadRes.isUnderRoad || roadRes.isBatter) {
          currentWorldY = roadRes.targetY;
        }
      }

      const targetLocalHeight = currentWorldY - posY;
      if (Math.abs(newHeights[idx] - targetLocalHeight) > 1e-4) {
        newHeights[idx] = targetLocalHeight;
        anyChange = true;
      }
    }
  }

  return {
    ...terrain.terrainData,
    baseHeights,
    heights: newHeights,
  };
}


