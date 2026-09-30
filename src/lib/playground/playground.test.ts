// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLocalRunner, MAX_OBJECTS } from './runnerCore';
import { PLAYGROUND_EXAMPLES } from './examples';
import { sandboxDocument } from './sandbox';

const run = createLocalRunner();

describe('playground examples', () => {
  for (const example of PLAYGROUND_EXAMPLES) {
    it(`runs "${example.title}" and draws something`, async () => {
      const result = await run(example.code);
      expect(result.error).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.objects.length).toBeGreaterThan(0);
      expect(result.logs.length).toBeGreaterThan(0);
      for (const o of result.objects) {
        expect(o.size.every(Number.isFinite)).toBe(true);
        expect(o.position.every(Number.isFinite)).toBe(true);
      }
    });
  }
  it('has unique ids', () => {
    expect(new Set(PLAYGROUND_EXAMPLES.map(e => e.id)).size).toBe(PLAYGROUND_EXAMPLES.length);
  });
});

describe('preview sdk', () => {
  it('builds a room from four walls and a floor', async () => {
    const r = await run(`const room = sdk.architecture.createRoom({ width: 4, length: 3, height: 2.5 }); console.log(room.wallShapes.length);`);
    expect(r.objects).toHaveLength(5);
    expect(r.logs[0]?.text).toBe('4');
  });
  it('sizes a roof from the pitch', async () => {
    const r = await run(`sdk.architecture.createRoof({ width: 4, depth: 4, pitchAngleDeg: 45, position: [0, 3, 0] });`);
    const roof = r.objects[0]!;
    expect(roof.kind).toBe('roof');
    expect(roof.size[1]).toBeCloseTo(2.3, 1);
    expect(roof.position[1]).toBeCloseTo(3 + roof.size[1] / 2, 5);
  });
  it('recolours and extrudes existing shapes', async () => {
    const r = await run(`const b = sdk.createBox({ width: 1, height: 1, depth: 1 }); sdk.applyColor(b, '#ff0000'); sdk.pushPull(b, 2);`);
    expect(r.objects[0]!.color).toBe('#ff0000');
    expect(r.objects[0]!.size[1]).toBe(2);
  });
  it('supports await', async () => {
    expect((await run(`await Promise.resolve(); sdk.createSphere({ radius: 1 });`)).objects).toHaveLength(1);
  });
  it('explains unsupported calls and keeps what was drawn before', async () => {
    const r = await run(`sdk.createBox({ width: 1, height: 1, depth: 1 }); sdk.worldView.importMap({});`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not available in this browser preview/);
    expect(r.objects).toHaveLength(1);
  });
  it('reports syntax and runtime errors', async () => {
    expect((await run('const = ;')).ok).toBe(false);
    expect((await run('null.x')).error).toBeTruthy();
  });
  it('caps runaway object creation', async () => {
    const r = await run(`for (let i = 0; i < 100000; i++) sdk.createBox({ width: 1, height: 1, depth: 1 });`);
    expect(r.ok).toBe(false);
    expect(r.objects.length).toBe(MAX_OBJECTS);
  });
  it('ignores hostile colours and bad numbers', async () => {
    const r = await run(`const b = sdk.createBox({ width: NaN, height: Infinity, depth: 'x', position: ['a', 1, 2] }); sdk.applyColor(b, 'red;background:url(x)');`);
    expect(r.ok).toBe(true);
    expect(r.objects[0]!.size.every(Number.isFinite)).toBe(true);
    expect(r.objects[0]!.color).toBe('#cbd5e1');
  });
  it('formats console output', async () => {
    const r = await run(`console.log('a', 1, { b: 2 }); console.warn('careful');`);
    expect(r.logs).toEqual([{ level: 'log', text: 'a 1 {"b":2}' }, { level: 'warn', text: 'careful' }]);
  });
});

describe('sandbox document', () => {
  it('has no network, no top-level access and embeds the runner safely', () => {
    const html = sandboxDocument();
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/connect-src|allow-same-origin/);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
