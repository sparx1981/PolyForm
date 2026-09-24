import * as THREE from 'three';
import { Shape, TerrainModifier, PadModifier, RoadModifier } from '../../types';
import { sampleTerrainElevation } from '../archRoomAssembly';
import { evaluateCatmullRomSpline, distancePointToLineSegment2D } from './math';

/**
 * Floor slab and road footprint descriptor used for high-speed exclusion tests.
 */
export interface SlabFootprint {
  polygon?: Array<[number, number]>;
  boxMinX?: number;
  boxMaxX?: number;
  boxMinZ?: number;
  boxMaxZ?: number;
  roadSegment?: {
    x1: number;
    z1: number;
    x2: number;
    z2: number;
    halfWidth: number;
  };
  ceilingY: number;
}

/**
 * Determines if a 2D point (px, pz) lies inside a polygon defined by 2D vertices.
 */
function isPointInPolygon2D(px: number, pz: number, polygon: Array<[number, number]>): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const zi = polygon[i][1];
    const xj = polygon[j][0];
    const zj = polygon[j][1];

    const intersect = ((zi > pz) !== (zj > pz)) &&
      (px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Extracts floor slab, civil pad, and road footprints from the scene graph shapes and terrain modifiers.
 * Ensures procedural grass is never placed under or inside floor slabs or roads.
 */
export function extractExclusionFootprints(
  shapes: Shape[],
  terrainModifiers: TerrainModifier[] = []
): SlabFootprint[] {
  const footprints: SlabFootprint[] = [];

  for (const s of shapes) {
    if (s.hidden) continue;

    const name = (s.name || '').toLowerCase();
    const tags = s.tags || [];

    const isSlab =
      tags.includes('floor-slab') ||
      tags.includes('ceiling-slab') ||
      tags.includes('slab') ||
      tags.includes('floor') ||
      tags.includes('foundation') ||
      tags.includes('foundation-skirt') ||
      name.includes('floor slab') ||
      name.includes('slab') ||
      name.includes('floor') ||
      name.includes('foundation') ||
      name.includes('deck') ||
      name.includes('patio') ||
      name.includes('porch') ||
      (s.type === 'poly' && tags.includes('architecture'));

    const isRoadShape =
      tags.includes('road') ||
      tags.includes('street') ||
      tags.includes('driveway') ||
      tags.includes('pathway') ||
      tags.includes('parking') ||
      tags.includes('pavement') ||
      tags.includes('asphalt') ||
      name.includes('road') ||
      name.includes('street') ||
      name.includes('driveway') ||
      name.includes('parking') ||
      name.includes('pathway') ||
      name.includes('asphalt') ||
      name.includes('pavement');

    if (isSlab || isRoadShape) {
      const pos = s.position || [0, 0, 0];
      const height = (s.args as any)?.height || (Array.isArray(s.args) ? s.args[1] : 0.2) || 0.2;
      // Generous ceiling threshold so terrain below the slab or road is safely culled
      const ceilingY = pos[1] + height + 2.0;

      if (s.type === 'poly' && Array.isArray((s.args as any)?.vertices)) {
        const polyVerts = (s.args as any).vertices as Array<[number, number] | { x: number; y?: number; z?: number }>;
        const yaw = s.rotation ? s.rotation[1] : 0;
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);

        const worldPoly: Array<[number, number]> = polyVerts.map(v => {
          const vx = Array.isArray(v) ? v[0] : (v.x ?? 0);
          const vz = Array.isArray(v) ? v[1] : (v.z ?? (v as any).y ?? 0);
          const rx = cosY * vx - sinY * vz;
          const rz = sinY * vx + cosY * vz;
          return [pos[0] + rx, pos[2] + rz];
        });

        // Compute AABB for fast bounding rejection
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [px, pz] of worldPoly) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (pz < minZ) minZ = pz;
          if (pz > maxZ) maxZ = pz;
        }

        footprints.push({
          polygon: worldPoly,
          boxMinX: minX - 0.2,
          boxMaxX: maxX + 0.2,
          boxMinZ: minZ - 0.2,
          boxMaxZ: maxZ + 0.2,
          ceilingY
        });
      } else if (s.type === 'circle') {
        const radius = (Array.isArray(s.args) ? (s.args[0] || 5) : 5) + 0.2;
        const circlePoly: Array<[number, number]> = [];
        for (let a = 0; a < 24; a++) {
          const theta = (a / 24) * Math.PI * 2;
          circlePoly.push([pos[0] + Math.cos(theta) * radius, pos[2] + Math.sin(theta) * radius]);
        }
        footprints.push({
          polygon: circlePoly,
          boxMinX: pos[0] - radius,
          boxMaxX: pos[0] + radius,
          boxMinZ: pos[2] - radius,
          boxMaxZ: pos[2] + radius,
          ceilingY
        });
      } else if (Array.isArray(s.args) || s.type === 'box' || s.type === 'rect') {
        const [w, , d] = (Array.isArray(s.args) ? s.args : [2, 0.2, 2]) as number[];
        const width = w || 1;
        const depth = d || (s.type === 'rect' ? (s.args as any)[1] : width) || 1;
        const halfW = width / 2 + 0.2;
        const halfD = depth / 2 + 0.2;

        const yaw = s.rotation ? s.rotation[1] : 0;
        if (Math.abs(yaw) > 0.01) {
          // Rotated box: polygon corners
          const cosY = Math.cos(yaw);
          const sinY = Math.sin(yaw);
          const corners: Array<[number, number]> = [
            [-halfW, -halfD],
            [halfW, -halfD],
            [halfW, halfD],
            [-halfW, halfD]
          ].map(([cx, cz]) => [
            pos[0] + (cosY * cx - sinY * cz),
            pos[2] + (sinY * cx + cosY * cz)
          ]);

          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const [px, pz] of corners) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (pz < minZ) minZ = pz;
            if (pz > maxZ) maxZ = pz;
          }

          footprints.push({
            polygon: corners,
            boxMinX: minX,
            boxMaxX: maxX,
            boxMinZ: minZ,
            boxMaxZ: maxZ,
            ceilingY
          });
        } else {
          // Axis-aligned box
          footprints.push({
            boxMinX: pos[0] - halfW,
            boxMaxX: pos[0] + halfW,
            boxMinZ: pos[2] - halfD,
            boxMaxZ: pos[2] + halfD,
            ceilingY
          });
        }
      }
    }
  }

  // Exclude civil pad surfaces (building foundations)
  for (const mod of terrainModifiers) {
    if (mod.type === 'pad' && mod.enabled !== false) {
      const pad = mod as PadModifier;
      if (pad.center && pad.dimensions) {
        const [cx, cy, cz] = pad.center;
        const [w, d] = pad.dimensions;
        const halfW = w / 2 + 0.2;
        const halfD = (d || w) / 2 + 0.2;
        const rotY = pad.rotationY || 0;
        const ceilingY = (pad.targetElevation ?? cy) + 2.0;

        if (Math.abs(rotY) > 0.01) {
          const cosY = Math.cos(rotY);
          const sinY = Math.sin(rotY);
          const corners: Array<[number, number]> = [
            [-halfW, -halfD],
            [halfW, -halfD],
            [halfW, halfD],
            [-halfW, halfD]
          ].map(([lx, lz]) => [
            cx + (cosY * lx - sinY * lz),
            cz + (sinY * lx + cosY * lz)
          ]);

          footprints.push({
            polygon: corners,
            ceilingY
          });
        } else {
          footprints.push({
            boxMinX: cx - halfW,
            boxMaxX: cx + halfW,
            boxMinZ: cz - halfD,
            boxMaxZ: cz + halfD,
            ceilingY
          });
        }
      }
    }
  }

  // Exclude civil road corridors (RoadModifier)
  for (const mod of terrainModifiers) {
    if (mod.type === 'road' && mod.enabled !== false) {
      const road = mod as RoadModifier;
      if (road.points && road.points.length >= 2) {
        const halfW = Math.max(0.2, (road.width || 6) / 2);
        const curbW = road.profile?.hasCurb ? (road.profile.width || 0.3) : 0;
        const ditchW = road.profile?.hasDitch ? (road.profile.ditchWidth || 0.8) : 0;
        // Half-width with 0.35m clearance margin so grass blades at the edge don't clip through asphalt
        const corridorHalfWidth = halfW + curbW + ditchW + 0.35;
        const sampled = evaluateCatmullRomSpline(road.points, 12, false);

        for (let i = 0; i < sampled.length - 1; i++) {
          const p1 = sampled[i];
          const p2 = sampled[i + 1];
          const segElevation = Math.max(p1[1], p2[1]);
          footprints.push({
            roadSegment: {
              x1: p1[0],
              z1: p1[2],
              x2: p2[0],
              z2: p2[2],
              halfWidth: corridorHalfWidth
            },
            ceilingY: segElevation + 2.0
          });
        }
      }
    }
  }

  return footprints;
}

