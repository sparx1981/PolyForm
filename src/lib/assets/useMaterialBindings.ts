import { useEffect, useMemo, useState } from 'react';
import { indexCatalog, loadAssetManifest } from './catalog';
import { resolveMaterial } from './materialResolver';
import { useAssetCatalog } from './useAssetCatalog';
import type { AssetQuality, MaterialInstance, MapSemantic, MapVariant } from './types';

export interface ResolvedBindingMaps {
  maps: Partial<Record<MapSemantic, MapVariant>>;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  normalStrength: number;
  depth: { enabled: boolean; scaleMeters: number; biasMeters: number; calibrated: boolean } | null;
}

export function useMaterialBindings(
  bindings: Record<string, MaterialInstance>,
  quality: AssetQuality = '2k',
): { resolved: Record<string, ResolvedBindingMaps>; loading: boolean } {
  const { catalog } = useAssetCatalog();
  const summaries = useMemo(() => indexCatalog(catalog), [catalog]);
  const [resolved, setResolved] = useState<Record<string, ResolvedBindingMaps>>({});
  const bindingKey = useMemo(() => Object.entries(bindings)
    .map(([id, binding]) => `${id}:${JSON.stringify(binding)}`)
    .sort()
    .join('|'), [bindings]);

  useEffect(() => {
    const controller = new AbortController();
    const entries = Object.entries(bindings);
    if (entries.length === 0 || summaries.size === 0) {
      setResolved({});
      return () => controller.abort();
    }
    void Promise.all(entries.map(async ([bindingId, instance]) => {
      const summary = summaries.get(instance.ref.assetId);
      if (!summary || summary.revision !== instance.ref.revision) return null;
      const manifest = await loadAssetManifest(summary, controller.signal);
      const material = resolveMaterial(instance, manifest, quality);
      return [bindingId, {
        maps: material.maps,
        color: material.color,
        roughness: material.roughness,
        metalness: material.metalness,
        opacity: material.opacity,
        normalStrength: instance.normalStrength ?? 1,
        depth: material.depth,
      }] as const;
    })).then(items => {
      if (!controller.signal.aborted) setResolved(Object.fromEntries(items.filter(item => item !== null)));
    }).catch(() => {
      if (!controller.signal.aborted) setResolved({});
    });
    return () => controller.abort();
  // bindingKey captures both identity and instance edits without refetching
  // manifests every time unrelated scene geometry changes.
  }, [bindingKey, quality, summaries]);

  return { resolved, loading: Object.keys(bindings).length > Object.keys(resolved).length };
}

export function runtimeImageUrl(variant?: MapVariant): string | undefined {
  return variant?.fallbackUrl ?? variant?.url;
}
