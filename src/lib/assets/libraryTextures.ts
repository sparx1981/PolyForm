import * as THREE from 'three';
import { loadAssetManifest } from './catalog';
import { resolveMaterial } from './materialResolver';
import type { ManagedTextureManager, TextureHandle } from './textureManager';
import { isMaterialAssetId, type AssetManifest, type AssetQuality, type AssetSummary, type MapSemantic, type MaterialInstance } from './types';

/** How long the compressed (KTX2) version of a map may take before the plain image is used instead. */
const KTX2_PATIENCE_MS = 6000;

export interface LoadedMaterialMaps {
  manifest: AssetManifest;
  /** Lets go of everything loaded (call when the material is no longer shown). */
  release(): void;
}

/**
 * Loads some maps (colour, normal, roughness/metal/occlusion, height) of a PBR library
 * material. Each one is handed to `onMap` as soon as it arrives. A map that is slow to unpack
 * falls back to its plain image when there is one; a map that can't be loaded is skipped.
 */
export async function loadMaterialMaps(
  manager: ManagedTextureManager,
  asset: AssetSummary,
  semantics: readonly MapSemantic[],
  onMap: (semantic: MapSemantic, texture: THREE.Texture) => void,
  signal: AbortSignal,
  quality: AssetQuality = '1k',
): Promise<LoadedMaterialMaps> {
  if (!isMaterialAssetId(asset.id)) throw new Error('This asset is not a material.');
  const manifest = await loadAssetManifest(asset, signal);
  const handles: TextureHandle[] = [];
  const loose: THREE.Texture[] = [];
  const release = () => {
    handles.forEach(h => h.release());
    loose.forEach(t => t.dispose());
    handles.length = 0;
    loose.length = 0;
  };
  if (signal.aborted) return { manifest, release };
  const instance: MaterialInstance = { ref: { assetId: asset.id as MaterialInstance['ref']['assetId'], revision: asset.revision } };
  const resolved = resolveMaterial(instance, manifest, quality);
  await Promise.all(semantics.map(async semantic => {
    const variant = resolved.maps[semantic];
    if (!variant) return;
    try {
      const handle = await Promise.race([
        manager.acquire(variant),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), KTX2_PATIENCE_MS)),
      ]);
      if (signal.aborted) { handle.release(); return; }
      handles.push(handle);
      onMap(semantic, handle.texture);
    } catch (error) {
      if (!variant.fallbackUrl) { console.warn(`[Materials] Could not load ${semantic} of ${asset.name}`, error); return; }
      try {
        const texture = await new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(variant.fallbackUrl);
        texture.colorSpace = variant.encoding === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        if (signal.aborted) { texture.dispose(); return; }
        loose.push(texture);
        onMap(semantic, texture);
      } catch (fallbackError) {
        console.warn(`[Materials] Could not load ${semantic} of ${asset.name}`, fallbackError);
      }
    }
  }));
  return { manifest, release };
}
