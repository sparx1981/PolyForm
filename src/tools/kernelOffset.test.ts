import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createOffsetBinding } from './kernelOffset';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { boundsOfFaces } from '../lib/geometry/grouptransform';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';

const host = () => new KernelArcHost({ cameraDirection: vec3(0,0,-1), upAxis: vec3(0,1,0) });
const square = (h: KernelArcHost, n = 4) => {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i+1)%4]!);
};
const only = (h: KernelArcHost) => [...h.graph.faces.keys()][0]!;

function box(h: KernelArcHost, n = 4, height = 2) {
  square(h, n);
  const r = pushPull(
    { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
    only(h), height, { tolerances: h.tolerances },
  );
  derive(h.graph, r.touched, h.deriveOptions);
}

describe('grow and shrink', () => {
  it('grows a box uniformly on every side', () => {
    let bumps = 0;
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;

    const o = createOffsetBinding(h, () => { bumps++; });
    o.begin(ids);
    o.update(0.5);
    expect(o.commit()).toBe(true);

    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeCloseTo(before.size.x + 1, 6);
    expect(after.size.y).toBeCloseTo(before.size.y + 1, 6);
    expect(after.size.z).toBeCloseTo(before.size.z + 1, 6);
    expect(h.graph.faces.size).toBe(6);
    expect(bumps).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('a negative distance shrinks it', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;

    const o = createOffsetBinding(h, () => {});
    o.begin(ids);
    o.update(-0.5);
    o.commit();

    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeCloseTo(before.size.x - 1, 6);
  });

  it('one drag is one undo entry', () => {
    const h = host(); box(h, 4, 2);
    const depth = h.undoDepth;
    const o = createOffsetBinding(h, () => {});
    o.begin([...h.graph.faces.keys()]);
    o.update(0.3);
    o.commit();
    expect(h.undoDepth).toBe(depth + 1);
  });

  it('undo restores the exact pre-offset size', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;
    const o = createOffsetBinding(h, () => {});
    o.begin(ids);
    o.update(1.5);
    o.commit();
    h.undo();
    const restored = boundsOfFaces(h.graph, ids)!;
    expect(restored.size.x).toBeCloseTo(before.size.x, 9);
  });
});

describe('lifecycle', () => {
  it('cancel leaves the model untouched', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;
    const o = createOffsetBinding(h, () => {});
    o.begin(ids);
    o.update(2);
    o.cancel();
    expect(o.active).toBe(false);
    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeCloseTo(before.size.x, 9);
  });

  it('a near-zero distance commits nothing', () => {
    // Overwhelmingly a slip, and a zero offset is degenerate.
    const h = host(); box(h, 4, 2);
    const depth = h.undoDepth;
    const o = createOffsetBinding(h, () => {});
    o.begin([...h.graph.faces.keys()]);
    o.update(1e-9);
    expect(o.commit()).toBe(false);
    expect(h.undoDepth).toBe(depth);
  });

  it('begin with an empty selection is a no-op', () => {
    const h = host(); box(h, 4, 2);
    const o = createOffsetBinding(h, () => {});
    o.begin([]);
    expect(o.active).toBe(false);
  });

  it('commit before begin is a no-op, not a crash', () => {
    const h = host();
    const o = createOffsetBinding(h, () => {});
    expect(o.commit()).toBe(false);
  });

  it('update recomputes fresh each call, not compounding', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const o = createOffsetBinding(h, () => {});
    o.begin(ids);
    for (let i = 0; i < 30; i++) o.update(i * 0.1);
    o.update(0.5); // ends here, regardless of the path taken
    o.commit();
    const after = boundsOfFaces(h.graph, ids)!;
    const before = boundsOfFaces(h.graph, ids)!;
    void before;
    // Exact, not drifted: a fresh compute each call means the final value
    // is all that matters, independent of how many updates preceded it.
    expect(after.size.x).toBeCloseTo(4 + 1, 6);
  });
});
