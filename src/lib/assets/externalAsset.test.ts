import { describe, expect, it } from 'vitest';
import {
  GeneratedAssetProviderRegistry,
  createExternalAssetShape,
  normaliseGeneratedGeometry,
  validateGeneratedAsset,
} from './externalAsset';

const cube = {
  positions: [
    -1,0,-1, 1,0,-1, 1,2,-1,
    -1,0,-1, 1,2,-1, -1,2,-1,
  ],
};

describe('external/generated asset pipeline', () => {
  it('validates and normalises external geometry to the ground plane and requested height', () => {
    const input = {
      name: 'Generated chair',
      geometry: cube,
      targetHeightM: 1,
      provenance: { source: 'generated' as const, provider: 'test', prompt: 'a chair' },
    };
    expect(validateGeneratedAsset(input).valid).toBe(true);
    const normalised = normaliseGeneratedGeometry(cube, 1);
    const ys = normalised.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(1, 5);
  });

  it('creates a native PolyForm shape with source provenance', () => {
    const shape = createExternalAssetShape({
      name: 'Generated chair',
      geometry: cube,
      provenance: { source: 'generated', provider: 'example', requestId: 'abc' },
    });
    expect(shape.type).toBe('custom');
    expect(shape.customData.assetProvenance.provider).toBe('example');
    expect(shape.tags).toContain('generated');
  });

  it('supports swappable generation providers without coupling PolyForm to one service', async () => {
    const registry = new GeneratedAssetProviderRegistry();
    registry.register({
      id: 'mock',
      generate: async request => ({ geometry: cube, name: request.name, providerAssetId: 'asset-1' }),
    });
    expect(registry.list()).toEqual(['mock']);
    const result = await registry.generate('mock', { name: 'Chair', prompt: 'modern chair' });
    expect(result.providerAssetId).toBe('asset-1');
  });
});
