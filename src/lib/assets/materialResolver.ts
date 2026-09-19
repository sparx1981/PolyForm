import type { AssetManifest, AssetQuality, MaterialInstance, MapSemantic, MapVariant } from './types';

export interface ResolvedMaterial {
  instance: MaterialInstance;
  quality: AssetQuality;
  maps: Partial<Record<MapSemantic, MapVariant>>;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  depth: { enabled: boolean; scaleMeters: number; biasMeters: number; calibrated: boolean } | null;
}

const ORDER: AssetQuality[] = ['4k', '2k', '1k'];

export function chooseTier(manifest: AssetManifest, requested: AssetQuality): AssetQuality {
  if (manifest.tiers[requested]) return requested;
  const requestedIndex = ORDER.indexOf(requested);
  return ORDER.slice(requestedIndex + 1).find(tier => manifest.tiers[tier])
    ?? ORDER.find(tier => manifest.tiers[tier])
    ?? requested;
}

export function resolveMaterial(instance: MaterialInstance, manifest: AssetManifest, requested: AssetQuality): ResolvedMaterial {
  if (instance.ref.assetId !== manifest.asset.id || instance.ref.revision !== manifest.asset.revision) {
    throw new Error(`Material reference does not match manifest: ${instance.ref.assetId}`);
  }
  const quality = chooseTier(manifest, requested);
  const fallbacks = manifest.scalarFallbacks;
  const authoredDepth = manifest.height;
  const requestedDepth = instance.depth;
  return {
    instance,
    quality,
    maps: manifest.tiers[quality] ?? {},
    color: instance.tint ?? fallbacks.color,
    roughness: instance.roughness ?? fallbacks.roughness * (instance.roughnessMultiplier ?? 1),
    metalness: instance.metalness ?? fallbacks.metalness * (instance.metalnessMultiplier ?? 1),
    opacity: instance.opacity ?? fallbacks.opacity ?? 1,
    depth: authoredDepth ? {
      enabled: requestedDepth?.enabled ?? true,
      scaleMeters: requestedDepth?.scaleMeters ?? authoredDepth.scaleMeters,
      biasMeters: requestedDepth?.biasMeters ?? authoredDepth.biasMeters,
      calibrated: authoredDepth.calibrated,
    } : null,
  };
}
