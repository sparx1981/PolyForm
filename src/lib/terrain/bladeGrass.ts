import * as THREE from 'three';
import { Shape, TerrainModifier, GrassSettings } from '../../types';
import { sampleTerrainElevation } from '../archRoomAssembly';
import { extractExclusionFootprints, isPointExcluded, computeTerrainNormal } from './grassGeometry';

/**
 * Dense single-blade grass. Blades are not stored anywhere: each ring is one draw of a blade
 * template instanced over a camera-following grid, and the shader derives every blade's root,
 * shape, clump and colour from a hash of its world-space grid cell. Moving the camera slides the
 * grid by whole cells, so blades stay put in the world. The CPU only bakes a terrain-sized
 * presence mask (slope, slabs, roads, pads) and uploads the terrain height grid.
 */

/** A camera-centred square of blades at one spacing and blade resolution. */
export interface GrassRing {
  /** Half-width of the square, metres. */
  radius: number;
  /** Distance between neighbouring grid cells (one blade per cell), metres. */
  spacing: number;
  /** Curve segments per blade. */
  segments: number;
  /** Blades per grid side. */
  cells: number;
}

/** Instanced blades per ring are capped so dense settings stay within a GPU budget. */
export const MAX_RING_BLADES = [140_000, 220_000];

/** Blades per square metre for the 1–25 density slider (a real lawn has thousands). */
export function bladesPerSquareMetre(density: number): number {
  return Math.max(1, Math.min(25, density || 10)) * 40;
}

/**
 * Near ring: full-resolution blades. Far ring: coarser blades at a wider spacing, drawn only
 * outside the near ring. Taller grass stays visible further away, so its rings are larger.
 */
export function grassRings(settings: Pick<GrassSettings, 'density' | 'baseHeight' | 'heightVariance'>): GrassRing[] {
  const height = settings.baseHeight + settings.heightVariance;
  const reach = THREE.MathUtils.clamp(0.75 + height * 1.5, 1, 2.5);
  const nearSpacing = 1 / Math.sqrt(bladesPerSquareMetre(settings.density));
  const specs = [
    { radius: 9 * reach, spacing: nearSpacing, segments: 5 },
    { radius: 36 * reach, spacing: nearSpacing * 2.5, segments: 2 },
  ];
  return specs.map((spec, index) => {
    // Widen the spacing (never shrink the area) until the ring fits its blade budget.
    const minSpacing = (2 * spec.radius) / Math.sqrt(MAX_RING_BLADES[index]);
    const spacing = Math.max(spec.spacing, minSpacing);
    return { ...spec, spacing, cells: Math.ceil((2 * spec.radius) / spacing) };
  });
}

/**
 * Template for one blade: three vertices per row (left edge, raised centre ridge, right edge)
 * so the blade has a V cross-section that catches light like a real leaf.
 * position.x is the side (-1, 0, 1); position.y is the height fraction t in [0, 1].
 */
export function createBladeTemplate(segments: number): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    positions.push(-1, t, 0, 0, t, 0, 1, t, 0);
  }
  for (let row = 0; row < segments; row++) {
    const a = row * 3, b = a + 3;
    // Left panel then right panel of this segment.
    indices.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Normals are rebuilt in the shader; the attribute only satisfies the standard material.
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length).fill(0).map((_, i) => i % 3 === 2 ? 1 : 0), 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Terrain footprint shared by the height and mask textures. */
export interface GrassField {
  /** World-space min corner (x, z) and size (width, depth). */
  bounds: THREE.Vector4;
  heights: THREE.DataTexture;
  mask: THREE.DataTexture;
  /** Terrain base elevation, used where the terrain has no height grid. */
  baseY: number;
}

/**
 * The terrain's own height grid, sampled bilinearly in the shader exactly like
 * sampleTerrainElevation so blade roots sit on the rendered surface.
 */
