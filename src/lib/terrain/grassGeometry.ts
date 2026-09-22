import * as THREE from 'three';
import { Shape, TerrainModifier, GrassSettings, PadModifier, RoadModifier } from '../../types';
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
 * Creates a radial tuft of curved, tapered blades with three triangles per blade.
 * NO alpha cutouts or transparent PNG textures used.
 *
 * Each vertex includes:
 * - position (vec3)
 * - normal (vec3)
 * - uv (vec2)
 * - aHeightPercent (float, 0.0 at root to 1.0 at tip) for gradient and wind calculations.
 */
export function createGrassBladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const heightPercents: number[] = [];
  const bladeTones: number[] = [];
  const indices: number[] = [];

  let vertOffset = 0;

  function addVertex(x: number, y: number, z: number, u: number, v: number, hPct: number, tone: number) {
    positions.push(x, y, z);
    uvs.push(u, v);
    heightPercents.push(hPct);
    bladeTones.push(tone);
    return vertOffset++;
  }

  const blades = [
    { angle: 0.15, height: 1.0, lean: 0.24, width: 0.085, tone: 0.93 },
    { angle: 1.18, height: 0.78, lean: 0.30, width: 0.073, tone: 1.06 },
    { angle: 2.25, height: 1.12, lean: 0.19, width: 0.077, tone: 0.88 },
    { angle: 3.32, height: 0.64, lean: 0.34, width: 0.090, tone: 1.10 },
    { angle: 4.38, height: 0.93, lean: 0.27, width: 0.080, tone: 0.97 },
    { angle: 5.42, height: 0.72, lean: 0.31, width: 0.075, tone: 1.03 },
  ];
  for (const blade of blades) {
    const dx = Math.cos(blade.angle), dz = Math.sin(blade.angle);
    const acrossX = -dz, acrossZ = dx;
    const point = (outward: number, halfWidth: number, height: number, side: number, hPct: number) =>
      addVertex(dx * outward + acrossX * halfWidth * side, height, dz * outward + acrossZ * halfWidth * side,
        (side + 1) * 0.5, hPct, hPct, blade.tone);
    const baseL = point(0.025, blade.width * 0.5, 0, -1, 0);
    const baseR = point(0.025, blade.width * 0.5, 0, 1, 0);
    const midL = point(blade.lean * 0.34, blade.width * 0.55, blade.height * 0.52, -1, 0.52);
    const midR = point(blade.lean * 0.34, blade.width * 0.55, blade.height * 0.52, 1, 0.52);
    const tip = point(blade.lean, 0, blade.height, 0, 1);
    indices.push(baseL, baseR, midR, baseL, midR, midL, midL, midR, tip);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aHeightPercent', new THREE.Float32BufferAttribute(heightPercents, 1));
  geometry.setAttribute('aBladeTone', new THREE.Float32BufferAttribute(bladeTones, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
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

export interface GrassInstanceData {
  instanceCount: number;
  matrices: Float32Array;
  shapeOffsets: Float32Array; // vec4 per instance: (lean, taper, width, colorJitter)
  heightVariances: Float32Array; // float per instance: (0.0 to 1.0)
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

/**
 * Generates instanced grass distribution across the terrain matching the density slider,
 * applying slope rejection and floor slab exclusion.
 */
export function generateGrassInstances(
  terrainShape: Shape,
  shapes: Shape[],
  terrainModifiers: TerrainModifier[] = [],
  settings: GrassSettings
): GrassInstanceData {
  if (!terrainShape.terrainData || !settings.enabled) {
    return {
      instanceCount: 0,
      matrices: new Float32Array(0),
      shapeOffsets: new Float32Array(0),
      heightVariances: new Float32Array(0)
    };
  }

  const { width = 50, depth = 50 } = terrainShape.terrainData;
  const terrainPos = terrainShape.position || [0, 0, 0];
  const footprints = extractExclusionFootprints(shapes, terrainModifiers);

  // Cosine cutoff for slope culling: N · (0,1,0) >= cos(theta_max)
  const maxSlopeRad = ((settings.maxSlopeAngle ?? 35) * Math.PI) / 180;
  const minCosSlope = Math.cos(maxSlopeRad);

  const density = Math.max(1, Math.min(40, settings.density || 8));
  // Total area in m²
  const area = width * depth;
  const rawTargetCount = Math.round(area * density);
  // Cap instances to bound draw work on large terrain shapes.
  const targetCount = Math.min(100000, rawTargetCount);

  // Stratified jittered grid sampling
  const cols = Math.max(2, Math.round(Math.sqrt(targetCount * (width / depth))));
  const rows = Math.max(2, Math.round(targetCount / cols));

  const stepX = width / cols;
  const stepZ = depth / rows;

  const minX = terrainPos[0] - width / 2;
  const minZ = terrainPos[2] - depth / 2;

  const validMatrices: THREE.Matrix4[] = [];
  const validOffsets: number[] = [];
  const validHeightVars: number[] = [];

  // Deterministic seed for stable placement across frames
  let seed = 42;
  function rng() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  const dummy = new THREE.Object3D();
  const upAxis = new THREE.Vector3(0, 1, 0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jitterX = (rng() - 0.5) * stepX * 0.9;
      const jitterZ = (rng() - 0.5) * stepZ * 0.9;

      const wx = minX + (c + 0.5) * stepX + jitterX;
      const wz = minZ + (r + 0.5) * stepZ + jitterZ;

      // 1. Terrain elevation & normal
      const wy = sampleTerrainElevation(wx, wz, terrainShape);
      const normal = computeTerrainNormal(wx, wz, terrainShape);

      // 2. Slope culling: N · (0,1,0) < cos(theta_max) => reject
      const cosSlope = normal.dot(upAxis);
      if (cosSlope < minCosSlope) {
        continue;
      }

      // 3. Floor slab exclusion: query scene graph and discard inside slab
      if (isPointExcluded(wx, wy, wz, footprints)) {
        continue;
      }

      // 4. Instance transform setup
      dummy.position.set(wx, wy, wz);

      // Random Y-rotation for organic orientation
      const rotY = rng() * Math.PI * 2;
      dummy.rotation.set(0, rotY, 0);

      // Slight scale variation
      const baseScale = 0.85 + rng() * 0.35;
      dummy.scale.set(baseScale, baseScale, baseScale);
      dummy.updateMatrix();

      validMatrices.push(dummy.matrix.clone());

      // Per-instance shape offsets:
      // x: lean amount (-0.15 to +0.15)
      // y: curvature/taper factor (-0.1 to +0.1)
      // z: width scale (0.8 to 1.25)
      // w: color jitter (0.0 to 1.0)
      validOffsets.push(
        (rng() - 0.5) * 0.3,
        (rng() - 0.5) * 0.2,
        0.85 + rng() * 0.35,
        rng()
      );

      // Per-instance height variance: (0.0 to 1.0)
      validHeightVars.push(rng());
    }
  }

  const count = validMatrices.length;
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    validMatrices[i].toArray(matrices, i * 16);
  }

  return {
    instanceCount: count,
    matrices,
    shapeOffsets: new Float32Array(validOffsets),
    heightVariances: new Float32Array(validHeightVars)
  };
}
