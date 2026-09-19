// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaterialEditorDialog } from './MaterialEditorDialog';
import { loadAssetManifest } from '../lib/assets/catalog';
import type { AssetManifest } from '../lib/assets/types';

const manifest: AssetManifest = {
  schemaVersion: 1,
  asset: {
    id: 'ph:material:brick_wall_001', sourceId: 'brick_wall_001', kind: 'material',
    name: 'Brick Wall', source: 'polyhaven', license: 'CC0-1.0', revision: 'r1',
    manifestUrl: '/brick.json', thumbnailUrl: '/brick.webp', categoryId: 'brick',
    categoryPath: 'Brick', categorySlugPath: 'brick', ancestorCategoryIds: [],
    legacyCategories: [], tags: [], attributes: {}, availableTiers: ['2k'], hasHeight: true,
  },
  tiers: { '2k': { height: { url: '/height.exr', sha256: 'abc', byteLength: 10, width: 2048, height: 2048,
    format: 'exr', encoding: 'data', channels: { height: 'r' }, sourceKeys: ['displacement'], uvChannel: 0 } } },
  scalarFallbacks: { color: '#ffffff', roughness: 0.7, metalness: 0 },
  height: { scaleMeters: 0.05, biasMeters: 0, calibrated: false, provenance: 'provisional' },
  coverage: [], publication: { status: 'published' },
};

vi.mock('../lib/assets/catalog', () => ({ loadAssetManifest: vi.fn() }));

describe('MaterialEditorDialog', () => {
  it('opens source properties and saves project overrides without changing the manifest', async () => {
    const onSave = vi.fn();
    vi.mocked(loadAssetManifest).mockResolvedValue(manifest);
    render(<MaterialEditorDialog asset={manifest.asset} onSave={onSave} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save material' })).toBeTruthy());
    expect(screen.getByText(/height values are provisional/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Roughness/), { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ roughness: 0.25, depth: { enabled: true, scaleMeters: 0.05, biasMeters: 0 } }));
    expect(manifest.scalarFallbacks.roughness).toBe(0.7);
  });
});
