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
  it('treats every architecture/landscape type in the solid list as collidable', () => {
    const solidTypes = ['wall', 'window', 'step', 'staircase', 'roof', 'terrain', 'fence', 'railing', 'lamp', 'bench', 'rock'] as const;
    for (const type of solidTypes) {
      expect(isWalkCollidable(shape({ type }))).toBe(true);
    }
  });

  it('excludes doors so doorways are always walkable', () => {
    expect(isWalkCollidable(shape({ type: 'door' }))).toBe(false);
  });

  it('excludes plants and entourage figures', () => {
    expect(isWalkCollidable(shape({ type: 'tree' }))).toBe(false);
    expect(isWalkCollidable(shape({ type: 'bush' }))).toBe(false);
    expect(isWalkCollidable(shape({ type: 'scale_figure' }))).toBe(false);
  });

  it('excludes basic shapes and drawn geometry', () => {
    const excluded = ['box', 'sphere', 'cone', 'pyramid', 'donut', 'dome', 'cylinder', 'prism', 'rect', 'circle', 'triangle', 'line', 'poly', 'bezier', 'arc', 'custom'] as const;
    for (const type of excluded) {
      expect(isWalkCollidable(shape({ type }))).toBe(false);
    }
  });

  it('excludes hidden shapes even if their type is normally solid', () => {
    expect(isWalkCollidable(shape({ type: 'wall', hidden: true }))).toBe(false);
  });

  it('treats timber frame member data as collidable regardless of type', () => {
    expect(isWalkCollidable(shape({ type: 'box', timberMemberData: {} as any }))).toBe(true);
    expect(isWalkCollidable(shape({ type: 'box', timberFrame: {} as any }))).toBe(true);
  });
});