export function createHeightTexture(terrain: Shape): THREE.DataTexture {
  const data = terrain.terrainData!;
  const gridX = Math.max(1, data.gridX || 1), gridY = Math.max(1, data.gridY || 1);
  const values = new Float32Array(gridX * gridY);
  for (let i = 0; i < values.length; i++) values[i] = data.heights?.[i] || 0;
  const texture = new THREE.DataTexture(values, gridX, gridY, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Mask cell size: fine enough for crisp slab and road edges, bounded for huge terrains. */
export function maskResolution(width: number, depth: number): [number, number] {
  const cell = Math.max(0.25, Math.max(width, depth) / 1024);
  return [Math.max(2, Math.ceil(width / cell)), Math.max(2, Math.ceil(depth / cell))];
}

/**
 * Presence mask over the terrain: 255 where grass grows, 0 on steep slopes and under slabs,
 * pads and roads. Linear filtering softens the boundary into a short fade of blade height.
 */
export function bakeGrassMask(
  terrain: Shape,
  shapes: Shape[],
  terrainModifiers: TerrainModifier[],
  settings: Pick<GrassSettings, 'maxSlopeAngle'>
): { data: Uint8Array; width: number; height: number } {
  const { width = 50, depth = 50 } = terrain.terrainData!;
  const [nx, nz] = maskResolution(width, depth);
  const data = new Uint8Array(nx * nz);
  const footprints = extractExclusionFootprints(shapes, terrainModifiers);
  const minCos = Math.cos(((settings.maxSlopeAngle ?? 35) * Math.PI) / 180);
  const minX = terrain.position[0] - width / 2, minZ = terrain.position[2] - depth / 2;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + ((ix + 0.5) / nx) * width;
      const z = minZ + ((iz + 0.5) / nz) * depth;
      const y = sampleTerrainElevation(x, z, terrain);
      if (computeTerrainNormal(x, z, terrain).y < minCos) continue;
      if (isPointExcluded(x, y, z, footprints)) continue;
      data[iz * nx + ix] = 255;
    }
  }
  return { data, width: nx, height: nz };
}

export function createGrassField(terrain: Shape, shapes: Shape[], terrainModifiers: TerrainModifier[],
  settings: Pick<GrassSettings, 'maxSlopeAngle'>): GrassField {
  const { width = 50, depth = 50 } = terrain.terrainData!;
  const baked = bakeGrassMask(terrain, shapes, terrainModifiers, settings);
  const mask = new THREE.DataTexture(baked.data, baked.width, baked.height, THREE.RedFormat, THREE.UnsignedByteType);
  mask.minFilter = mask.magFilter = THREE.LinearFilter;
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;
  mask.needsUpdate = true;
  return {
    bounds: new THREE.Vector4(terrain.position[0] - width / 2, terrain.position[2] - depth / 2, width, depth),
    heights: createHeightTexture(terrain),
    mask,
    baseY: terrain.position[1],
  };
}

/** Grid origin (min corner) for a ring centred near `centre`, snapped to whole cells. */
export function ringOrigin(ring: GrassRing, centreX: number, centreZ: number, target = new THREE.Vector2()): THREE.Vector2 {
  const half = Math.floor(ring.cells / 2);
  return target.set(
    (Math.floor(centreX / ring.spacing) - half) * ring.spacing,
    (Math.floor(centreZ / ring.spacing) - half) * ring.spacing,
  );
}

/** Recent footprints bend grass away and fade as the blades spring back. */
export const TRAIL_LENGTH = 16;
export const TRAIL_RECOVERY_SECONDS = 3;

export class GrassTrail {
  /** xy: world xz, z: time placed (seconds), w: strength (0 = unused). */
  readonly points = Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector4(0, 0, -1e6, 0));
  private next = 0;
  private last: THREE.Vector2 | null = null;

  /** Adds a footprint when the walker has moved far enough since the previous one. */
  step(x: number, z: number, time: number, minSpacing = 0.25): boolean {
    if (this.last && Math.hypot(x - this.last.x, z - this.last.y) < minSpacing) {
      // Standing still keeps the latest footprint pressed down.
      this.points[(this.next + TRAIL_LENGTH - 1) % TRAIL_LENGTH].z = time;
      return false;
    }
    this.points[this.next].set(x, z, time, 1);
    this.next = (this.next + 1) % TRAIL_LENGTH;
    this.last = new THREE.Vector2(x, z);
    return true;
  }

  clear() {
    for (const point of this.points) point.set(0, 0, -1e6, 0);
    this.last = null;
  }
}
