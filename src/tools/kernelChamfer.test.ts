import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createChamferBinding } from './kernelChamfer';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import type { EdgeId } from '../lib/geometry/types';

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

describe('chamfer drag lifecycle', () => {
  it('chamfers a box into 26 faces', () => {
    let bumps = 0;
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => { bumps++; });
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(true);
    b.update(0.3);
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(h.graph.faces.size).toBe(26);
    expect(bumps).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('one drag is one undo entry, and undo restores the sharp box', () => {
    const h = host(); box(h, 4, 2);
    const depth = h.undoDepth;
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    expect(h.undoDepth).toBe(depth + 1);
    h.undo();
    expect(h.graph.faces.size).toBe(6);
  });

  it('survives an unrelated edit elsewhere afterward', () => {
    // The actual fix, exercised through the binding a user would drive:
    // chamfer a box, do something else entirely unrelated, confirm the
    // chamfer is still intact.
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    expect(h.graph.faces.size).toBe(26);

    h.commitSegment(vec3(20,0,0), vec3(24,0,0));
    h.commitSegment(vec3(24,0,0), vec3(24,0,4));
    h.commitSegment(vec3(24,0,4), vec3(20,0,4));
    h.commitSegment(vec3(20,0,4), vec3(20,0,0));

    expect(h.graph.faces.size).toBe(27);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('chamfer binding — eligibility and refusals', () => {
  it('refuses to begin on too few faces', () => {
    const h = host(); square(h, 4);
    const b = createChamferBinding(h, () => {});
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(false);
    expect(b.active).toBe(false);
  });

  it('refuses a non-positive amount at commit', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0);
    const result = b.commit();
    expect(result.ok).toBe(false);
    expect(h.graph.faces.size).toBe(6); // untouched
  });

  it('refuses a face with a hole, leaving the graph untouched', () => {
    const h = host();
    square(h, 8);
    const inner = [vec3(2,0,2), vec3(4,0,2), vec3(4,0,4), vec3(2,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(inner[i]!, inner[(i+1)%4]!);
    const outer = [...h.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      outer.id, 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);
    const before = h.graph.faces.size;

    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    const result = b.commit();
    expect(result.ok).toBe(false);
    expect(h.graph.faces.size).toBe(before);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('chamfer binding — lifecycle', () => {
  it('cancel leaves the model untouched', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.cancel();
    expect(b.active).toBe(false);
    expect(h.graph.faces.size).toBe(6);
  });

  it('commit before begin is a no-op, not a crash', () => {
    const h = host();
    const b = createChamferBinding(h, () => {});
    const result = b.commit();
    expect(result.ok).toBe(false);
  });

  it('update recomputes fresh each call, not compounding', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    for (let i = 1; i <= 20; i++) b.update(i * 0.01);
    b.update(0.3); // ends here regardless of the path taken
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(h.graph.faces.size).toBe(26);
  });
});
