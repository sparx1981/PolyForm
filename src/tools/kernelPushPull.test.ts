import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createPushPullBinding } from './kernelPushPull';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import type { FaceId } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0,0,-1), upAxis: vec3(0,1,0) });
const square = (h: KernelArcHost, n = 4) => {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i+1)%4]!);
};
const only = (h: KernelArcHost) => [...h.graph.faces.keys()][0]!;
/** A horizontal ray aimed at height h, as an angled drag would produce. */
const rayAt = (h: number) => ({ origin: vec3(10, h, 2), direction: vec3(-1, 0, 0) });

describe('drag lifecycle', () => {
  it('a full drag turns a square into a box', () => {
    let bumps = 0;
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => { bumps++; });

    pp.begin(only(h), vec3(2, 0, 2));
    expect(pp.active).toBe(true);
    expect(pp.update(rayAt(2))).toBeCloseTo(2, 6);
    expect(pp.commit()).toBe(true);

    expect(h.graph.faces.size).toBe(6);
    expect(pp.active).toBe(false);
    expect(bumps).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('applies the extrusion ONCE, not per frame', () => {
    // Extruding live would push a transaction per pointer move and fill the
    // undo stack with a hundred states of one drag.
    let bumps = 0;
    const h = host(); square(h);
    const depth = h.undoDepth;
    const pp = createPushPullBinding(h, () => { bumps++; });

    pp.begin(only(h), vec3(2, 0, 2));
    for (let i = 1; i <= 20; i++) pp.update(rayAt(i / 10));
    expect(h.graph.faces.size).toBe(1);   // nothing applied yet
    expect(bumps).toBe(0);

    pp.commit();
    expect(bumps).toBe(1);
    expect(h.undoDepth).toBe(depth + 1);  // one undo entry for the whole drag
  });

  it('one drag is one undo, and undo restores the flat square', () => {
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(only(h), vec3(2, 0, 2));
    pp.update(rayAt(2));
    pp.commit();
    expect(h.graph.faces.size).toBe(6);

    h.undo();
    expect(h.graph.faces.size).toBe(1);
    expect(h.graph.edges.size).toBe(4);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('cancel leaves the model untouched', () => {
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(only(h), vec3(2, 0, 2));
    pp.update(rayAt(3));
    pp.cancel();
    expect(pp.active).toBe(false);
    expect(h.graph.faces.size).toBe(1);
  });

  it('a click with no drag commits nothing', () => {
    // Overwhelmingly a slip, and a zero-height extrusion is degenerate.
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(only(h), vec3(2, 0, 2));
    expect(pp.commit()).toBe(false);
    expect(h.graph.faces.size).toBe(1);
    expect(h.undoDepth).toBe(4);   // unchanged: the four drawn lines
  });

  it('update before begin is a no-op rather than a crash', () => {
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    expect(pp.update(rayAt(2))).toBeNull();
    expect(pp.commit()).toBe(false);
  });

  it('holds the last distance when the view goes degenerate', () => {
    // A ray along the extrusion axis has no unique projection; freezing beats
    // snapping the face to some arbitrary value mid-drag.
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(only(h), vec3(2, 0, 2));
    pp.update(rayAt(2));
    const held = pp.update({ origin: vec3(2, 9, 2), direction: vec3(0, -1, 0) });
    expect(held).toBeCloseTo(2, 6);
  });

  it('a missing face fails cleanly and leaves the model intact', () => {
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(999 as FaceId, vec3(2, 0, 2));
    pp.update(rayAt(2));
    expect(pp.commit()).toBe(false);
    expect(h.graph.faces.size).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('pushing down works as well as pulling up', () => {
    const h = host(); square(h);
    const pp = createPushPullBinding(h, () => {});
    pp.begin(only(h), vec3(2, 0, 2));
    pp.update(rayAt(-2));
    expect(pp.commit()).toBe(true);
    expect(h.graph.faces.size).toBe(6);
  });
});

describe('push/pull on an isolated-shape face', () => {
  function circlePoints(cx: number, cz: number, r: number, n: number) {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return vec3(cx + Math.sin(a) * r, 0, cz + Math.cos(a) * r);
    });
  }

  it('extruding a face marked isolatedShape keeps a second overlapping shape intact', () => {
    // The end-to-end version of the fix: a face carrying the same marker
    // Viewport.tsx sets on a Rectangle/Circle/Triangle's own face, pushed
    // through the REAL binding a user's drag actually goes through — not
    // just the underlying pushPull() function directly. Confirms the
    // marker is actually read and acted on here, not merely plumbed
    // through and unused.
    const h = host();

    const a = circlePoints(2, 2, 2, 16);
    for (let i = 0; i < a.length; i++) h.commitIsolatedSegment(a[i]!, a[(i + 1) % a.length]!);
    const faceAId = only(h);
    const faceA = h.graph.faces.get(faceAId)!;
    faceA.attributes.custom.isolatedShape = true;

    const ppA = createPushPullBinding(h, () => {});
    ppA.begin(faceAId, vec3(2, 0, 2));
    ppA.update(rayAt(2));
    expect(ppA.commit()).toBe(true);

    const facesBeforeB = new Set(h.graph.faces.keys());
    const b = circlePoints(4.3, 3.7, 1.6, 16);
    for (let i = 0; i < b.length; i++) h.commitIsolatedSegment(b[i]!, b[(i + 1) % b.length]!);
    const faceB = [...h.graph.faces.values()].find((f) => !facesBeforeB.has(f.id))!;
    faceB.attributes.custom.isolatedShape = true;

    const ppB = createPushPullBinding(h, () => {});
    ppB.begin(faceB.id, vec3(4.3, 0, 3.7));
    ppB.update(rayAt(2));
    expect(ppB.commit()).toBe(true);

    expect(checkIntegrity(h.graph)).toEqual([]);
    expect(h.graph.faces.size).toBe(36); // 2 cylinders x (2 caps @ 16 sides + 16 quad walls)
    const sideCounts: Record<number, number> = {};
    for (const f of h.graph.faces.values()) {
      const n = h.graph.loops.get(f.outerLoop)!.uses.length;
      sideCounts[n] = (sideCounts[n] ?? 0) + 1;
    }
    expect(sideCounts).toEqual({ 4: 32, 16: 4 });
  });

  it('a face WITHOUT the marker still extrudes with the ordinary sticky behaviour', () => {
    // The default-unchanged half of the same check: an ordinary face
    // (drawn with commitSegment, no marker at all) must still behave
    // exactly as it always has.
    const h = host();
    square(h);
    const face = h.graph.faces.get(only(h))!;
    expect(face.attributes.custom.isolatedShape).toBeUndefined();

    const pp = createPushPullBinding(h, () => {});
    pp.begin(face.id, vec3(2, 0, 2));
    pp.update(rayAt(2));
    expect(pp.commit()).toBe(true);
    expect(h.graph.faces.size).toBe(6);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});
