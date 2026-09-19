import type { AssetManifest, AssetSummary, CatalogIndex, PolyHavenAssetId } from './types';
import { isEnvironmentAssetId, isMaterialAssetId } from './types';

export const FALLBACK_CATALOG: CatalogIndex = {
  schemaVersion: 1,
  release: 'bundled-empty-v1',
  generatedAt: '2026-09-18T00:00:00.000Z',
  assets: [],
};

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid catalog field: ${field}`);
}

export function parseCatalogIndex(input: unknown): CatalogIndex {
  if (!input || typeof input !== 'object') throw new Error('Catalog must be an object');
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.assets)) throw new Error('Unsupported catalog schema');
  assertString(raw.release, 'release');
  assertString(raw.generatedAt, 'generatedAt');
  const assets = raw.assets.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Invalid asset at ${index}`);
    const asset = entry as unknown as AssetSummary;
    if (!isMaterialAssetId(asset.id) && !isEnvironmentAssetId(asset.id)) throw new Error(`Invalid asset id at ${index}`);
    if ((asset.kind === 'material') !== isMaterialAssetId(asset.id)) throw new Error(`Asset kind/id mismatch: ${asset.id}`);
    if (!Array.isArray(asset.availableTiers) || !asset.availableTiers.every(t => t === '1k' || t === '2k' || t === '4k')) {
      throw new Error(`Invalid tiers: ${asset.id}`);
    }
    return asset;
  });
  return { schemaVersion: 1, release: raw.release, generatedAt: raw.generatedAt, assets };
}

export async function loadCatalogIndex(url = '/polyhaven/catalog.v1.json', signal?: AbortSignal): Promise<CatalogIndex> {
  try {
    const response = await fetch(url, { signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    return parseCatalogIndex(await response.json());
  } catch (error) {
    if (signal?.aborted) throw error;
    return FALLBACK_CATALOG;
  }
}

export async function loadAssetManifest(summary: AssetSummary, signal?: AbortSignal): Promise<AssetManifest> {
  const response = await fetch(summary.manifestUrl, { signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`Manifest request failed (${response.status}) for ${summary.id}`);
  const manifest = await response.json() as AssetManifest;
  if (manifest.schemaVersion !== 1 || manifest.asset.id !== summary.id || manifest.asset.revision !== summary.revision) {
    throw new Error(`Manifest identity mismatch for ${summary.id}`);
  }
  return manifest;
}

export function indexCatalog(catalog: CatalogIndex): ReadonlyMap<PolyHavenAssetId, AssetSummary> {
  return new Map(catalog.assets.map(asset => [asset.id, asset]));
}
