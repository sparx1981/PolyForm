import { describe, expect, it } from 'vitest';
import { createWaterUniforms } from './waterMaterial';
import { advanceWaterFlow } from './waterMotion';
describe('per-pond current animation', () => {
  it('changes speed and direction continuously and stops when still', () => {
    const u = createWaterUniforms();
    u.uFlowSpeed.value = 1;
    for (let i = 0; i < 60; i++) advanceWaterFlow(u, 1/60);
    expect(u.uFlowOffset.value.x).toBeCloseTo(1);
    u.uFlowSpeed.value = 2;
    advanceWaterFlow(u, 0.1);
    expect(u.uFlowOffset.value.x).toBeCloseTo(1.2);
    u.uFlowDir.value.set(-1, 0);
    advanceWaterFlow(u, 0.1);
    expect(u.uFlowOffset.value.x).toBeCloseTo(1);
    u.uFlowSpeed.value = 0;
    advanceWaterFlow(u, 0.1);
    expect(u.uFlowOffset.value.x).toBeCloseTo(1);
  });
  it('keeps different ponds independent and limits background-tab jumps', () => {
    const a = createWaterUniforms(), b = createWaterUniforms();
    a.uFlowSpeed.value = 4;
    a.uFlowDir.value.set(0, 1);
    advanceWaterFlow(a, 120);
    expect(a.uFlowOffset.value.y).toBeCloseTo(0.4);
    expect(b.uFlowOffset.value.length()).toBe(0);
  });
});
