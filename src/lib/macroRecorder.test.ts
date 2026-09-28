// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DeveloperSDK } from '../services/developerService';
import { diffShapesToSdk, sdkLiteral, actionLabel, normalizeForScript } from './macroRecorder';
import type { Shape } from '../types';

function shape(overrides: Partial<Shape>): Shape {
  return { id: 'a', type: 'box', position: [0, 0, 0], args: [1, 1, 1], color: '#ffffff', ...overrides } as Shape;
}

/** Runs a recorded script the way the Developer Console does, against a real SDK. */
function replay(start: Shape[], lines: string[]): Shape[] {
  let shapes = start;
  const setShapes = (next: Shape[] | ((prev: Shape[]) => Shape[])) => {
    shapes = typeof next === 'function' ? next(shapes) : next;
  };
  const sdk = new DeveloperSDK(shapes, setShapes, () => {}, null, {});
  new Function('sdk', lines.join('\n'))(sdk);
  return shapes;
}

const tidy = (shapes: Shape[]) => normalizeForScript([...shapes].sort((x, y) => x.id.localeCompare(y.id)));

describe('diffShapesToSdk', () => {
  it('writes nothing when nothing changed', () => {
    const s = [shape({})];
    expect(diffShapesToSdk(s, s)).toEqual([]);
    expect(diffShapesToSdk(s, [{ ...s[0] }])).toEqual([]);
  });

  it('records adds (keeping the id), changes and deletes that replay to the same model', () => {
    const before = [
      shape({ id: 'keep', name: 'Kept', position: [1, 0, 1] }),
      shape({ id: 'gone', name: 'Removed' }),
      shape({ id: 'roofy', type: 'custom', roofData: { pitch: 30 }, hidden: true }),
    ];
    const after = [
      shape({ id: 'keep', name: 'Kept "quoted"\nname', position: [2.5, 0, 1], rotation: [0, Math.PI / 2, 0] }),
      shape({ id: 'roofy', type: 'custom', roofData: { pitch: 35 } }),
      shape({ id: 'new', type: 'sphere', args: [2, 32, 32], color: '#ff0000', tags: ['a', 'b'] }),
    ];
    const lines = diffShapesToSdk(before, after);
    expect(lines).toContain('sdk.deleteObject("gone");');
    expect(lines.some(l => l.startsWith('sdk.addObject("sphere", {"id":"new"'))).toBe(true);
    // Only the fields that changed are written; a removed field is set to undefined.
    const roofLine = lines.find(l => l.includes('"roofy"'))!;
    expect(roofLine).toContain('"hidden": undefined');
    expect(roofLine).not.toContain('"color"');
    expect(tidy(replay(before, lines))).toEqual(tidy(after));
  });

  it('replaying an add onto a model that already has that id replaces it rather than duplicating', () => {
    const after = [shape({ id: 'x', color: '#00ff00' })];
    const lines = diffShapesToSdk([], after);
    const twice = replay(replay([], lines), lines);
    expect(twice).toHaveLength(1);
  });

  it('writes typed arrays as plain arrays and rounds floating-point noise', () => {
    const lit = sdkLiteral({ positions: new Float32Array([0.5, 1]), x: 0.1 + 0.2, y: -0 });
    expect(lit).toBe('{"positions":[0.5,1],"x":0.3,"y":0}');
  });
});

describe('actionLabel', () => {
  it('keeps any text inside a single comment line', () => {
    expect(actionLabel('Note\nsdk.clearScene(true)')).toBe('// Note sdk.clearScene(true)');
  });
});
