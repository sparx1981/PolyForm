import { describe, expect, it } from 'vitest';
import { normalizeFileInventory } from './normalize';

describe('source map normalization', () => {
  it('matches source keys case-insensitively and blocks unknown maps', () => {
    const result = normalizeFileInventory({ Diffuse: { '2k': { png: { url: 'https://dl.polyhaven.org/a.png', size: 4 } } }, Mystery: { '2k': { png: { url: 'https://dl.polyhaven.org/m.png' } } } }, '4k');
    expect(result.find(item => item.sourceKey === 'Diffuse')).toMatchObject({ semantic: 'basecolor', status: 'selected' });
    expect(result.find(item => item.sourceKey === 'Mystery')).toMatchObject({ status: 'unresolved-map' });
  });
  it('selects the highest native source under the ceiling', () => {
    const result = normalizeFileInventory({ AO: { '2k': { png: { url: 'https://dl.polyhaven.org/2.png' } }, '8k': { png: { url: 'https://dl.polyhaven.org/8.png' } } } }, '4k');
    expect(result.find(item => item.status === 'selected')?.resolution).toBe('2k');
  });
});
