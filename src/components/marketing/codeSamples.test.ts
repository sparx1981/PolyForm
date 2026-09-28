// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { CODE_LONG, CODE_SHORT } from './data';
import { DeveloperSDK } from '../../services/developerService';
import type { Shape } from '../../types';

// The website's code samples are real scripts: they run against the SDK as written.
describe('website code samples', () => {
  for (const [name, sample] of [['short', CODE_SHORT], ['long', CODE_LONG]] as const) {
    it(`the ${name} sample runs`, () => {
      let shapes: Shape[] = [];
      const logs: string[] = [];
      const sdk = new DeveloperSDK(shapes, (n: any) => { shapes = typeof n === 'function' ? n(shapes) : n; }, vi.fn(), null,
        { onLog: (l: string) => logs.push(l) });
      const code = sample.map(l => l.t).join('\n');
      expect(() => new Function('sdk', 'console', code)(sdk, { log: vi.fn() })).not.toThrow();
      expect(logs.filter(l => /unknown|not found|no object/i.test(l))).toEqual([]);
      expect(shapes.length).toBeGreaterThan(0);
    });
  }
});
