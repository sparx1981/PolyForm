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

/** Mulberry32: fast, deterministic and with a full 2^32 period. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Clumps scale with the grass so a lawn and a meadow both read as clustered. */
export function grassClumpSize(settings: Pick<GrassSettings, 'baseHeight' | 'heightVariance'>): number {
  return Math.min(1.2, Math.max(0.3, (settings.baseHeight + settings.heightVariance) * 3));
}

/** Nearest jittered clump centre (a Voronoi cell) and two stable per-clump hashes. */
export function nearestClump(x: number, z: number, size: number) {
  const cx = Math.floor(x / size), cz = Math.floor(z / size);
  let best = Infinity, bestX = cx, bestZ = cz, centreX = x, centreZ = z;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx, iz = cz + dz;
      const px = (ix + 0.15 + 0.7 * hash2D(ix, iz, 1)) * size;
      const pz = (iz + 0.15 + 0.7 * hash2D(ix, iz, 2)) * size;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; bestX = ix; bestZ = iz; centreX = px; centreZ = pz; }
    }
  }
  const distance = Math.sqrt(best);
  return {
    distance,
    dirX: distance > 1e-6 ? (x - centreX) / distance : 0,
    dirZ: distance > 1e-6 ? (z - centreZ) / distance : 0,
    hash: hash2D(bestX, bestZ, 3),
    hash2: hash2D(bestX, bestZ, 4),
  };
}

/** A spatial tile of grass with its own bounds, so off-screen tiles are culled. */
export interface GrassChunk extends GrassInstanceData {
  /** Per-instance draw order in [0, 1); lower ranks survive distance thinning longest. */
  ranks: Float32Array;
  center: [number, number, number];
  /** Radius of the tuft roots around `center`; callers pad it by the tuft size. */
  radius: number;
}

/**
 * Splits instances into square tiles and shuffles each tile, so drawing only the first N
 * instances of a tile thins it evenly instead of removing one corner.
 */
export function partitionGrassChunks(data: GrassInstanceData, chunkSize = 16, seed = 7): GrassChunk[] {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < data.instanceCount; i++) {
    const key = `${Math.floor(data.matrices[i * 16 + 12] / chunkSize)},${Math.floor(data.matrices[i * 16 + 14] / chunkSize)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i); else buckets.set(key, [i]);
  }
  const rng = seededRandom(seed);
  const chunks: GrassChunk[] = [];
  for (const indices of buckets.values()) {
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const count = indices.length;
    const chunk: GrassChunk = {
      instanceCount: count,
      matrices: new Float32Array(count * 16),
      shapeOffsets: new Float32Array(count * 4),
      heightVariances: new Float32Array(count),
      ranks: new Float32Array(count),
      center: [0, 0, 0],
      radius: 0,
    };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    indices.forEach((source, i) => {
      chunk.matrices.set(data.matrices.subarray(source * 16, source * 16 + 16), i * 16);
      chunk.shapeOffsets.set(data.shapeOffsets.subarray(source * 4, source * 4 + 4), i * 4);
      chunk.heightVariances[i] = data.heightVariances[source];
      chunk.ranks[i] = i / count;
      for (let axis = 0; axis < 3; axis++) {
        const v = data.matrices[source * 16 + 12 + axis];
        min[axis] = Math.min(min[axis], v); max[axis] = Math.max(max[axis], v);
      }
    });
    chunk.center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    chunk.radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    chunks.push(chunk);
  }
  return chunks;
}

/** Share of a tile's tufts drawn at a camera distance; the grass shader uses the same curve. */
export function grassKeepFraction(distance: number, lod: GrassLodRange): number {
  const t = Math.min(1, Math.max(0, (distance - lod.near) / Math.max(1e-3, lod.far - lod.near)));
  const smooth = t * t * (3 - 2 * t);
  return 1 + (lod.minKeep - 1) * smooth;
}

export interface GrassLodRange { near: number; far: number; minKeep: number }

/** Thinning starts further away for taller grass, which stays visible for longer. */
export function grassLodRange(settings: Pick<GrassSettings, 'baseHeight' | 'heightVariance'>): GrassLodRange {
  const height = settings.baseHeight + settings.heightVariance;
  return { near: Math.max(12, height * 120), far: Math.max(60, height * 600), minKeep: 0.12 };
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

  // Deterministic seed for stable placement across frames. A full 32-bit generator: the old
  // 233,280-value LCG wrapped around on large lawns and repeated the same layout.
  const rng = seededRandom(42);
  const clumpSize = grassClumpSize(settings);

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

      // Tufts in one clump share height, tone and an outward lean, like a real sward.
      const clump = nearestClump(wx, wz, clumpSize);
      const outward = Math.min(1, clump.distance / clumpSize) * 0.12;
      const leanX = clump.dirX * outward + (rng() - 0.5) * 0.16;
      const leanZ = clump.dirZ * outward + (rng() - 0.5) * 0.16;
      // Lean is applied in the tuft's local frame, before its Y rotation.
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

      // Per-instance shape offsets:
      // x, z: local lean (clump-outward plus random)
      // z: width scale (0.85 to 1.2)
      // w: color jitter (0.0 to 1.0), mostly shared within a clump
      validOffsets.push(
        leanX * cosY - leanZ * sinY,
        leanX * sinY + leanZ * cosY,
        0.85 + rng() * 0.35,
        clump.hash * 0.65 + rng() * 0.35
      );

      // Per-instance height variance: (0.0 to 1.0), mostly shared within a clump
      validHeightVars.push(clump.hash2 * 0.6 + rng() * 0.4);
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
