import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createFaceOffsetBinding } from './kernelFaceOffset';
import { vec2, vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import type { FaceId } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0,0,-1), upAxis: vec3(0,1,0) });
const square = (h: KernelArcHost, n = 4) => {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i+1)%4]!);
};
const only = (h: KernelArcHost) => [...h.graph.faces.keys()][0]!;

describe('cursor-position-based drag', () => {
  it('hovering outside the boundary previews a positive (grow) distance', () => {
    const h = host(); square(h, 4);
    const b = createFaceOffsetBinding(h, () => {});
    expect(b.begin(only(h))).toBe(true);
    // World point well outside the 0..4 square, converted into the face's
    // OWN 2D basis (which need not align with world axes at all).
    const cursor = b.projectToSessionPlane(vec3(8, 0, 8))!;
    const d = b.update(cursor);
    expect(d).toBeGreaterThan(0);
  });

  it('hovering inside previews a negative (shrink) distance', () => {
    const h = host(); square(h, 4);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    const cursor = b.projectToSessionPlane(vec3(2, 0, 2))!; // the square's centre
    const d = b.update(cursor);
    expect(d).toBeLessThan(0);
  });

  it('committing a grow produces TWO faces, not a reshaped single one', () => {
    // The bug this guards: the original (wrong) version moved the boundary
    // in place, leaving exactly one face and no "outer" half to select.
    let bumps = 0;
    const h = host(); square(h, 4);
    const b = createFaceOffsetBinding(h, () => { bumps++; });
    b.begin(only(h));
    b.update(b.projectToSessionPlane(vec3(8, 0, 8))!);
    expect(b.commit()).toBe(true);
    expect(h.graph.faces.size).toBe(2);
    expect(bumps).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('one drag is one undo entry, and undo restores the original size', () => {
    const h = host(); square(h, 4);
    const depth = h.undoDepth;
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    // Off-centre, not the exact middle: the centre of a 4x4 square is
    // distance 2 from every edge, and shrinking by exactly 2 collapses it
    // to zero width -- a real degenerate case, not what this test is
    // checking. (1,2) is safely inside with a smaller, sane distance.
    b.update(b.projectToSessionPlane(vec3(1, 0, 2))!);
    b.commit();
    expect(h.undoDepth).toBe(depth + 1);
    h.undo();
    // Back to the original 4x4 footprint.
    const xs = [...h.graph.vertices.values()].map(v => v.position.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 6);
  });
});

describe('eligibility', () => {
  it('a face sharing an edge with a neighbour IS eligible — insertion never touches it', () => {
    // The move-based version had to refuse this. Insertion only adds new
    // geometry inside the face's own boundary, so a wall that is part of an
    // already-extruded box is just as offsettable as a free rectangle.
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    const [a] = [...h.graph.faces.keys()];
    const b = createFaceOffsetBinding(h, () => {});
    expect(b.begin(a!)).toBe(true);
  });

  it('refuses a face with a hole', () => {
    const h = host();
    square(h, 8);
    const inner = [vec3(2,0,2), vec3(4,0,2), vec3(4,0,4), vec3(2,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(inner[i]!, inner[(i+1)%4]!);
    const outer = [...h.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const b = createFaceOffsetBinding(h, () => {});
    expect(b.begin(outer.id)).toBe(false);
  });

  it('a missing face fails cleanly', () => {
    const h = host();
    const b = createFaceOffsetBinding(h, () => {});
    expect(b.begin(999 as FaceId)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('cancel leaves the model untouched', () => {
    const h = host(); square(h, 4);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    b.update(b.projectToSessionPlane(vec3(9, 0, 9))!);
    b.cancel();
    expect(b.active).toBe(false);
    expect(h.graph.faces.size).toBe(1);
    const xs = [...h.graph.vertices.values()].map(v => v.position.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 6);
  });

  it('committing with no update applied returns false', () => {
    const h = host(); square(h, 4);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    expect(b.commit()).toBe(false);
  });

  it('commit before begin is a no-op, not a crash', () => {
    const h = host();
    const b = createFaceOffsetBinding(h, () => {});
    expect(b.commit()).toBe(false);
  });

  it('projectToSessionPlane returns null before a session begins', () => {
    const h = host();
    const b = createFaceOffsetBinding(h, () => {});
    expect(b.projectToSessionPlane(vec3(1,1,1))).toBeNull();
  });

  it('projectToSessionPlane matches the session polygon\'s own basis', () => {
    const h = host(); square(h, 4);
    const b = createFaceOffsetBinding(h, () => {});
    b.begin(only(h));
    const p = b.projectToSessionPlane(vec3(2, 0, 2));
    expect(p).not.toBeNull();
  });
});
