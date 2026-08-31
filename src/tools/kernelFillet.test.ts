import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createFilletBinding } from './kernelFillet';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, loopVertexIds, getVertex } from '../lib/geometry/topology';

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

describe('fillet drag lifecycle', () => {
  it('fillets a box into the expected face count', () => {
    let bumps = 0;
    const h = host(); box(h, 4, 2);
    const b = createFilletBinding(h, () => { bumps++; });
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(true);
    b.update(0.3);
    const result = b.commit();
    expect(result.ok).toBe(true);
    // 6 default segments — matches kernelFillet.ts's DEFAULT_SEGMENTS.
    expect(h.graph.faces.size).toBe(6 + 12 * 6 + 8 * 6 * 6);
    expect(bumps).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('one drag is one undo entry, and undo restores the sharp box', () => {
    const h = host(); box(h, 4, 2);
    const depth = h.undoDepth;
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    expect(h.undoDepth).toBe(depth + 1);
    h.undo();
    expect(h.graph.faces.size).toBe(6);
  });

  it('survives an unrelated edit elsewhere afterward', () => {
    const h = host(); box(h, 4, 2);
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    const expected = 6 + 12 * 6 + 8 * 6 * 6;
    expect(h.graph.faces.size).toBe(expected);

    h.commitSegment(vec3(20,0,0), vec3(24,0,0));
    h.commitSegment(vec3(24,0,0), vec3(24,0,4));
    h.commitSegment(vec3(24,0,4), vec3(20,0,4));
    h.commitSegment(vec3(20,0,4), vec3(20,0,0));

    expect(h.graph.faces.size).toBe(expected + 1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('fillet binding — eligibility and refusals', () => {
  it('refuses a non-box selection (a flat square, not a closed solid)', () => {
    const h = host(); square(h, 4);
    const b = createFilletBinding(h, () => {});
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(false);
    expect(b.active).toBe(false);
  });

  it('refuses a non-positive radius at commit', () => {
    const h = host(); box(h, 4, 2);
    const b = createFilletBinding(h, () => {});
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

    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    const result = b.commit();
    expect(result.ok).toBe(false);
    expect(h.graph.faces.size).toBe(before);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('fillet binding — lifecycle', () => {
  it('cancel leaves the model untouched', () => {
    const h = host(); box(h, 4, 2);
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.cancel();
    expect(b.active).toBe(false);
    expect(h.graph.faces.size).toBe(6);
  });

  it('commit before begin is a no-op, not a crash', () => {
    const h = host();
    const b = createFilletBinding(h, () => {});
    const result = b.commit();
    expect(result.ok).toBe(false);
  });
});

describe('fillet — re-applying to an already-rounded solid is refused, honestly', () => {
  // Unlike chamfer's own identical-looking feature (see
  // kernelChamfer.test.ts), fillet does NOT support re-applying yet — a
  // real bug in filletSolid's own curved-edge-strip construction when
  // run on reconstructed (rather than freshly-drawn) geometry, found and
  // documented directly in kernelFillet.ts's own begin() comment. This
  // is deliberately refused up front, with a clear reason, rather than
  // left to fail confusingly mid-commit — these tests confirm exactly
  // that refusal, not a working feature.

  it('clicking radius again on an already-rounded solid is refused with a clear reason', () => {
    const h = host(); box(h, 4, 2);
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    expect(b.commit().ok).toBe(true);
    const expectedFaceCount = 6 + 12 * 6 + 8 * 6 * 6; // DEFAULT_SEGMENTS = 6
    expect(h.graph.faces.size).toBe(expectedFaceCount);

    const filletedFaces = [...h.graph.faces.keys()];
    const begun = b.begin(filletedFaces);
    expect(begun.ok).toBe(false);
    expect(begun.reason).toMatch(/isn.t supported yet/i);
    expect(b.active).toBe(false);
  });

  it('the refusal leaves the existing filleted solid completely untouched', () => {
    const h = host(); box(h, 4, 2);
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    const expectedFaceCount = 6 + 12 * 6 + 8 * 6 * 6;
    const depthBefore = h.undoDepth;

    b.begin([...h.graph.faces.keys()]);
    expect(h.graph.faces.size).toBe(expectedFaceCount);
    expect(h.undoDepth).toBe(depthBefore);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('fillet — clamped to the safe maximum, never inverts a face', () => {
  it('an over-large radius is clamped, not left to invert the shape', () => {
    const h = host(); box(h, 4, 2); // shortest edge is 2, safe max is 1
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(5); // wildly over the safe max of 1
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);

    const sideFace = [...h.graph.faces.values()].find((f) => Math.abs(f.plane.normal.x) > 0.9)!;
    expect(sideFace).toBeDefined();
    const pts = loopVertexIds(h.graph, sideFace.outerLoop).map((vid) => getVertex(h.graph, vid).position);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(0.95, 5);
    expect(Math.max(...ys)).toBeCloseTo(1.05, 5);
  });
});
