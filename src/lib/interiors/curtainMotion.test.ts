import { describe, expect, it } from 'vitest';
import { curtainBillow, stepCurtainMotion } from './curtainMotion';
const fresh = () => ({ displacement: 0, velocity: 0, time: 0 });
describe('curtain response', () => {
  it('moves in wind while pinning the heading and rod', () => {
    const state = fresh();
    for (let i = 0; i < 120; i++) stepCurtainMotion(state, 1/60, 0.5, 1.6, 0, 0);
    expect(Math.abs(curtainBillow(0, 0, 2.2, state))).toBeGreaterThan(0.02);
    expect(curtainBillow(0, 2.2, 2.2, state)).toBe(0);
    expect(curtainBillow(0, 2.3, 2.2, state)).toBe(0);
  });
  it('reacts to a nearby walker and settles after they leave', () => {
    const state = fresh();
    for (let i = 0; i < 30; i++) stepCurtainMotion(state, 1/60, 0, 1, 1, 1.5);
    expect(state.displacement).toBeGreaterThan(0.03);
    for (let i = 0; i < 600; i++) stepCurtainMotion(state, 1/60, 0, 1, 0, 0);
    expect(Math.abs(state.displacement)).toBeLessThan(0.001);
  });
  it('stays stable and comparable at mobile frame rates', () => {
    const a = fresh(), b = fresh();
    for (let i = 0; i < 120; i++) stepCurtainMotion(a, 1/60, 0.5, 1.6, 0, 0);
    for (let i = 0; i < 40; i++) stepCurtainMotion(b, 1/20, 0.5, 1.6, 0, 0);
    expect(b.displacement).toBeCloseTo(a.displacement, 4);
  });
});
