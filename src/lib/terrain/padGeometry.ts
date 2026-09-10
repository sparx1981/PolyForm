/**
 * PolyForm Terrain Studio - Building Pad & Civil Grading Geometry
 */

import type { PadModifier, CutFillMetrics } from './types';

/**
 * Pure function evaluating graded elevation, containment, and batter falloff at point (x, z).
 * Handles both 'rectangle' and 'circle' primitives with 'linear', 'curved', or 'stepped' batter profiles.
 *
 * @param x World X coordinate.
 * @param z World Z coordinate.
 * @param nativeY Original unmodified terrain elevation at (x, z).
 * @param pad The PadModifier object describing the grading platform.
 * @returns Evaluated target elevation, containment status, batter status, and elevation differential.
 */
export function calculatePadElevationAtPoint(
  x: number,
  z: number,
  nativeY: number,
  pad: PadModifier
): {
  targetY: number;
  isInside: boolean;
  isBatter: boolean;
  differential: number;
} {
  if (!pad || !pad.enabled) {
    return {
      targetY: nativeY,
      isInside: false,
      isBatter: false,
      differential: 0,
    };
  }

  const cx = pad.center[0];
  const cz = pad.center[2];
  const rotY = pad.rotationY || 0;

  // Transform point into pad-local 2D coordinates
  const dx = x - cx;
  const dz = z - cz;
  const cos = Math.cos(-rotY);
  const sin = Math.sin(-rotY);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;

  let isInside = false;
  let distToBoundary = 0;

  const dimX = pad.dimensions ? Math.max(0.01, pad.dimensions[0]) : 10;
  const dimZ = pad.dimensions ? Math.max(0, pad.dimensions[1]) : 10;

  if (pad.primitive === 'rectangle') {
    const halfX = dimX / 2;
    const halfZ = (dimZ > 0 ? dimZ : dimX) / 2;

    const qx = Math.abs(lx) - halfX;
    const qz = Math.abs(lz) - halfZ;

    if (qx <= 0 && qz <= 0) {
      isInside = true;
      distToBoundary = 0;
    } else {
      isInside = false;
      const ox = Math.max(0, qx);
      const oz = Math.max(0, qz);
      distToBoundary = Math.hypot(ox, oz);
    }
  } else {
    // Circle primitive (dimX represents full diameter or bounding extent)
    const radiusX = dimZ > 0 ? dimX / 2 : dimX;
    const radiusZ = dimZ > 0 ? dimZ / 2 : radiusX;

    if (radiusX === radiusZ) {
      const distFromCenter = Math.hypot(lx, lz);
      if (distFromCenter <= radiusX) {
        isInside = true;
        distToBoundary = 0;
      } else {
        isInside = false;
        distToBoundary = distFromCenter - radiusX;
      }
    } else {
      // Elliptical footprint
      const normDist = Math.hypot(lx / radiusX, lz / radiusZ);
      if (normDist <= 1.0) {
        isInside = true;
        distToBoundary = 0;
      } else {
        isInside = false;
        distToBoundary = (normDist - 1.0) * Math.min(radiusX, radiusZ);
      }
    }
  }

  // Inside the pad platform
  if (isInside) {
    return {
      targetY: pad.targetElevation,
      isInside: true,
      isBatter: false,
      differential: pad.targetElevation - nativeY,
    };
  }

  const batterDistance = Math.max(0, pad.batterDistance || 0);

  // Outside batter falloff zone
  if (batterDistance <= 0 || distToBoundary >= batterDistance) {
    return {
      targetY: nativeY,
      isInside: false,
      isBatter: false,
      differential: 0,
    };
  }

  // Inside batter daylight transition zone
  const t = Math.max(0, Math.min(1, distToBoundary / batterDistance));
  let factor: number;

  switch (pad.batterProfile) {
    case 'linear':
      factor = t;
      break;
    case 'curved':
      // Hermite smoothstep (C1 continuity at both boundaries)
      factor = t * t * (3 - 2 * t);
      break;
    case 'stepped': {
      // 4-step horizontal bench grading
      const steps = 4;
      factor = Math.min(1, Math.max(0, Math.floor(t * steps) / steps));
      break;
    }
    default:
      factor = t;
  }

  // Blend from pad.targetElevation (factor 0) to nativeY (factor 1)
  const targetY =
    pad.targetElevation + (nativeY - pad.targetElevation) * factor;

  return {
    targetY,
    isInside: false,
    isBatter: true,
    differential: targetY - nativeY,
  };
}

/**
 * Computes cut and fill earthwork volumes and surface areas for a pad across a terrain grid.
 */
export function calculateCutFillForPad(
  pad: PadModifier,
  grid: {
    heights: number[];
    gridX: number;
    gridY: number;
    width: number;
    depth: number;
  }
): CutFillMetrics {
  let cutVol = 0;
  let fillVol = 0;
  let cutArea = 0;
  let fillArea = 0;

  const dx = grid.width / Math.max(1, grid.gridX - 1);
  const dz = grid.depth / Math.max(1, grid.gridY - 1);
  const cellArea = dx * dz;

  const halfW = grid.width / 2;
  const halfD = grid.depth / 2;

  for (let gy = 0; gy < grid.gridY; gy++) {
    const z = -halfD + gy * dz;
    for (let gx = 0; gx < grid.gridX; gx++) {
      const x = -halfW + gx * dx;
      const idx = gy * grid.gridX + gx;
      const nativeY = grid.heights[idx] ?? 0;

      const evalResult = calculatePadElevationAtPoint(x, z, nativeY, pad);
      if (evalResult.isInside || evalResult.isBatter) {
        const diff = evalResult.differential;
        if (diff > 0) {
          // Fill required (target higher than native)
          fillVol += diff * cellArea;
          fillArea += cellArea;
        } else if (diff < 0) {
          // Cut required (target lower than native)
          cutVol += -diff * cellArea;
          cutArea += cellArea;
        }
      }
    }
  }

  return {
    cutVolumeM3: cutVol,
    fillVolumeM3: fillVol,
    netVolumeM3: fillVol - cutVol,
    cutAreaM2: cutArea,
    fillAreaM2: fillArea,
  };
}

/**
 * Modifies a terrain shape's heights array by applying pad grading and daylight batter slopes.
 * Adjusts terrain heights at all vertices covered by the pad footprint and batter transition.
 *
 * @param terrain The terrain Shape object.
 * @param pad The PadModifier object describing the grading platform.
 * @returns Updated TerrainData with adjusted heights, or null if unmodified.
 */
export function applyPadGradingToTerrain(
  terrain: { terrainData?: { gridX: number; gridY: number; width: number; depth: number; heights: number[] }; position: [number, number, number] },
  pad: PadModifier
): { gridX: number; gridY: number; width: number; depth: number; heights: number[] } | null {
  if (!terrain.terrainData) return null;
  const { gridX, gridY, width, depth, heights } = terrain.terrainData;
  const posX = terrain.position[0];
  const posY = terrain.position[1];
  const posZ = terrain.position[2];

  const newHeights = [...heights];
  let modified = false;

  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const worldX = posX - width / 2 + (ix / Math.max(1, gridX - 1)) * width;
      const worldZ = posZ - depth / 2 + (iy / Math.max(1, gridY - 1)) * depth;

      const idx = iy * gridX + ix;
      const nativeY = posY + (heights[idx] ?? 0);

      const res = calculatePadElevationAtPoint(worldX, worldZ, nativeY, pad);
      if (res.isInside || res.isBatter) {
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
