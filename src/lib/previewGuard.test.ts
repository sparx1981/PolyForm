import { describe, it, expect } from 'vitest';
import { previewIsDegenerate, ringIsDegenerate } from './previewGuard';

describe('previewIsDegenerate', () => {
  it('flags a rectangle dragged to nothing in either direction, and only then', () => {
    expect(previewIsDegenerate({ type: 'rect', args: [0, 0.01, 3] })).toBe(true);
    expect(previewIsDegenerate({ type: 'rect', args: [2, 0.01, 0] })).toBe(true);
    expect(previewIsDegenerate({ type: 'rect', args: [0.0004, 0.01, 3] })).toBe(true);
    expect(previewIsDegenerate({ type: 'rect', args: [0.002, 0.01, 3] })).toBe(false);
    expect(previewIsDegenerate({ type: 'rect', args: [2, 0.01, 3] })).toBe(false); // the flat 0.01 is its thickness
  });

  it('flags circles, triangles and lines of no size, and anything not a number', () => {
    expect(previewIsDegenerate({ type: 'circle', args: [0, 0, 0.01, 32] })).toBe(true);
    expect(previewIsDegenerate({ type: 'triangle', args: [0, 0, 0.01, 3] })).toBe(true);
    expect(previewIsDegenerate({ type: 'line', args: [0.01, 0.01, 0, 8] })).toBe(true);
    expect(previewIsDegenerate({ type: 'circle', args: [NaN, NaN, 0.01, 32] })).toBe(true);
    expect(previewIsDegenerate({ type: 'circle', args: [1, 1, 0.01, 32] })).toBe(false);
  });

  it('leaves other previews (walls, stairs, doors ...) alone', () => {
    expect(previewIsDegenerate({ type: 'wall', args: [0, 0, 0] })).toBe(false);
    expect(previewIsDegenerate({ type: 'staircase', args: undefined })).toBe(false);
  });
});

describe('ringIsDegenerate', () => {
  const p = (x: number, z: number) => ({ x, y: 0, z });
  it('flags a ring with a side under a millimetre, or non-finite corners', () => {
    expect(ringIsDegenerate([p(0, 0), p(0.0004, 0), p(0.0004, 3), p(0, 3)])).toBe(true);
    expect(ringIsDegenerate([p(0, 0), p(NaN, 0), p(1, 3), p(0, 3)])).toBe(true);
    expect(ringIsDegenerate([p(0, 0), p(2, 0), p(2, 3), p(0, 3)])).toBe(false);
  });
});
