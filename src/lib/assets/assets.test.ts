import { describe, expect, it } from 'vitest';
import { parseCatalogIndex } from './catalog';
import { chooseTier, resolveMaterial } from './materialResolver';
import { readAssetProjectState } from './projectCodec';
import type { AssetManifest, MaterialInstance } from './types';

const manifest: AssetManifest = {
  schemaVersion: 1,
  asset: {
    id: 'ph:material:aerial_grass_rock', sourceId: 'aerial_grass_rock', kind: 'material', name: 'Aerial Grass Rock', source: 'polyhaven',
    license: 'CC0-1.0', revision: 'r1', manifestUrl: '/m.json', thumbnailUrl: '/t.webp', categoryId: 'rock', categoryPath: 'Rock',
    categorySlugPath: 'rock', ancestorCategoryIds: [], legacyCategories: [], tags: [], attributes: {}, availableTiers: ['1k', '2k'], hasHeight: true,
  },
  tiers: { '1k': {}, '2k': {} }, scalarFallbacks: { color: '#fff', roughness: 0.7, metalness: 0 },
  height: { scaleMeters: 0.01, biasMeters: -0.005, calibrated: false, provenance: 'provisional' }, coverage: [], publication: { status: 'published' },
};

describe('Poly Haven asset contracts', () => {
  it('rejects an environment/material kind mismatch', () => {
    expect(() => parseCatalogIndex({ schemaVersion: 1, release: 'r', generatedAt: 'now', assets: [{ ...manifest.asset, id: 'ph:hdri:test' }] })).toThrow();
  });
  it('falls down to an available tier without claiming an upscale', () => expect(chooseTier(manifest, '4k')).toBe('2k'));
  it('uses conservative authored height and explicit overrides', () => {
    const instance: MaterialInstance = { ref: { assetId: manifest.asset.id as MaterialInstance['ref']['assetId'], revision: 'r1' }, depth: { enabled: false, scaleMeters: 0.02, biasMeters: -0.01 } };
    expect(resolveMaterial(instance, manifest, '2k').depth).toEqual({ enabled: false, scaleMeters: 0.02, biasMeters: -0.01, calibrated: false });
  });
  it('keeps project PBR edits separate from the immutable source defaults', () => {
    const instance: MaterialInstance = {
      ref: { assetId: manifest.asset.id as MaterialInstance['ref']['assetId'], revision: 'r1' },
      roughness: 0.22, metalness: 0.35, opacity: 0.8,
      depth: { enabled: true, scaleMeters: 0.08, biasMeters: -0.02 },
    };
    const resolved = resolveMaterial(instance, manifest, '2k');
    expect([resolved.roughness, resolved.metalness, resolved.opacity]).toEqual([0.22, 0.35, 0.8]);
    expect(resolved.depth).toMatchObject({ enabled: true, scaleMeters: 0.08, biasMeters: -0.02 });
    expect(manifest.scalarFallbacks).toEqual({ color: '#fff', roughness: 0.7, metalness: 0 });
  });
  it('migrates legacy environment degrees exactly once', () => expect(readAssetProjectState({ skybox: 'woodland', skyboxRotation: 180 }).environment.rotationRadians).toBe(Math.PI));
});
