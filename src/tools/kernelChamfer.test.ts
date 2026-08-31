import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createChamferBinding } from './kernelChamfer';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, loopVertexIds, getVertex } from '../lib/geometry/topology';
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

describe('chamfer — re-apply to an already-chamfered solid', () => {
  it('clicking chamfer again on a chamferLocked solid succeeds with a new amount', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    expect(b.commit().ok).toBe(true);
    expect(h.graph.faces.size).toBe(26); // 6 + 12 + 8

    // Re-select the (now chamfered) solid and click again with a
    // DIFFERENT amount. Ordinary validateSolid would reject this
    // outright — it's no longer a plain box.
    const chamferedFaces = [...h.graph.faces.keys()];
    const begun = b.begin(chamferedFaces);
    expect(begun.ok).toBe(true);
    b.update(0.6);
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(h.graph.faces.size).toBe(26); // same shape, different amount
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('re-applying is exactly one undo entry, not two', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    const depthAfterFirst = h.undoDepth;

    b.begin([...h.graph.faces.keys()]);
    b.update(0.6);
    b.commit();
    expect(h.undoDepth).toBe(depthAfterFirst + 1);

    // Undo returns to the FIRST chamfered state (0.3), not an
    // intermediate sharp box the user never asked to see.
    h.undo();
    expect(h.graph.faces.size).toBe(26);
    // Undo again should reach the original sharp box.
    h.undo();
    expect(h.graph.faces.size).toBe(6);
  });

  it('dragging the re-applied amount down to zero returns to the original sharp box', () => {
    // The actual fix this section exists to verify: 0 is no longer
    // treated as an invalid amount when re-applying — it's how the user
    // returns an already-chamfered solid to its original, unrounded
    // shape. A non-re-apply chamfer still requires a positive amount;
    // see the next test for that.
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();
    expect(h.graph.faces.size).toBe(26);

    b.begin([...h.graph.faces.keys()]);
    b.update(0);
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(h.graph.faces.size).toBe(6); // back to the plain, sharp box
    expect(checkIntegrity(h.graph)).toEqual([]);
    for (const f of h.graph.faces.values()) {
      expect(f.attributes.custom.chamferLocked).toBeUndefined();
    }
  });

  it('an ordinary (non-re-apply) chamfer still requires a positive amount', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0); // invalid — there is no sharp shape to "return to" yet
    const result = b.commit();
    expect(result.ok).toBe(false);
    expect(h.graph.faces.size).toBe(6); // untouched
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('re-applying survives an unrelated edit made after the original chamfer', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();

    // An unrelated edit, far away — this is exactly the scenario undo()
    // would risk unwinding if re-apply were built on it instead of
    // reconstructing from stored boundaries directly.
    h.commitSegment(vec3(20,0,0), vec3(24,0,0));
    h.commitSegment(vec3(24,0,0), vec3(24,0,4));
    h.commitSegment(vec3(24,0,4), vec3(20,0,4));
    h.commitSegment(vec3(20,0,4), vec3(20,0,0));
    const facesAfterUnrelatedEdit = h.graph.faces.size;

    const chamferedFaces = [...h.graph.faces.keys()].filter(
      (fid) => h.graph.faces.get(fid)!.attributes.custom.chamferLocked === true,
    );
    b.begin(chamferedFaces);
    b.update(0.6);
    const result = b.commit();
    expect(result.ok).toBe(true);
    // The unrelated square should still be there, untouched.
    expect(h.graph.faces.size).toBe(facesAfterUnrelatedEdit - 26 + 26); // net same count, re-chamfered
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('chamfer — clamped to the safe maximum, never inverts a face', () => {
  it('an amount well past the safe max is clamped, not left to invert the shape', () => {
    const h = host(); box(h, 4, 2); // shortest edge is 2, safe max is 1
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(5); // wildly over the safe max of 1
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);

    // A side face's own Y-extent must still span the ordinary, non-
    // inverted range up to the clamp point (95% of safeMax=1) — not the
    // mirrored range an unclamped amount=5 would have produced, and not
    // absent entirely (which is what landing exactly at the unmargined
    // safeMax would cause — see kernelChamfer.ts's own comment on why
    // the 0.95 margin is there).
    const sideFace = [...h.graph.faces.values()].find((f) => Math.abs(f.plane.normal.x) > 0.9)!;
    expect(sideFace).toBeDefined();
    const pts = loopVertexIds(h.graph, sideFace.outerLoop).map((vid) => getVertex(h.graph, vid).position);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(0.95, 5);
    expect(Math.max(...ys)).toBeCloseTo(1.05, 5);
  });

  it('clamping also applies correctly when re-applying to an already-chamfered solid', () => {
    const h = host(); box(h, 4, 2);
    const b = createChamferBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]);
    b.update(0.3);
    b.commit();

    b.begin([...h.graph.faces.keys()]);
    b.update(10); // wildly over the safe max, on the re-apply path
    const result = b.commit();
    expect(result.ok).toBe(true);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});
