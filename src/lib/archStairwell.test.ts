import { describe, it, expect } from 'vitest';
import { computeStairHoleForSlab } from './archStairwell';
import type { Shape } from '../types';

// computeStairHoleForSlab (src/lib/archStairwell.ts) is the geometry that
// cuts a floor opening for a staircase — get it wrong and stairs either
// clip through a solid floor slab or the hole is the wrong shape/size. It
// has no dedicated test file today (archStairwell.ts appears nowhere in the
// *.test.* set), despite being exactly the kind of fragile parametric-CAD
// math this project's own inline comments (see the "FIX" notes throughout
// the function) show has already needed several rounds of correction.

// Stair height 2.7 -> top of the flight sits at y = 1.35. The slab default
// below sits its centre exactly there, which is well within every branch of
// computeStairHoleForSlab's (deliberately generous) "is this slab the one at
// the top of the stairs" heuristic.
const STAIR_HEIGHT = 2.7;
const STAIR_TOP_Y = STAIR_HEIGHT / 2;

function stairShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: 'stair-1',
    type: 'staircase',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    args: [1.0, STAIR_HEIGHT, 3.6], // width, height, length
    color: '#ffffff',
    stairStyle: 'straight',
    ...overrides,
  };
}

function slabShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: 'slab-1',
    type: 'box',
    position: [0, STAIR_TOP_Y, 0],
    rotation: [0, 0, 0],
    args: [10, 0.2, 10], // width, thickness, depth
    color: '#cccccc',
    ...overrides,
  };
}

describe('computeStairHoleForSlab', () => {
  it('returns null when the slab is nowhere near the top of the stair', () => {
    const stair = stairShape();
    const farSlab = slabShape({ position: [0, 20, 0] });
    expect(computeStairHoleForSlab(stair, farSlab)).toBeNull();
  });

  it('produces a world-space footprint matching the stair half-width/half-length plus clearance', () => {
    const stairW = 1.0, stairL = 3.6, clearance = 0.08;
    const stair = stairShape({ args: [stairW, 2.7, stairL] });
    const slab = slabShape();
    const result = computeStairHoleForSlab(stair, slab);
    expect(result).not.toBeNull();

    const xs = result!.worldPolygon.map(p => p[0]);
    const zs = result!.worldPolygon.map(p => p[1]);
    const hw = stairW / 2 + clearance;
    const hl = stairL / 2 + clearance;
    expect(Math.max(...xs)).toBeCloseTo(hw, 6);
    expect(Math.min(...xs)).toBeCloseTo(-hw, 6);
    expect(Math.max(...zs)).toBeCloseTo(hl, 6);
    expect(Math.min(...zs)).toBeCloseTo(-hl, 6);
  });

  it('hole2D should describe a real 2D footprint, not a degenerate line, for a slab directly above the stair', () => {
    // With an unrotated slab sitting flat above an unrotated stair, the
    // slab-local 2D hole coordinates should trace out the SAME rectangle
    // (up to translation) as worldPolygon's [x, z] footprint — both are
    // just the horizontal projection of the same four corners.
    //
    // Regression test for a real bug found during audit: computeStairHoleForSlab
    // used to build hole2D from `localPt.x, localPt.y` (the WORLD vertical
    // axis) instead of `localPt.x, localPt.z` (the horizontal plane
    // worldPolygon uses). For an unrotated slab, localPt.y was just a
    // near-constant vertical offset unrelated to the stair's footprint, so
    // every corner collapsed to ~the same value and the "hole" used to cut
    // the floor slab had ~zero area. Now fixed to use `localPt.z`.
    const stair = stairShape();
    const slab = slabShape();
    const result = computeStairHoleForSlab(stair, slab);
    expect(result).not.toBeNull();

    const secondCoords = result!.hole2D.map(p => p[1]);
    const spread = Math.max(...secondCoords) - Math.min(...secondCoords);

    // The stair is 3.6m long, so a correct footprint spans roughly that
    // much in its long axis — well above a rounding-level spread.
    expect(spread).toBeGreaterThan(1.0);
  });

  it('the exit edge sits on the +Z boundary of the hole for a straight flight', () => {
    const stair = stairShape();
    const slab = slabShape();
    const result = computeStairHoleForSlab(stair, slab);
    expect(result).not.toBeNull();
    const [a, b] = result!.exitEdgeWorld!;
    // Both exit-edge endpoints share the same (max) Z as the polygon.
    const maxZ = Math.max(...result!.worldPolygon.map(p => p[1]));
    expect(a[1]).toBeCloseTo(maxZ, 6);
    expect(b[1]).toBeCloseTo(maxZ, 6);
    // And they are not the same point (it is an edge, not a corner).
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(0.1);
  });

  it('reports floorY as the top surface of the slab, not its centre', () => {
    const stair = stairShape();
    const slabThickness = 0.3;
    const slab = slabShape({ position: [0, STAIR_TOP_Y, 0], args: [10, slabThickness, 10] });
    const result = computeStairHoleForSlab(stair, slab);
    expect(result).not.toBeNull();
    expect(result!.floorY).toBeCloseTo(STAIR_TOP_Y + slabThickness / 2, 6);
  });

  it('an L-shaped stair produces a 5-cornered footprint distinct from a straight flight', () => {
    const stair = stairShape({ stairStyle: 'l-shape' });
    const slab = slabShape();
    const result = computeStairHoleForSlab(stair, slab);
    expect(result).not.toBeNull();
    expect(result!.worldPolygon.length).toBe(5);
  });
});
