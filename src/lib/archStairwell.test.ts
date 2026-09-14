import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeStairHoleForSlab, applyStairwellHolesToSlabs } from './archStairwell';
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

// Real floor slabs that can actually have a stair hole cut into them are
// always 'poly'-typed with this exact rotation/quaternion — a plain 'box'
// can't render a hole at all (BoxGeometry has no holes support), and both
// real call sites (archRoofGenerator's slab generation, and
// applyStairwellHolesToSlabs's box->poly conversion) apply this specific
// rotation before/when computing or rendering the hole. Matching it here
// is what makes this test representative of production instead of
// exercising an axis convention no real slab ever actually has.
const SLAB_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

function slabShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: 'slab-1',
    type: 'poly',
    position: [0, STAIR_TOP_Y, 0],
    rotation: [Math.PI / 2, 0, 0],
    quaternion: [SLAB_QUAT.x, SLAB_QUAT.y, SLAB_QUAT.z, SLAB_QUAT.w],
    args: { vertices: [[-5, -5], [5, -5], [5, 5], [-5, 5]], height: 0.2 },
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

  it('hole2D describes a real 2D footprint matching worldPolygon, for a slab at the standard floor-slab rotation', () => {
    // Every real floor slab that can have a stair hole cut into it carries
    // this exact rotation (see slabShape's own comment) — PolyGeometry
    // builds `holes` as a THREE.Shape in the slab's own LOCAL X/Y plane,
    // extruded along local Z, with this rotation/quaternion applied
    // afterward as the mesh's own outer transform. Inverting that specific
    // rotation sends a point's world Z offset into localPt.y (not
    // localPt.z) — so with the slab centered at the same (x=0, z=0) as the
    // stair, hole2D's [x, y] should equal worldPolygon's [x, z] exactly.
    //
    // Regression coverage: computeStairHoleForSlab briefly built hole2D
    // from `localPt.x, localPt.z` instead, which — for this rotation —
    // collapsed every corner to the extrusion's near-zero Z thickness,
    // giving the "hole" used to cut the floor slab ~zero area (visible as
    // stairs cutting no hole at all, while guard railings, computed from
    // worldPolygon and unaffected by this bug, stayed correctly placed).
    const stair = stairShape();
    const slab = slabShape();
    const result = computeStairHoleForSlab(stair, slab);
    expect(result).not.toBeNull();

    for (let i = 0; i < result!.hole2D.length; i++) {
      expect(result!.hole2D[i][0]).toBeCloseTo(result!.worldPolygon[i][0], 6);
      expect(result!.hole2D[i][1]).toBeCloseTo(result!.worldPolygon[i][1], 6);
    }

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
    const slab = slabShape({ position: [0, STAIR_TOP_Y, 0], args: { vertices: [[-5, -5], [5, -5], [5, 5], [-5, 5]], height: slabThickness } });
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

  function shoelaceArea(poly: [number, number][]): number {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
  }

  it('applyStairwellHolesToSlabs cuts a real (non-degenerate) hole when converting a box slab to a poly', () => {
    // This is the actual end-to-end path a user hits: a plain 'box' floor
    // slab (BoxGeometry can't render holes at all) gets converted to a
    // 'poly' with a fixed [Math.PI/2, 0, 0] rotation so it CAN show a
    // stair cutout. Regression coverage for a bug where the hole was
    // computed against the box's own (identity) rotation instead of the
    // rotation the resulting poly actually ends up with — the two calling
    // conventions disagreed on which local axis was which, so the box path
    // and the "already a poly" path (the test above) needed opposite fixes
    // and one of them was always broken.
    const stair = stairShape();
    const boxSlab: Shape = {
      id: 'slab-box-1',
      type: 'box',
      name: 'Floor Slab',
      position: [0, STAIR_TOP_Y, 0],
      rotation: [0, 0, 0],
      args: [10, 0.2, 10],
      color: '#cccccc',
      tags: ['floor-slab'],
    };

    const result = applyStairwellHolesToSlabs([stair, boxSlab]);
    const convertedSlab = result.find(s => s.id === 'slab-box-1');
    expect(convertedSlab).toBeDefined();
    expect(convertedSlab!.type).toBe('poly');

    const holes = (convertedSlab!.args as any).holes as [number, number][][];
    expect(holes).toBeDefined();
    expect(holes.length).toBe(1);

    const area = shoelaceArea(holes[0]);
    // The stair is 1m x 3.6m plus clearance, so a correctly-cut hole has an
    // area around 1.16 * 3.76 ≈ 4.4 m². A degenerate (collapsed) hole from
    // an axis mismatch has an area near zero.
    expect(area).toBeGreaterThan(1.0);

    // Area alone can't catch an axis mismatch that happens to preserve
    // area (e.g. a hole rotated/mirrored into a different quadrant than
    // the outer boundary uses) — also check every hole vertex falls
    // within the outer boundary's own bounds, i.e. the hole and the
    // outline actually agree on which axis is which.
    const outerVertices = (convertedSlab!.args as any).vertices as [number, number][];
    const outerXs = outerVertices.map(v => v[0]);
    const outerYs = outerVertices.map(v => v[1]);
    for (const [hx, hy] of holes[0]) {
      expect(hx).toBeGreaterThanOrEqual(Math.min(...outerXs));
      expect(hx).toBeLessThanOrEqual(Math.max(...outerXs));
      expect(hy).toBeGreaterThanOrEqual(Math.min(...outerYs));
      expect(hy).toBeLessThanOrEqual(Math.max(...outerYs));
    }
  });
});
