import { describe, expect, it } from 'vitest';
import { createGeneratedPrimitiveShape, validateGeneratedPrimitive } from './generatedPrimitive';

describe('generated primitive validation', () => {
  it('rejects unsupported or non-finite generated geometry', () => {
    expect(validateGeneratedPrimitive({ type: 'evil', args: [1] }).valid).toBe(false);
    expect(validateGeneratedPrimitive({ type: 'box', position: [0, Number.NaN, 0], args: [1, 1, 1] }).valid).toBe(false);
  });

  it('creates generated shapes with retained provenance', () => {
    const shape = createGeneratedPrimitiveShape(
      { type: 'box', position: [0, 1, 0], args: [2, 2, 2], color: '#abcdef' },
      { provider: 'gemini', model: 'test-model', prompt: 'a cube' },
    );
    expect(shape.type).toBe('box');
    expect(shape.customData.assetProvenance).toMatchObject({
      source: 'generated',
      provider: 'gemini',
      model: 'test-model',
      prompt: 'a cube',
    });
    expect(shape.tags).toContain('generated');
  });
});
