// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DeveloperSDK } from '../services/developerService';
import { KernelArcHost } from '../tools/kernelArcHost';
import type { Shape } from '../types';

// Every example script in the Developer Console runs against the real SDK without throwing or
// the SDK reporting an unknown name, a missing object, or a command that did nothing.
const source = readFileSync(resolve(__dirname, 'DeveloperSuite.tsx'), 'utf8');
const examples: { line: number; code: string }[] = [];
for (const m of source.matchAll(/code: `((?:[^`\\]|\\.)*)`/g)) {
  if (m[1]!.includes('${')) continue; // built from values at runtime (the block-kit panel)
  examples.push({
    line: source.slice(0, m.index).split('\n').length,
    code: m[1]!.replace(/\\`/g, '`').replace(/\\\$/g, '$'),
  });
}

describe('Developer Console examples', () => {
  it('finds the examples', () => {
    expect(examples.length).toBeGreaterThan(80);
  });

  for (const { line, code } of examples) {
    it(`example at DeveloperSuite.tsx:${line} runs`, () => {
      let shapes: Shape[] = [];
      const logs: string[] = [];
      const sdk = new DeveloperSDK(shapes, (n: any) => { shapes = typeof n === 'function' ? n(shapes) : n; }, vi.fn(), null, {
        kernelHost: new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } }), bumpKernel: vi.fn(),
        onLog: (l: string) => logs.push(l), collaborators: [],
        customToolbars: [], setCustomToolbars: vi.fn(), basicToolbarExtensions: [], setBasicToolbarExtensions: vi.fn(),
      });
      const quiet = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };
      expect(() => new Function('sdk', 'console', code)(sdk, quiet)).not.toThrow();
      expect(logs.filter(l => /unknown|not available|not found|no object|did nothing|not drawn/i.test(l))).toEqual([]);
    });
  }
});
