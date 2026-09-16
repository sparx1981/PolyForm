import { describe, it, expect } from 'vitest';
import { isWalkCollidable } from './collidables';
import type { Shape } from '../../types';

function shape(overrides: Partial<Shape>): Shape {
  return {
    id: 'id',
    type: 'box',
    position: [0, 0, 0],
    args: [],
    color: '#fff',
    ...overrides,
  } as Shape;
}

describe('isWalkCollidable', () => {
  it('collides with architecture and landscape geometry', () => {
    const solidTypes = ['wall', 'window', 'step', 'staircase', 'roof', 'terrain', 'fence', 'railing', 'lamp', 'bench', 'rock', 'tree'] as const;
    for (const type of solidTypes) {
      expect(isWalkCollidable(shape({ type }))).toBe(true);
    }
  });

  it('collides with basic shapes and drawn/poly geometry, so anything drawn can be walked into, on, or jumped onto', () => {
    const solidTypes = ['box', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'cylinder', 'prism', 'rect', 'circle', 'triangle', 'line', 'poly', 'bezier', 'arc', 'custom'] as const;
    for (const type of solidTypes) {
      expect(isWalkCollidable(shape({ type }))).toBe(true);
    }
  });

  it('excludes doors so doorways are always walkable', () => {
    expect(isWalkCollidable(shape({ type: 'door' }))).toBe(false);
  });

  it('excludes small plants (bushes) but not trees', () => {
    expect(isWalkCollidable(shape({ type: 'bush' }))).toBe(false);
    expect(isWalkCollidable(shape({ type: 'tree' }))).toBe(true);
  });

  it('excludes scale-reference figures and dimension annotations', () => {
    expect(isWalkCollidable(shape({ type: 'scale_figure' }))).toBe(false);
    expect(isWalkCollidable(shape({ type: 'measurement' }))).toBe(false);
  });

  it('excludes hidden shapes even if their type is normally solid', () => {
    expect(isWalkCollidable(shape({ type: 'wall', hidden: true }))).toBe(false);
  });

  it('treats timber frame member data as collidable too (already covered by the default)', () => {
    expect(isWalkCollidable(shape({ type: 'box', timberMemberData: {} as any }))).toBe(true);
    expect(isWalkCollidable(shape({ type: 'box', timberFrame: {} as any }))).toBe(true);
  });
});
