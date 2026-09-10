/**
 * PolyForm Terrain Studio - Off-thread Terrain Raster Worker
 * Performs high-performance cut-and-fill rasterization and heightmap evaluation.
 */

import { CutFillMetrics, TerrainModifier, PadModifier, RoadModifier, BatterFalloffType } from '../types';
import { evaluateCatmullRomSpline, distancePointToLineSegment2D } from '../lib/terrain/math';

export interface TerrainRasterWorkerInput {
  gridWidth: number;
  gridDepth: number;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  baseHeights: Float32Array | number[];
  modifiers: TerrainModifier[];
}

export interface TerrainRasterWorkerOutput {
  metrics: CutFillMetrics;
  modifiedHeights: Float32Array;
  diffHeights: Float32Array;
}

function evaluateBatter(t: number, profile: BatterFalloffType): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (profile) {
    case 'curved':
      return clamped * clamped * (3 - 2 * clamped);
    case 'stepped':
      return Math.round(clamped * 4) / 4;
    case 'linear':
    default:
      return clamped;
  }
}

/**
 * Pure calculation engine for terrain rasterization and cut/fill volume computation.
 */
export function computeTerrainRaster(input: TerrainRasterWorkerInput): TerrainRasterWorkerOutput {
  const { gridWidth, gridDepth, bounds, baseHeights, modifiers } = input;
  const totalCells = gridWidth * gridDepth;
  const modifiedHeights = new Float32Array(totalCells);
  const diffHeights = new Float32Array(totalCells);

  const rangeX = bounds.maxX - bounds.minX;
  const rangeZ = bounds.maxZ - bounds.minZ;
  const stepX = rangeX / Math.max(1, gridWidth - 1);
  const stepZ = rangeZ / Math.max(1, gridDepth - 1);
  const cellArea = stepX * stepZ;

  // Pre-sample road splines
  const activeRoads = modifiers
    .filter((m): m is RoadModifier => m.enabled && m.type === 'road' && m.points.length >= 2)
    .map(road => {
      const sampled = evaluateCatmullRomSpline(road.points, 12, false);
      return {
        road,
        sampled,
        halfWidth: road.width * 0.5,
        batterDist: 3.0,
      };
    });

  const activePads = modifiers
    .filter((m): m is PadModifier => m.enabled && m.type === 'pad')
    .map(pad => ({
      pad,
      halfW: pad.dimensions[0] * 0.5,
      halfD: pad.dimensions[1] * 0.5,
      radius: pad.dimensions[0] * 0.5,
      cosR: Math.cos(-(pad.rotationY || 0)),
      sinR: Math.sin(-(pad.rotationY || 0)),
    }));

  let totalCutVolume = 0;
  let totalFillVolume = 0;
  let totalCutArea = 0;
  let totalFillArea = 0;

  for (let iz = 0; iz < gridDepth; iz++) {
    const wz = bounds.minZ + iz * stepZ;
    const rowOffset = iz * gridWidth;

    for (let ix = 0; ix < gridWidth; ix++) {
      const wx = bounds.minX + ix * stepX;
      const idx = rowOffset + ix;
      const baseH = baseHeights[idx] !== undefined ? baseHeights[idx] : 0;
      let currentH = baseH;

      // 1. Evaluate Pads in order
      for (const { pad, halfW, halfD, radius, cosR, sinR } of activePads) {
        const dx = wx - pad.center[0];
        const dz = wz - pad.center[2];
        const localX = dx * cosR - dz * sinR;
        const localZ = dx * sinR + dz * cosR;

        if (pad.primitive === 'circle') {
          const dist = Math.hypot(localX, localZ);
          if (dist <= radius) {
            currentH = pad.targetElevation;
          } else if (dist <= radius + pad.batterDistance && pad.batterDistance > 0) {
            const t = (dist - radius) / pad.batterDistance;
            const factor = evaluateBatter(t, pad.batterProfile);
            currentH = pad.targetElevation * (1 - factor) + currentH * factor;
          }
        } else {
          // Rectangle
          const distX = Math.max(0, Math.abs(localX) - halfW);
          const distZ = Math.max(0, Math.abs(localZ) - halfD);
          const distEdge = Math.hypot(distX, distZ);

          if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
            currentH = pad.targetElevation;
          } else if (distEdge <= pad.batterDistance && pad.batterDistance > 0) {
            const t = distEdge / pad.batterDistance;
            const factor = evaluateBatter(t, pad.batterProfile);
            currentH = pad.targetElevation * (1 - factor) + currentH * factor;
          }
        }
      }

      // 2. Evaluate Roads
      for (const { road, sampled, halfWidth, batterDist } of activeRoads) {
        if (sampled.length < 2) continue;

        let minDist = Infinity;
        let bestElevation = currentH;
        let bestT = 0;

        for (let s = 0; s < sampled.length - 1; s++) {
          const p0 = sampled[s];
          const p1 = sampled[s + 1];
          const result = distancePointToLineSegment2D(wx, wz, p0[0], p0[2], p1[0], p1[2]);
          if (result.distance < minDist) {
            minDist = result.distance;
            bestT = result.t;
            bestElevation = p0[1] + bestT * (p1[1] - p0[1]);
          }
        }

        if (minDist <= halfWidth) {
          // Road carriage surface
          let roadElevation = bestElevation;
          // Curb edge
          if (road.profile?.hasCurb && minDist > halfWidth - (road.profile.width || 0.15)) {
            roadElevation += (road.profile.height || 0.15);
          }
          currentH = roadElevation;
        } else if (road.profile?.hasDitch && minDist <= halfWidth + (road.profile.ditchWidth || 1.2)) {
          // Ditch profile
          const ditchW = road.profile.ditchWidth || 1.2;
          const ditchD = road.profile.ditchDepth || 0.35;
          const tDitch = (minDist - halfWidth) / ditchW;
          const vOffset = -Math.sin(tDitch * Math.PI) * ditchD;
          const blend = bestElevation + vOffset;
          currentH = blend * (1 - tDitch * 0.4) + currentH * (tDitch * 0.4);
        } else if (minDist <= halfWidth + batterDist) {
          const t = (minDist - halfWidth) / batterDist;
          currentH = bestElevation * (1 - t) + currentH * t;
        }
      }

      modifiedHeights[idx] = currentH;
      const diff = currentH - baseH;
      diffHeights[idx] = diff;

      // Cut / Fill volume accumulation
      if (diff < -0.01) {
        totalCutVolume += Math.abs(diff) * cellArea;
        totalCutArea += cellArea;
      } else if (diff > 0.01) {
        totalFillVolume += diff * cellArea;
        totalFillArea += cellArea;
      }
    }
  }

  const metrics: CutFillMetrics = {
    cutVolumeM3: Math.round(totalCutVolume * 10) / 10,
    fillVolumeM3: Math.round(totalFillVolume * 10) / 10,
    netVolumeM3: Math.round((totalFillVolume - totalCutVolume) * 10) / 10,
    cutAreaM2: Math.round(totalCutArea * 10) / 10,
    fillAreaM2: Math.round(totalFillArea * 10) / 10,
  };

  return {
    metrics,
    modifiedHeights,
    diffHeights,
  };
}

// Worker message listener if in Web Worker context
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e: MessageEvent<TerrainRasterWorkerInput>) => {
    try {
      const result = computeTerrainRaster(e.data);
      // Transfer Float32Array buffers for maximum performance
      (self as any).postMessage(result, [result.modifiedHeights.buffer, result.diffHeights.buffer]);
    } catch (err) {
      console.error('Terrain raster worker error:', err);
    }
  };
}