/**
 * Checks if candidate point (x, y, z) falls within any floor slab, pad, or road exclusion footprint.
 */
export function isPointExcluded(x: number, y: number, z: number, footprints: SlabFootprint[]): boolean {
  for (const fp of footprints) {
    // If candidate point elevation is above ceiling threshold, it's above the slab/road.
    // Otherwise, it is at or below the slab/road, so it is strictly culled.
    if (z !== undefined && y > fp.ceilingY) continue;

    // Fast AABB check if present
    if (fp.boxMinX !== undefined && fp.boxMaxX !== undefined && fp.boxMinZ !== undefined && fp.boxMaxZ !== undefined) {
      if (x >= fp.boxMinX && x <= fp.boxMaxX && z >= fp.boxMinZ && z <= fp.boxMaxZ) {
        if (fp.polygon && fp.polygon.length >= 3) {
          if (isPointInPolygon2D(x, z, fp.polygon)) {
            return true;
          }
        } else {
          return true;
        }
      }
      continue;
    }

    // Polygon check (for rotated shapes or poly slabs)
    if (fp.polygon && fp.polygon.length >= 3) {
      if (isPointInPolygon2D(x, z, fp.polygon)) {
        return true;
      }
    }

    // Road segment check (capsule distance to road centerline)
    if (fp.roadSegment) {
      const { x1, z1, x2, z2, halfWidth } = fp.roadSegment;
      const minX = Math.min(x1, x2) - halfWidth;
      const maxX = Math.max(x1, x2) + halfWidth;
      const minZ = Math.min(z1, z2) - halfWidth;
      const maxZ = Math.max(z1, z2) + halfWidth;
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
        const seg = distancePointToLineSegment2D(x, z, x1, z1, x2, z2);
        if (seg.distance <= halfWidth) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Computes surface normal on terrain at (x, z) using finite differences.
 */
export function computeTerrainNormal(x: number, z: number, terrainShape: Shape): THREE.Vector3 {
  const delta = 0.25;
  const hL = sampleTerrainElevation(x - delta, z, terrainShape);
  const hR = sampleTerrainElevation(x + delta, z, terrainShape);
  const hD = sampleTerrainElevation(x, z - delta, terrainShape);
  const hU = sampleTerrainElevation(x, z + delta, terrainShape);

  const dhdx = (hR - hL) / (2 * delta);
  const dhdz = (hU - hD) / (2 * delta);

  return new THREE.Vector3(-dhdx, 1.0, -dhdz).normalize();
}
