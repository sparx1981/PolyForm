import { describe, it, expect } from 'vitest';
import {
  signedArea, area, isCounterClockwise, withWinding,
  pointInPolygon, pointInPolygonWithHoles, distanceToBoundary,
  interiorPoint, interiorPointWithHoles,
} from './polygon';
import { vec2 } from './math';
import { DEFAULT_TOLERANCES as T } from './types';

/** L-shape. Its centroid falls OUTSIDE the polygon — the whole point. */
const L_SHAPE = [
  vec2(0, 0), vec2(3, 0), vec2(3, 1), vec2(1, 1), vec2(1, 3), vec2(0, 3),
];

const SQUARE = [vec2(0, 0), vec2(2, 0), vec2(2, 2), vec2(0, 2)];

/** Deep horseshoe: centroid sits in the notch, well outside the material. */
const HORSESHOE = [
  vec2(0, 0), vec2(5, 0), vec2(5, 5), vec2(4, 5), vec2(4, 1),
  vec2(1, 1), vec2(1, 5), vec2(0, 5),
];

const centroidOf = (pts: readonly { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

describe('signed area and winding', () => {
  it('is positive for counter-clockwise', () => {
    expect(signedArea(SQUARE)).toBe(4);
    expect(isCounterClockwise(SQUARE)).toBe(true);
  });

  it('is negative for clockwise', () => {
    expect(signedArea([...SQUARE].reverse())).toBe(-4);
  });

  it('gives the correct area for a concave polygon', () => {
    // L-shape: 3x1 plus 1x2 = 5
    expect(area(L_SHAPE)).toBe(5);
  });

  it('is zero for a degenerate cycle', () => {
    expect(signedArea([vec2(0, 0), vec2(1, 0)])).toBe(0);
    expect(signedArea([vec2(0, 0), vec2(1, 0), vec2(2, 0)])).toBe(0);
  });

  it('rejects a needle sliver by area, not by thinness', () => {
    // A near-colinear crossing at a shallow angle. Genuinely coplanar, three
    // real vertices, essentially no area. §6.2
    const needle = [vec2(0, 0), vec2(1, 0), vec2(0.5, 1e-9)];
    expect(area(needle)).toBeLessThan(T.MIN_FACE_AREA);
  });

  it('does NOT reject a legitimately thin face', () => {
    // A 3mm x 4m reveal strip. An aspect-ratio test would destroy this; an
    // area test correctly keeps it. §6.2
    const reveal = [vec2(0, 0), vec2(4, 0), vec2(4, 0.003), vec2(0, 0.003)];
    expect(area(reveal)).toBeGreaterThan(T.MIN_FACE_AREA);
  });

  it('rewinds without mutating the input', () => {
    const original = [...SQUARE];
    const cw = withWinding(SQUARE, false);
    expect(isCounterClockwise(cw)).toBe(false);
    expect(SQUARE).toEqual(original);
  });
});

describe('containment', () => {
  it('tests a convex polygon', () => {
    expect(pointInPolygon(vec2(1, 1), SQUARE)).toBe(true);
    expect(pointInPolygon(vec2(3, 1), SQUARE)).toBe(false);
  });

  it('tests a concave polygon in the notch', () => {
    expect(pointInPolygon(vec2(0.5, 0.5), L_SHAPE)).toBe(true);
    expect(pointInPolygon(vec2(2, 2), L_SHAPE)).toBe(false); // the missing corner
  });

  it('excludes points inside a hole', () => {
    const hole = [vec2(0.5, 0.5), vec2(1.5, 0.5), vec2(1.5, 1.5), vec2(0.5, 1.5)];
    expect(pointInPolygonWithHoles(vec2(1, 1), SQUARE, [hole])).toBe(false);
    expect(pointInPolygonWithHoles(vec2(0.2, 0.2), SQUARE, [hole])).toBe(true);
  });

  it('measures distance to the boundary', () => {
    expect(distanceToBoundary(vec2(1, 1), SQUARE)).toBeCloseTo(1, 10);
    expect(distanceToBoundary(vec2(0, 1), SQUARE)).toBeCloseTo(0, 10);
  });
});

describe('interiorPoint', () => {
  it('the centroid of an L-shape is genuinely outside it', () => {
    // Establishes the premise. If this ever stops being true the test below
    // stops proving anything.
    const c = centroidOf(L_SHAPE);
    expect(pointInPolygon(c, L_SHAPE)).toBe(false);
  });

  it('returns a point inside an L-shape where the centroid fails', () => {
    // Attribute reattachment matches a new face to an old one by testing
    // which old polygon contains this point. A centroid that lands outside
    // silently transplants the wrong material onto the wrong region. §6.3
    const p = interiorPoint(L_SHAPE)!;
    expect(p).not.toBeNull();
    expect(pointInPolygon(p, L_SHAPE)).toBe(true);
  });

  it('returns a point inside a deep horseshoe', () => {
    const c = centroidOf(HORSESHOE);
    expect(pointInPolygon(c, HORSESHOE)).toBe(false);
    const p = interiorPoint(HORSESHOE)!;
    expect(pointInPolygon(p, HORSESHOE)).toBe(true);
  });

  it('works on a convex polygon', () => {
    expect(pointInPolygon(interiorPoint(SQUARE)!, SQUARE)).toBe(true);
  });

  it('is winding-agnostic', () => {
    for (const poly of [L_SHAPE, [...L_SHAPE].reverse(), HORSESHOE, [...HORSESHOE].reverse()]) {
      const p = interiorPoint(poly)!;
      expect(pointInPolygon(p, poly)).toBe(true);
    }
  });

  it('handles a polygon rotated so the leftmost vertex changes', () => {
    // The algorithm anchors on the leftmost vertex, so rotating the vertex
    // order must not change the outcome.
    for (let shift = 0; shift < L_SHAPE.length; shift++) {
      const rotated = [...L_SHAPE.slice(shift), ...L_SHAPE.slice(0, shift)];
      const p = interiorPoint(rotated)!;
      expect(pointInPolygon(p, rotated), `shift ${shift}`).toBe(true);
    }
  });

  it('returns null for a degenerate polygon', () => {
    expect(interiorPoint([vec2(0, 0), vec2(1, 0)])).toBeNull();
  });

  it('is deterministic', () => {
    expect(interiorPoint(HORSESHOE)).toEqual(interiorPoint(HORSESHOE));
  });
});

describe('interiorPointWithHoles', () => {
  it('avoids a central hole', () => {
    const outer = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];
    const hole = [vec2(1, 1), vec2(3, 1), vec2(3, 3), vec2(1, 3)];
    const p = interiorPointWithHoles(outer, [hole])!;
    expect(p).not.toBeNull();
    expect(pointInPolygonWithHoles(p, outer, [hole])).toBe(true);
  });

  it('avoids multiple holes', () => {
    const outer = [vec2(0, 0), vec2(6, 0), vec2(6, 3), vec2(0, 3)];
    const holes = [
      [vec2(1, 1), vec2(2, 1), vec2(2, 2), vec2(1, 2)],
      [vec2(4, 1), vec2(5, 1), vec2(5, 2), vec2(4, 2)],
    ];
    const p = interiorPointWithHoles(outer, holes)!;
    expect(pointInPolygonWithHoles(p, outer, holes)).toBe(true);
  });

  it('handles a hole that swallows the simple interior point', () => {
    // Hole positioned to sit exactly where interiorPoint would otherwise land.
    const outer = [vec2(0, 0), vec2(4, 0), vec2(4, 4), vec2(0, 4)];
    const hole = [vec2(0.1, 0.1), vec2(3.9, 0.1), vec2(3.9, 3.9), vec2(0.1, 3.9)];
    const p = interiorPointWithHoles(outer, [hole]);
    expect(p).not.toBeNull();
    expect(pointInPolygonWithHoles(p!, outer, [hole])).toBe(true);
  });

  it('falls through to the plain interior point when there are no holes', () => {
    const p = interiorPointWithHoles(L_SHAPE, [])!;
    expect(pointInPolygon(p, L_SHAPE)).toBe(true);
  });
});
