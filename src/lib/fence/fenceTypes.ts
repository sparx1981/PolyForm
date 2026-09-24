/** Fence styles. The first five come from the split-rail generator, the rest are garden fences. */
export type SplitRailStyle = 'worm' | 'stake-rider' | 'post-rail' | 'skigard' | 'hybrid';
export type GardenFenceStyle = 'close-board' | 'picket' | 'panel';
export type FenceStyle = SplitRailStyle | GardenFenceStyle;

/** Timber finishes for split-rail fences (the generator's own palettes). */
export type WoodFinish = 'weathered' | 'oak' | 'chestnut' | 'robinia' | 'lichen';

/** A whole fence run, saved on the fence shape. Points are world x/z in metres. */
export interface FenceData {
  points: [number, number][];
  closed?: boolean;
  style: FenceStyle;
  /** Top of the fence above the ground, metres. */
  height: number;
  seed: number;
  finish?: WoodFinish;
  /** Colour for garden fences (stain or paint). */
  color?: string;
}

export interface FenceStyleInfo {
  id: FenceStyle;
  label: string;
  description: string;
  defaultHeight: number;
  minHeight: number;
  maxHeight: number;
  /** Default colour for garden fences. */
  color?: string;
}

export const FENCE_STYLES: FenceStyleInfo[] = [
  { id: 'post-rail', label: 'Post & Rail', description: 'Split rails slotted through posts', defaultHeight: 1.25, minHeight: 0.9, maxHeight: 1.6 },
  { id: 'worm', label: 'Zigzag (Worm)', description: 'Stacked rails in a zigzag, no posts', defaultHeight: 1.25, minHeight: 0.9, maxHeight: 1.6 },
  { id: 'stake-rider', label: 'Stake & Rider', description: 'Zigzag rails locked by crossed stakes', defaultHeight: 1.25, minHeight: 0.9, maxHeight: 1.6 },
  { id: 'skigard', label: 'Skigard', description: 'Norwegian slanted rails between post pairs', defaultHeight: 1.25, minHeight: 1.0, maxHeight: 1.6 },
  { id: 'hybrid', label: 'Hybrid', description: 'Zigzag on the flat, Skigard on the slope', defaultHeight: 1.25, minHeight: 1.0, maxHeight: 1.6 },
  { id: 'close-board', label: 'Close Board', description: 'Featheredge boards on rails, gravel board', defaultHeight: 1.8, minHeight: 0.9, maxHeight: 2.1, color: '#7a5a3a' },
  { id: 'picket', label: 'Picket', description: 'Spaced pointed pickets on two rails', defaultHeight: 1.0, minHeight: 0.6, maxHeight: 1.5, color: '#f2efe6' },
  { id: 'panel', label: 'Lap Panel', description: 'Framed horizontal-slat panels, stepped on slopes', defaultHeight: 1.8, minHeight: 0.9, maxHeight: 2.1, color: '#8a6644' },
];

export const WOOD_FINISHES: { id: WoodFinish; label: string }[] = [
  { id: 'weathered', label: 'Weathered grey' },
  { id: 'oak', label: 'Oak' },
  { id: 'chestnut', label: 'Fresh chestnut' },
  { id: 'robinia', label: 'Robinia' },
  { id: 'lichen', label: 'Lichen' },
];

export function isGardenStyle(style: FenceStyle): style is GardenFenceStyle {
  return style === 'close-board' || style === 'picket' || style === 'panel';
}

export function fenceStyleInfo(style: FenceStyle): FenceStyleInfo {
  return FENCE_STYLES.find(info => info.id === style) ?? FENCE_STYLES[0];
}

/** Terrain heights on a square world-space grid (row-major, z rows). */
export interface TerrainSnapshot {
  x: number;
  z: number;
  step: number;
  columns: number;
  rows: number;
  heights: Float32Array;
}

/** One material's triangles for the renderer. Positions are world space. */
export interface FenceBatch {
  kind: 'wood' | 'woodEnd' | 'stone' | 'binding' | 'metal';
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
}

/** On success `batches`, `length` and `ms` are set; on failure `error` explains why. */
export interface FenceBuildResult {
  ok: boolean;
  batches?: FenceBatch[];
  length?: number;
  ms?: number;
  error?: string;
}
