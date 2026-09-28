import { describe, expect, it } from 'vitest';
import type { CustomLight, Shape } from '../types';
import { planAutoLighting, AUTO_LIGHT_PREFIX } from './autoLighting';

const wall = (id: string, x: number, z: number, length: number, rotation: number): Shape => ({ id, type: 'wall', position: [x, 1.4, z], args: [length, 2.8, 0.2], rotation: [0, rotation, 0], color: '#fff' });
const room = [wall('n', 0, -2, 6.2, 0), wall('s', 0, 2, 6.2, 0), wall('e', 3, 0, 4.2, Math.PI / 2), wall('w', -3, 0, 4.2, Math.PI / 2)];
const manual: CustomLight = { id: 'manual', type: 'point', position: [10, 2, 10], intensity: 5, color: '#fff' };

describe('automatic room lighting', () => {
  it('creates aimed key and soft fill below the ceiling, preserving manual lights and replacing its own setup', () => {
    const plan = planAutoLighting(room, [manual], 'custom', 'warm');
    expect(plan.changed).toBe(2);
    expect(plan.lights[0]).toBe(manual);
    const key = plan.lights[1];
    expect(key.type).toBe('spot');
    expect(key.position[1]).toBeLessThan(2.8);
    expect(key.target![1]).toBe(0);
    expect(key.penumbra).toBeGreaterThan(0.5);
    const again = planAutoLighting(room, plan.lights, 'custom', 'cool');
    expect(again.lights).toHaveLength(3);
    expect(again.lights[1].color).not.toBe(key.color);
    expect(again.lights.filter(l => l.id.startsWith(AUTO_LIGHT_PREFIX))).toHaveLength(2);
  });
  it('balances fixtures without moving them or altering manual lights', () => {
    const lamp: Shape = { id: 'lamp', type: 'lamp', position: [0, 2.7, 0], args: [], archStyle: 'pendant', color: '#fff' };
    const bound: CustomLight = { ...manual, id: 'lamp-light-lamp', parentShapeId: 'lamp', position: [0, 2.2, 0], intensity: 1 };
    const plan = planAutoLighting([...room, lamp], [manual, bound], 'fixtures', 'neutral');
    expect(plan.changed).toBe(1);
    expect(plan.lights[0]).toBe(manual);
    expect(plan.lights[1].position).toEqual(bound.position);
    expect(plan.lights[1].intensity).toBeGreaterThan(bound.intensity);
  });
  it('leaves lighting unchanged when rooms or fixtures cannot be found', () => {
    const lights = [manual];
    expect(planAutoLighting([], lights, 'custom', 'warm').lights).toBe(lights);
    expect(planAutoLighting(room, lights, 'fixtures', 'warm').changed).toBe(0);
  });
});
