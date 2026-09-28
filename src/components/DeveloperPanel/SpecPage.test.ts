// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PANEL_CARDS, TOOL_SECTIONS } from './SpecPage';
import { DeveloperSDK } from '../../services/developerService';
import { KernelArcHost } from '../../tools/kernelArcHost';
import type { Shape } from '../../types';

// The Spec page describes the real app: these keep it that way.
const root = resolve(__dirname, '../../..');
const cards = [...TOOL_SECTIONS.flatMap(s => s.cards), ...PANEL_CARDS];

describe('Spec page', () => {
  it('only cites files that exist', () => {
    const source = readFileSync(resolve(__dirname, 'SpecPage.tsx'), 'utf8');
    const cited = [...new Set(source.match(/(?:src|docs)\/[A-Za-z0-9_./-]+[A-Za-z0-9_]/g) ?? [])];
    expect(cited.length).toBeGreaterThan(20);
    expect(cited.filter(p => !existsSync(resolve(root, p)))).toEqual([]);
  });

  for (const card of cards.filter(c => c.tryItSnippet)) {
    it(`"${card.title}" try-it snippet runs against the SDK`, () => {
      let shapes: Shape[] = [];
      const logs: string[] = [];
      const host = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
      const sdk = new DeveloperSDK(shapes, (n: any) => { shapes = typeof n === 'function' ? n(shapes) : n; }, vi.fn(), null,
        { kernelHost: host, bumpKernel: vi.fn(), onLog: (m: string) => logs.push(m), collaborators: [] });
      const quiet = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
      expect(() => new Function('sdk', 'console', card.tryItSnippet!)(sdk, quiet)).not.toThrow();
      expect(logs.filter(l => /unknown|not available|not drawn|did nothing|No roof made/i.test(l))).toEqual([]);
    });
  }
});
