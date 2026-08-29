import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createGroupTransformBinding } from './kernelGroupTransform';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { boundsOfFaces } from '../lib/geometry/grouptransform';
import { faceGroups } from './kernelSelection';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import type { FaceId } from '../lib/geometry/types';

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

describe('translate', () => {
  it('moves a box as one rigid body', () => {
    let bumps = 0;
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;

    const t = createGroupTransformBinding(h, () => { bumps++; });
    t.begin(ids);
    t.updateTranslate(vec3(10, 0, -3));
    expect(t.commit()).toBe(true);

    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.center.x).toBeCloseTo(before.center.x + 10, 6);
    expect(after.center.z).toBeCloseTo(before.center.z - 3, 6);
    expect(after.size.x).toBeCloseTo(before.size.x, 6);
    expect(h.graph.faces.size).toBe(6);
    expect(bumps).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('one drag is one undo entry', () => {
    const h = host(); box(h, 4, 2);
    const depth = h.undoDepth;
    const t = createGroupTransformBinding(h, () => {});
    t.begin([...h.graph.faces.keys()]);
    t.updateTranslate(vec3(1, 1, 1));
    t.commit();
    expect(h.undoDepth).toBe(depth + 1);
  });

  it('undo restores the pre-drag position exactly', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;
    const t = createGroupTransformBinding(h, () => {});
    t.begin(ids);
    t.updateTranslate(vec3(5, 5, 5));
    t.commit();
    h.undo();
    const restored = boundsOfFaces(h.graph, ids)!;
    expect(restored.center.x).toBeCloseTo(before.center.x, 9);
    expect(restored.center.y).toBeCloseTo(before.center.y, 9);
  });
});

describe('scale', () => {
  it('scales the group about its own center by default', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const center = boundsOfFaces(h.graph, ids)!.center;

    const t = createGroupTransformBinding(h, () => {});
    t.begin(ids);
    t.updateScale(vec3(2, 2, 2));
    t.commit();

    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeCloseTo(8, 6);
    expect(after.center.x).toBeCloseTo(center.x, 6);
    expect(after.center.z).toBeCloseTo(center.z, 6);
  });

  it('recomputes fresh each update, not compounding across the drag', () => {
    // A scale gesture reports "2x now", not "1.01x on top of the last 1.01x"
    // — otherwise floating-point drift accumulates over a long drag, and a
    // gesture that ends where it started would not exactly cancel out.
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const t = createGroupTransformBinding(h, () => {});
    t.begin(ids);
    for (let i = 0; i < 50; i++) t.updateScale(vec3(1 + i * 0.01, 1, 1));
    t.updateScale(vec3(1, 1, 1)); // ends back at identity
    t.commit();
    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeCloseTo(4, 9); // exact, no drift
  });

  it('clamps a near-zero factor rather than collapsing the group', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const t = createGroupTransformBinding(h, () => {});
    t.begin(ids);
    t.updateScale(vec3(0, 1, 1));
    t.commit();
    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeGreaterThan(0);
  });
});

describe('rotate', () => {
  it('swaps footprint dimensions under a 90 degree turn', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;

    const t = createGroupTransformBinding(h, () => {});
    t.begin(ids);
    t.updateRotate(vec3(0, 1, 0), Math.PI / 2);
    t.commit();

    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.size.x).toBeCloseTo(before.size.z, 5);
    expect(after.size.z).toBeCloseTo(before.size.x, 5);
  });
});

describe('lifecycle', () => {
  it('cancel leaves the model untouched', () => {
    const h = host(); box(h, 4, 2);
    const ids = [...h.graph.faces.keys()];
    const before = boundsOfFaces(h.graph, ids)!;
    const t = createGroupTransformBinding(h, () => {});
    t.begin(ids);
    t.updateTranslate(vec3(9, 9, 9));
    t.cancel();
    expect(t.active).toBe(false);
    const after = boundsOfFaces(h.graph, ids)!;
    expect(after.center.x).toBeCloseTo(before.center.x, 9);
  });

  it('committing with no update applied returns false and touches nothing', () => {
    const h = host(); box(h, 4, 2);
    const depth = h.undoDepth;
    const t = createGroupTransformBinding(h, () => {});
    t.begin([...h.graph.faces.keys()]);
    expect(t.commit()).toBe(false);
    expect(h.undoDepth).toBe(depth);
  });

  it('begin with an empty selection is a no-op', () => {
    const h = host(); box(h, 4, 2);
    const t = createGroupTransformBinding(h, () => {});
    t.begin([]);
    expect(t.active).toBe(false);
  });

  it('commit before begin is a no-op, not a crash', () => {
    const h = host();
    const t = createGroupTransformBinding(h, () => {});
    expect(t.commit()).toBe(false);
  });
});

describe('group semantics — one gesture moves the whole solid', () => {
  it('translating one face of a group, via faceGroups, moves all six', () => {
    const h = host(); box(h, 4, 2);
    const oneFace = only(h);
    const group = faceGroups(h.graph).find(g => g.faces.includes(oneFace))!.faces;
    expect(group).toHaveLength(6);

    const before = boundsOfFaces(h.graph, group)!;
    const t = createGroupTransformBinding(h, () => {});
    t.begin(group);
    t.updateTranslate(vec3(3, 0, 0));
    t.commit();

    const after = boundsOfFaces(h.graph, group)!;
    expect(after.center.x).toBeCloseTo(before.center.x + 3, 6);
    // Still one solid, not fragmented by the move.
    expect(faceGroups(h.graph)).toHaveLength(1);
  });
});
