import { describe, expect, it } from 'vitest';
import type { CustomLight } from '../types';
import { lightBudgetLimits, planLightBudget } from './lightBudget';

const light = (id: string, type: CustomLight['type'] = 'spot'): CustomLight => ({ id, type, color: '#ffffff', intensity: 40, position: [0, 2.5, 0] });
const many = (n: number, type: CustomLight['type'] = 'spot') => Array.from({ length: n }, (_, i) => light(`l${i}`, type));

describe('light budget', () => {
  it('keeps a small scene exactly as it is', () => {
    const lights = many(4);
    const budget = planLightBudget(lights);
    expect(budget.lit.size).toBe(4);
    expect(budget.shadow.size).toBe(4);
    expect(budget.trimmed).toBe(false);
  });

  it('limits shadow casters so the shader cannot run out of texture units', () => {
    // A furnished two-storey house: roughly nine downlights in each of seven rooms.
    const budget = planLightBudget(many(63), { maxTextureUnits: 16 });
    expect(budget.shadow.size).toBe(4);
    expect([...budget.shadow].every(id => budget.lit.has(id))).toBe(true);
  });

  it('allows more shadows on a GPU with more texture units, but never more than six', () => {
    expect(lightBudgetLimits({ maxTextureUnits: 32 }).maxShadowLights).toBe(6);
    expect(lightBudgetLimits({ maxTextureUnits: 12 }).maxShadowLights).toBe(0);
    expect(lightBudgetLimits({ maxTextureUnits: 8 }).maxShadowLights).toBe(0);
  });

  it('caps the total number of lights from the uniform budget', () => {
    expect(lightBudgetLimits({ maxFragmentUniformVectors: 4096 }).maxLights).toBe(64);
    expect(lightBudgetLimits({ maxFragmentUniformVectors: 1024 }).maxLights).toBe(64);
    expect(lightBudgetLimits({ maxFragmentUniformVectors: 224 }).maxLights).toBe(8);
    const budget = planLightBudget(many(200), { maxFragmentUniformVectors: 512 });
    expect(budget.lit.size).toBe(lightBudgetLimits({ maxFragmentUniformVectors: 512 }).maxLights);
    expect(budget.trimmed).toBe(true);
  });

  it('always keeps the selected light, and never casts a shadow from an area light', () => {
    const lights = [...many(100), light('panel', 'rect')];
    const budget = planLightBudget(lights, { maxTextureUnits: 16 }, { selectedId: 'panel' });
    expect(budget.lit.has('panel')).toBe(true);
    expect(budget.shadow.has('panel')).toBe(false);
  });

  it('keeps directional lights switched on even in a crowded scene', () => {
    const lights = [...many(100), light('sun', 'directional')];
    expect(planLightBudget(lights).lit.has('sun')).toBe(true);
  });

  it('does not depend on the camera: the same lights give the same choice', () => {
    const lights = many(80);
    expect([...planLightBudget(lights).lit]).toEqual([...planLightBudget([...lights]).lit]);
  });

  it('gives a shadow to a projector before ordinary lights', () => {
    const lights = [...many(20), light('projector', 'projector')];
    expect(planLightBudget(lights, { maxTextureUnits: 16 }).shadow.has('projector')).toBe(true);
  });
});
