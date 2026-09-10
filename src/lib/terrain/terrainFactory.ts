import { Shape, TerrainData } from '../../types';
import { LANDSCAPE_TEXTURES, LandscapeTexturePreset } from '../landscapeTextures';

export type TopographyPreset = 'flat' | 'rolling' | 'ridge' | 'terraced';

export interface TerrainCreationOptions {
  width: number;
  depth: number;
  resolution: number;
  topography: TopographyPreset;
  roughness?: number;
  heightScale?: number;
  textureId?: string;
  textureScale?: number;
  position?: [number, number, number];
  name?: string;
}

/**
 * Generates elevation heights array based on topography preset, grid density, and roughness.
 */
export function generateTerrainHeights(options: {
  resolution: number;
  topography: TopographyPreset;
  heightScale?: number;
  roughness?: number;
}): number[] {
  const { resolution, topography } = options;
  const roughness = options.roughness !== undefined ? Math.max(0, Math.min(2, options.roughness)) : 0.5;
  const heightScale = options.heightScale ?? (topography === 'ridge' ? 5.0 : topography === 'terraced' ? 4.0 : 3.0);
  const grid = Math.max(8, resolution);
  const heights: number[] = [];

  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      // Normalized grid coordinates from -2 to +2
      const nx = (i / (grid - 1) - 0.5) * 4;
      const ny = (j / (grid - 1) - 0.5) * 4;

      // Multi-frequency harmonic micro-roughness
      const r1 = Math.sin(nx * 5.7 + 0.9) * Math.cos(ny * 5.7 + 1.4);
      const r2 = Math.sin(nx * 11.8 + 2.3) * Math.cos(ny * 11.8 + 0.7) * 0.5;
      const r3 = Math.sin(nx * 23.4) * Math.cos(ny * 23.4) * 0.25;
      const microRoughness = (r1 + r2 + r3) * roughness * 0.45;

      if (topography === 'flat') {
        heights.push(Math.max(0, microRoughness * 0.4));
      } else {
        if (topography === 'rolling') {
          const dist = Math.sqrt(nx * nx + ny * ny);
          const hill = Math.exp(-dist * 0.7) * (heightScale * 0.7);
          const wave = (Math.sin(nx * 1.6) * Math.cos(ny * 1.6)) * (heightScale * 0.35);
          heights.push(Math.max(0, hill + wave + microRoughness));
        } else if (topography === 'ridge') {
          const distFromAxis = Math.abs(nx);
          const ridge = Math.max(0, Math.cos(Math.min(Math.PI / 2, distFromAxis * 0.8)) * heightScale);
          const longitudinalWave = Math.sin(ny * 1.5) * (heightScale * 0.25);
          heights.push(Math.max(0, ridge + longitudinalWave + microRoughness));
        } else if (topography === 'terraced') {
          const slope = ((nx + 2) / 4) * heightScale;
          const undulating = Math.sin(ny * 2.0) * (heightScale * 0.15);
          const rawH = slope + undulating;
          const stepHeight = 1.0; // 1m bench terrace
          const terrace = Math.floor(rawH / stepHeight) * stepHeight;
          heights.push(Math.max(0, terrace + microRoughness * 0.3));
        }
      }
    }
  }

  return heights;
}

/**
 * Creates a complete, fully populated Terrain Shape ready for 3D rendering and civil modifiers.
 */
export function createTerrainShape(options: TerrainCreationOptions, existingId?: string): Shape {
  const width = Math.max(5, options.width);
  const depth = Math.max(5, options.depth);
  const grid = Math.max(8, options.resolution);
  const roughness = options.roughness !== undefined ? options.roughness : 0.5;
  
  const heights = generateTerrainHeights({
    resolution: grid,
    topography: options.topography,
    heightScale: options.heightScale,
    roughness
  });

  const textureId = options.textureId || 'lush_grass';
  const activePreset: LandscapeTexturePreset = 
    LANDSCAPE_TEXTURES.find(t => t.id === textureId) || LANDSCAPE_TEXTURES[0];
  
  const generatedDataUrl = activePreset.generate();
  const initialTexture = generatedDataUrl || activePreset.previewColor;

  const terrainData: TerrainData = {
    gridX: grid,
    gridY: grid,
    width,
    depth,
    heights,
    baseHeights: [...heights],
    shadingMode: 'default',
    textureUrl: initialTexture,
    textureScale: options.textureScale ?? activePreset.defaultRepeat ?? 8,
    roughness,
    topography: options.topography,
  };

  const id = existingId || Math.random().toString(36).substr(2, 9);

  return {
    id,
    name: options.name || `Site Terrain`,
    type: 'terrain',
    position: options.position || [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    args: [width, depth, grid],
    terrainData,
    color: initialTexture,
    textureUrl: initialTexture,
    roughness: activePreset.roughness,
    metalness: activePreset.metalness
  };
}
