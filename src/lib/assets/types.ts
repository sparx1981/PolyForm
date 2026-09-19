export type AssetQuality = '1k' | '2k' | '4k';
export type MaterialAssetId = `ph:material:${string}`;
export type EnvironmentAssetId = `ph:hdri:${string}`;
export type PolyHavenAssetId = MaterialAssetId | EnvironmentAssetId;

export interface MaterialRef {
  assetId: MaterialAssetId;
  revision: string;
}

export interface EnvironmentRef {
  assetId: EnvironmentAssetId;
  revision: string;
}

export interface MaterialInstance {
  ref: MaterialRef;
  tint?: string;
  roughnessMultiplier?: number;
  metalnessMultiplier?: number;
  roughness?: number;
  metalness?: number;
  normalStrength?: number;
  opacity?: number;
  alphaTest?: number;
  uv?: { repeat: [number, number]; offset: [number, number]; rotation: number };
  depth?: { enabled: boolean; scaleMeters: number; biasMeters: number };
}

export interface EnvironmentState {
  ref: EnvironmentRef | null;
  intensity: number;
  backgroundIntensity: number;
  rotationRadians: number;
  blur: number;
  background: boolean;
  quality: AssetQuality;
  /** Compatibility-only state for projects saved before asset schema v1. */
  legacySkybox?: string;
}

export interface AssetSummary {
  id: PolyHavenAssetId;
  sourceId: string;
  kind: 'material' | 'hdri';
  name: string;
  source: 'polyhaven';
  license: 'CC0-1.0';
  revision: string;
  manifestUrl: string;
  thumbnailUrl: string;
  categoryId: string;
  categoryPath: string;
  categorySlugPath: string;
  ancestorCategoryIds: string[];
  legacyCategories: string[];
  tags: string[];
  attributes: Record<string, unknown>;
  environmentGroup?: 'pure-skies' | 'mountains-hills' | 'forest-woodland';
  availableTiers: AssetQuality[];
  hasHeight?: boolean;
}

export type MapSemantic =
  | 'basecolor' | 'normal-gl' | 'orm' | 'roughness' | 'metalness' | 'ao'
  | 'height' | 'opacity' | 'emissive' | 'environment' | 'preview'
  | 'bump' | 'specular' | 'transmission';

export interface MapVariant {
  url: string;
  fallbackUrl?: string;
  fallbackFormat?: 'webp' | 'png';
  fallbackSha256?: string;
  fallbackByteLength?: number;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  format: 'ktx2' | 'webp' | 'png' | 'exr' | 'hdr';
  encoding: 'srgb' | 'linear-color' | 'data';
  channels: Record<string, 'r' | 'g' | 'b' | 'a'>;
  sourceKeys: string[];
  uvChannel: number;
}

export interface AssetManifest {
  schemaVersion: 1;
  asset: AssetSummary;
  tiers: Partial<Record<AssetQuality, Partial<Record<MapSemantic, MapVariant>>>>;
  scalarFallbacks: { color: string; roughness: number; metalness: number; opacity?: number };
  physicalTileMeters?: [number, number];
  height?: { scaleMeters: number; biasMeters: number; calibrated: boolean; provenance: string };
  coverage: Array<{ sourceKey: string; status: 'bound' | 'converted' | 'alternative' | 'unsupported-blocking'; semantic?: MapSemantic; reason: string }>;
  publication: { status: 'staged' | 'published' | 'deprecated' };
}

export interface CatalogIndex {
  schemaVersion: 1;
  release: string;
  generatedAt: string;
  assets: AssetSummary[];
}

export interface AssetDiagnostic {
  assetId: PolyHavenAssetId;
  revision: string;
  role: string;
  stage: 'catalog' | 'manifest' | 'download' | 'decode' | 'bind';
  reason: string;
  retryable: boolean;
}

export function isMaterialAssetId(value: unknown): value is MaterialAssetId {
  return typeof value === 'string' && /^ph:material:[a-z0-9][a-z0-9_\-]*$/.test(value);
}

export function isEnvironmentAssetId(value: unknown): value is EnvironmentAssetId {
  return typeof value === 'string' && /^ph:hdri:[a-z0-9][a-z0-9_\-]*$/.test(value);
}
