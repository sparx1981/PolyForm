import { describe, expect, it } from 'vitest';
import { buildWaterBody } from './siteBuilders';

describe('moving water profiles', () => {
  it('keeps ordinary ponds on the existing still-water path', () => {
    const pond = buildWaterBody([], [[0,0],[4,0],[4,3],[0,3]]);
    expect(pond.waterData?.flow).toBeUndefined();
  });

  it('preserves an optional stream flow profile without changing pond geometry', () => {
    const stream = buildWaterBody([], [[0,0],[8,0],[8,2],[0,2]], {
      flow: { mode: 'stream', direction: [1, 0.2], speed: 0.8, turbulence: 0.5 },
    });
    expect(stream.type).toBe('water');
    expect(stream.waterData?.flow).toEqual({
      mode: 'stream',
      direction: [1, 0.2],
      speed: 0.8,
      turbulence: 0.5,
    });
  });
});
